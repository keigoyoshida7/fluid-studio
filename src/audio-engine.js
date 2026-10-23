import { advanceClock, createClock } from './sequencer-clock.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || 0));
const DEFAULT_PATTERN = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];

/** Browser-local sound and rhythm. Nothing is uploaded or started automatically. */
export class AudioEngine {
  constructor({ onStep = () => {}, onBeat = () => {}, onState = () => {} } = {}) {
    this.onStep = onStep;
    this.onBeat = onBeat;
    this.onState = onState;
    this._mode = 'sequencer';
    this._status = 'idle';
    this._running = false;
    this._bpm = 110;
    this._swing = 0;
    this._volume = 0.65;
    this._muted = false;
    this._pattern = [...DEFAULT_PATTERN];
    this._step = -1;
    this._context = null;
    this._analyser = null;
    this._master = null;
    this._fileBuffer = null;
    this._fileInfo = null;
    this._fileSource = null;
    this._fileOffset = 0;
    this._fileStartedAt = 0;
    this._micSource = null;
    this._stream = null;
    this._clock = null;
    this._timer = null;
    this._timeouts = new Set();
    this._voices = new Set();
    this._operationId = 0;
    this._loadId = 0;
    this._disposed = false;
    this._visibilityPaused = false;
    this._tapTimes = [];
    this._beatPending = false;
    this._lastBeatTime = -Infinity;
    this._lastUpdate = 0;
    this._levels = { energy: 0, low: 0, mid: 0, high: 0 };
    this._lowHistory = 0;
    this._lastLow = 0;
    this._noiseFloor = 0.006;
    this._onVisibility = () => this._handleVisibility();
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this._onVisibility);
  }

  get mode() { return this._mode; }
  get status() { return this._status; }
  get running() { return this._running; }
  get bpm() { return this._bpm; }
  get swing() { return this._swing; }
  get volume() { return this._volume; }
  get muted() { return this._muted; }
  get pattern() { return [...this._pattern]; }
  get step() { return this._step; }
  get fileInfo() { return this._fileInfo ? { ...this._fileInfo } : null; }
  get state() {
    return {
      mode: this.mode, status: this.status, running: this.running,
      bpm: this.bpm, swing: this.swing, volume: this.volume, muted: this.muted,
      pattern: this.pattern, step: this.step, fileInfo: this.fileInfo,
    };
  }

  _emit(extra = {}) { this.onState({ ...this.state, ...extra }); }

  _ensureContext() {
    if (this._disposed) throw new Error('音のエンジンは終了しています。ページを再読み込みしてください。');
    if (this._context) return this._context;
    const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AudioContextClass) throw new Error('このブラウザでは Web Audio を利用できません。');
    this._context = new AudioContextClass({ latencyHint: 'interactive' });
    this._analyser = this._context.createAnalyser();
    this._analyser.fftSize = 2048;
    this._analyser.smoothingTimeConstant = 0.55;
    this._analyser.minDecibels = -90;
    this._analyser.maxDecibels = -12;
    this._frequencyData = new Float32Array(this._analyser.frequencyBinCount);
    this._waveData = new Float32Array(this._analyser.fftSize);
    this._master = this._context.createGain();
    this._analyser.connect(this._master);
    this._master.connect(this._context.destination);
    this._applyVolume();
    return this._context;
  }

  _applyVolume() {
    if (!this._master) return;
    // Microphone input is analysed silently, so speakers cannot feed it back.
    const value = this._muted || this._mode === 'microphone' ? 0 : this._volume;
    this._master.gain.setTargetAtTime(value, this._context.currentTime, 0.015);
  }

  _fail(error) {
    this._pauseSources();
    this._running = false;
    this._status = 'error';
    this._emit({ error: error?.message || '音を開始できませんでした。' });
  }

  async start() {
    if (this._running) return;
    const operation = ++this._operationId;
    try {
      const context = this._ensureContext();
      if (this._mode === 'file' && !this._fileBuffer) throw new Error('先に音声ファイルを選択してください。');
      if (this._mode === 'microphone' && !this._stream) return await this.useMicrophone();
      await context.resume();
      if (operation !== this._operationId || this._disposed) return;
      if (context.state !== 'running') throw new Error('音を開始するには、再生ボタンをもう一度押してください。');
      if (this._running) return;
      this._running = true;
      this._status = 'running';
      this._lastUpdate = 0;
      this._lastBeatTime = -Infinity;
      if (this._mode === 'sequencer') this._startClock();
      if (this._mode === 'file') this._startFile();
      this._applyVolume();
      this._emit();
    } catch (error) {
      if (operation === this._operationId) this._fail(error);
      throw error;
    }
  }

  stop() {
    ++this._operationId;
    this._visibilityPaused = false;
    this._pauseSources();
    this._running = false;
    this._step = -1;
    this._clock = null;
    this._status = 'paused';
    this._emit();
  }

  _pauseSources() {
    clearInterval(this._timer);
    this._timer = null;
    for (const timeout of this._timeouts) clearTimeout(timeout);
    this._timeouts.clear();
    for (const voice of this._voices) {
      try { voice.stop(); } catch { /* A completed oscillator is already stopped. */ }
      voice.disconnect();
    }
    this._voices.clear();
    if (this._fileSource) {
      this._fileOffset = (this._fileOffset + Math.max(0, this._context.currentTime - this._fileStartedAt)) % this._fileBuffer.duration;
      try { this._fileSource.stop(); } catch { /* Source may already have stopped. */ }
      this._fileSource.disconnect();
      this._fileSource = null;
    }
    if (this._micSource) {
      this._micSource.disconnect();
      this._micSource = null;
    }
    if (this._stream) {
      this._stream.getTracks().forEach(track => track.stop());
      this._stream = null;
    }
    this._beatPending = false;
  }

  _switchMode(mode) {
    ++this._operationId;
    this._visibilityPaused = false;
    this._pauseSources();
    this._running = false;
    this._mode = mode;
    this._status = 'paused';
    this._step = -1;
    this._clock = null;
    this._lowHistory = this._lastLow = 0;
    this._noiseFloor = 0.006;
    this._lastBeatTime = -Infinity;
    this._applyVolume();
  }

  useSequencer() {
    const resume = this._running;
    this._switchMode('sequencer');
    this._emit();
    if (resume) return this.start();
    return Promise.resolve();
  }

  async useFile() {
    if (!this._fileBuffer) {
      const error = new Error('先に音声ファイルを選択してください。');
      this._emit({ error: error.message });
      throw error;
    }
    this._switchMode('file');
    this._emit();
    return this.start();
  }

  async useMicrophone() {
    this._switchMode('microphone');
    const operation = this._operationId;
    this._status = 'loading';
    this._emit();
    try {
      const context = this._ensureContext();
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('このブラウザではマイク入力を利用できません。');
      // Resume while the button gesture is still active, before permission UI.
      await context.resume();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }, video: false });
      if (operation !== this._operationId || this._disposed) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      if (typeof document !== 'undefined' && document.hidden) {
        stream.getTracks().forEach(track => track.stop());
        this._status = 'paused';
        this._emit({ hidden: true });
        return;
      }
      this._stream = stream;
      for (const track of stream.getTracks()) track.addEventListener?.('ended', () => {
        if (this._stream !== stream) return;
        this.stop();
        this._emit({ error: 'マイク入力が停止されました。再開するにはマイクボタンを押してください。' });
      }, { once: true });
      this._micSource = context.createMediaStreamSource(stream);
      this._micSource.connect(this._analyser);
      this._running = true;
      this._status = 'running';
      this._applyVolume();
      this._emit();
    } catch (error) {
      if (operation !== this._operationId || this._disposed) return;
      const message = error?.name === 'NotAllowedError' ? 'マイクの使用が許可されていません。ブラウザの設定を確認してください。' : error?.message;
      const userError = new Error(message || 'マイクを開始できませんでした。');
      this._fail(userError);
      throw userError;
    }
  }

  stopInput() { this.stop(); }

  async loadFile(file) {
    const loadId = ++this._loadId;
    if (!file || typeof file.arrayBuffer !== 'function') throw new Error('音声ファイルを選択してください。');
    this._emit({ loadingFile: true });
    try {
      const context = this._ensureContext();
      const bytes = await file.arrayBuffer();
      if (loadId !== this._loadId || this._disposed) return null;
      const buffer = await context.decodeAudioData(bytes);
      if (loadId !== this._loadId || this._disposed) return null;
      if (!buffer.duration) throw new Error('音声ファイルに再生できる音がありません。');
      if (this._mode === 'file') {
        ++this._operationId;
        this._pauseSources();
        this._running = false;
        this._status = 'paused';
      }
      this._fileBuffer = buffer;
      this._fileInfo = { name: String(file.name || 'Local audio'), duration: buffer.duration };
      this._fileOffset = 0;
      this._emit({ loadingFile: false });
      return this.fileInfo;
    } catch (error) {
      if (loadId !== this._loadId || this._disposed) return null;
      const userError = new Error(error?.name === 'EncodingError' ? 'この音声形式を読み込めませんでした。MP3・WAV・M4Aなどをお試しください。' : error?.message || '音声ファイルを読み込めませんでした。');
      this._emit({ loadingFile: false, error: userError.message });
      throw userError;
    }
  }

  _startFile() {
    this._fileSource = this._context.createBufferSource();
    this._fileSource.buffer = this._fileBuffer;
    this._fileSource.loop = true;
    this._fileSource.connect(this._analyser);
    this._fileStartedAt = this._context.currentTime;
    this._fileSource.start(0, this._fileOffset % this._fileBuffer.duration);
  }

  toggleStep(index) {
    if (!Number.isInteger(index) || index < 0 || index > 15) return;
    this._pattern[index] = this._pattern[index] ? 0 : 1;
    this._emit();
  }

  setPattern(pattern) {
    if (!Array.isArray(pattern) || pattern.length !== 16) throw new Error('パターンは16ステップで指定してください。');
    this._pattern = pattern.map(value => clamp(value, 0, 1));
    this._emit();
  }

  setBpm(value) { this._bpm = clamp(value, 40, 200); this._emit(); }
  setSwing(value) { this._swing = clamp(value, 0, 0.5); this._emit(); }
  setVolume(value) { this._volume = clamp(value, 0, 1); this._applyVolume(); this._emit(); }
  setMuted(value) { this._muted = Boolean(value); this._applyVolume(); this._emit(); }

  tapTempo() {
    const now = performance.now();
    const previous = this._tapTimes.at(-1);
    if (previous && now - previous > 2500) this._tapTimes = [];
    if (previous && now - previous < 220) return this._bpm;
    this._tapTimes.push(now);
    this._tapTimes = this._tapTimes.slice(-7);
    if (this._tapTimes.length > 1) {
      const intervals = this._tapTimes.slice(1).map((time, i) => time - this._tapTimes[i]);
      intervals.sort((a, b) => a - b);
      const median = intervals[Math.floor(intervals.length / 2)];
      this.setBpm(Math.round(60000 / median));
    }
    return this._bpm;
  }

  _startClock() {
    this._clock = createClock(this._context.currentTime);
    this._schedule();
    this._timer = setInterval(() => this._schedule(), 25);
  }

  _schedule() {
    if (!this._running || this._mode !== 'sequencer' || this._context.state !== 'running') return;
    const { clock, steps } = advanceClock(this._clock, this._context.currentTime, { bpm: this._bpm, swing: this._swing });
    this._clock = clock;
    const operation = this._operationId;
    for (const { step, time } of steps) {
      const velocity = this._pattern[step];
      if (velocity) this._synthKick(time, velocity);
      const timeout = setTimeout(() => {
        this._timeouts.delete(timeout);
        if (!this._running || this._operationId !== operation) return;
        this._step = step;
        this.onStep({ step, time, audible: Boolean(velocity && !this._muted && this._volume > 0), velocity });
        if (velocity) this._emitBeat(velocity, time, 'sequencer');
      }, Math.max(0, (time - this._context.currentTime) * 1000));
      this._timeouts.add(timeout);
    }
  }

  _synthKick(time, velocity) {
    const context = this._context;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(148, time);
    oscillator.frequency.exponentialRampToValueAtTime(49, time + 0.075);
    oscillator.frequency.exponentialRampToValueAtTime(37, time + 0.29);
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(0.82 * velocity + 0.0001, time + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.34 * velocity + 0.0001, time + 0.065);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.42);
    oscillator.connect(gain);
    gain.connect(this._analyser);
    this._voices.add(oscillator);
    oscillator.onended = () => { this._voices.delete(oscillator); oscillator.disconnect(); gain.disconnect(); };
    oscillator.start(time);
    oscillator.stop(time + 0.44);
  }

  async triggerKick(velocity = 1) {
    const operation = this._operationId;
    try {
      const context = this._ensureContext();
      await context.resume();
      if (this._disposed || operation !== this._operationId) return;
      const strength = clamp(velocity, 0, 1);
      if (this._mode !== 'microphone') this._synthKick(context.currentTime + 0.004, strength);
      this._emitBeat(strength, context.currentTime + 0.004, 'sequencer');
    } catch (error) { this._fail(error); }
  }

  _emitBeat(velocity, time, source) {
    this._lastBeatTime = time;
    this._beatPending = true;
    this.onBeat({ velocity: clamp(velocity, 0, 1), time, source });
  }

  _bandEnergy(lowHz, highHz) {
    const hzPerBin = this._context.sampleRate / this._analyser.fftSize;
    const start = Math.max(1, Math.floor(lowHz / hzPerBin));
    const end = Math.min(this._frequencyData.length, Math.ceil(highHz / hzPerBin));
    let sum = 0;
    for (let i = start; i < end; i++) sum += Math.pow(10, this._frequencyData[i] / 20);
    return sum / Math.max(1, end - start);
  }

  update(now = performance.now()) {
    const dt = this._lastUpdate ? clamp((now - this._lastUpdate) / 1000, 0.001, 0.1) : 1 / 60;
    this._lastUpdate = now;
    const target = { energy: 0, low: 0, mid: 0, high: 0 };
    const active = this._context?.state === 'running' && (this._running || this._voices.size > 0);
    if (active) {
      this._analyser.getFloatFrequencyData(this._frequencyData);
      this._analyser.getFloatTimeDomainData(this._waveData);
      let square = 0;
      for (const sample of this._waveData) square += sample * sample;
      const rms = Math.sqrt(square / this._waveData.length);
      const low = this._bandEnergy(35, 180);
      target.energy = clamp(rms * 3, 0, 1);
      target.low = clamp(low * 5.5, 0, 1);
      target.mid = clamp(this._bandEnergy(180, 2000) * 7.5, 0, 1);
      target.high = clamp(this._bandEnergy(2000, 12000) * 13, 0, 1);
      if (this._mode !== 'sequencer' && this._running) {
        // Adaptive spectral onset: a bass rise above its recent local baseline.
        const currentTime = this._context.currentTime;
        const floorAlpha = 1 - Math.exp(-dt / (low < this._noiseFloor ? 0.15 : 5));
        this._noiseFloor += (low - this._noiseFloor) * floorAlpha;
        const threshold = Math.max(0.009, this._noiseFloor * 1.6, this._lowHistory * 1.27);
        const rise = low - this._lastLow;
        if (rms > 0.007 && low > threshold && rise > Math.max(0.0014, this._lowHistory * 0.045) && currentTime - this._lastBeatTime > 0.16) {
          this._emitBeat(clamp((low - this._lowHistory) * 8 + rms * 1.5, 0.25, 1), currentTime, this._mode);
        }
        this._lowHistory += (low - this._lowHistory) * (1 - Math.exp(-dt / 0.35));
        this._lastLow = low;
      }
    }
    for (const key of Object.keys(this._levels)) {
      const tau = target[key] > this._levels[key] ? 0.035 : 0.24;
      this._levels[key] += (target[key] - this._levels[key]) * (1 - Math.exp(-dt / tau));
    }
    const beat = this._beatPending;
    this._beatPending = false;
    const secondsPerBeat = 60 / this._bpm;
    const phase = this._context && Number.isFinite(this._lastBeatTime) ? clamp((this._context.currentTime - this._lastBeatTime) / secondsPerBeat, 0, 1) : 1;
    return { ...this._levels, beat, phase };
  }

  _handleVisibility() {
    if (document.hidden && this._running) {
      this._visibilityPaused = this._mode !== 'microphone';
      this._pauseSources();
      this._running = false;
      this._status = 'paused';
      this._emit({ hidden: true });
    } else if (!document.hidden && this._visibilityPaused) {
      this._visibilityPaused = false;
      this.start().catch(() => {});
    }
  }

  dispose() {
    if (this._disposed) return;
    ++this._operationId;
    ++this._loadId;
    this._pauseSources();
    this._running = false;
    this._disposed = true;
    this._fileBuffer = null;
    this._fileInfo = null;
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this._onVisibility);
    this._analyser?.disconnect();
    this._master?.disconnect();
    this._context?.close().catch(() => {});
  }
}

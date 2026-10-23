import assert from 'node:assert/strict';
import { AudioEngine } from '../src/audio-engine.js';

class AudioParam {
  value = 0;
  setValueAtTime(value) { this.value = value; }
  setTargetAtTime(value) { this.value = value; }
  exponentialRampToValueAtTime(value) { this.value = value; }
}
class AudioNode {
  connections = [];
  gain = new AudioParam();
  frequency = new AudioParam();
  connect(node) { this.connections.push(node); return node; }
  disconnect() { this.connections = []; }
  start() { this.started = true; }
  stop() { this.stopped = true; }
}
class Analyser extends AudioNode {
  fftSize = 2048;
  frequencyBinCount = 1024;
  bass = 0;
  getFloatFrequencyData(data) {
    data.fill(-100);
    if (this.bass) for (let i = 2; i < 8; i++) data[i] = 20 * Math.log10(this.bass);
  }
  getFloatTimeDomainData(data) { data.fill(this.bass ? 0.15 : 0); }
}
const contexts = [];
class MockContext {
  currentTime = 1;
  sampleRate = 48000;
  state = 'suspended';
  destination = new AudioNode();
  constructor() { contexts.push(this); }
  createAnalyser() { return (this.analyser = new Analyser()); }
  createGain() { return new AudioNode(); }
  createOscillator() { return new AudioNode(); }
  createBufferSource() { return new AudioNode(); }
  createMediaStreamSource(stream) { const source = new AudioNode(); source.stream = stream; return source; }
  async resume() { this.state = 'running'; }
  async close() { this.state = 'closed'; }
  async decodeAudioData(bytes) { return { duration: bytes.byteLength, numberOfChannels: 1 }; }
}
globalThis.AudioContext = MockContext;
let microphoneRequests = 0;
const tracks = [];
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {
  mediaDevices: { async getUserMedia() {
    microphoneRequests++;
    const track = { stopped: false, stop() { this.stopped = true; } };
    tracks.push(track);
    return { getTracks: () => [track] };
  } },
} });

const events = [];
const beats = [];
const engine = new AudioEngine({ onStep: event => events.push(event), onBeat: beat => beats.push(beat) });
assert.equal(contexts.length, 0, 'Construction must not create or start an audio context.');
assert.equal(microphoneRequests, 0, 'Microphone permission must never be requested automatically.');
assert.equal(engine.pattern.length, 16);
engine.setBpm(999);
assert.equal(engine.bpm, 200);
engine.setSwing(2);
assert.equal(engine.swing, 0.5);
engine.setBpm(110);
engine.setSwing(0);
await engine.start();
await new Promise(resolve => setTimeout(resolve, 55));
assert.equal(events.length, 1, 'First visual step must be emitted at scheduled playback time.');
assert.equal(beats.length, 1);
assert.equal(events[0].step, 0);
engine.stop();
assert.equal(engine.running, false);
assert.equal(engine._timeouts.size, 0, 'Stop must cancel pending visual events.');
assert.equal(engine._voices.size, 0, 'Stop must stop queued audio voices.');

let resolveOldLoad;
const oldLoad = engine.loadFile({ name: 'old.wav', arrayBuffer: () => new Promise(resolve => { resolveOldLoad = resolve; }) });
const latestInfo = await engine.loadFile({ name: 'new.wav', arrayBuffer: async () => new ArrayBuffer(12) });
resolveOldLoad(new ArrayBuffer(99));
assert.equal(await oldLoad, null, 'An older decode must not replace the latest selection.');
assert.deepEqual(latestInfo, { name: 'new.wav', duration: 12 });
await engine.useFile();
assert.equal(engine.mode, 'file');
assert.equal(engine._fileSource.loop, true);
assert.equal(microphoneRequests, 0);

const context = contexts[0];
const baselineBeats = beats.length;
engine.update(1000);
context.currentTime = 2;
context.analyser.bass = 0.12;
engine.update(1020);
assert.equal(beats.length, baselineBeats + 1, 'A sufficiently strong bass onset should trigger a fluid beat.');
assert.equal(beats.at(-1).source, 'file');
context.currentTime = 2.4;
engine.update(1040);
assert.equal(beats.length, baselineBeats + 1, 'Sustained bass must not retrigger without a fresh onset.');

await engine.useMicrophone();
assert.equal(microphoneRequests, 1);
assert.equal(engine._fileSource, null, 'Switching input must stop file playback.');
assert.equal(engine._master.gain.value, 0, 'Microphone input must be silent to prevent feedback.');
engine.setVolume(1);
assert.equal(engine._master.gain.value, 0, 'Volume changes must not make microphone monitoring audible.');
await engine.useSequencer();
assert.equal(tracks[0].stopped, true, 'Leaving microphone mode must release its hardware stream.');
assert.equal(engine.mode, 'sequencer');
engine.dispose();
assert.equal(context.state, 'closed');
assert.equal(engine._timer, null);

let releasePermission;
navigator.mediaDevices.getUserMedia = () => new Promise(resolve => { releasePermission = resolve; });
const pendingEngine = new AudioEngine();
const permission = pendingEngine.useMicrophone();
await Promise.resolve();
await pendingEngine.useSequencer();
const lateTrack = { stopped: false, stop() { this.stopped = true; } };
releasePermission({ getTracks: () => [lateTrack] });
await permission;
assert.equal(lateTrack.stopped, true, 'A permission result after source cancellation must release its stream.');
assert.equal(pendingEngine.mode, 'sequencer');
assert.equal(pendingEngine.running, false);
pendingEngine.dispose();
console.log('Audio engine: gesture gate, scheduling, local decode races, bass onsets, silent microphone and cleanup passed (mock Web Audio; no microphone permission requested).');

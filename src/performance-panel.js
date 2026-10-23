import { mountWaveControls } from './wave-controls.js';
import { AudioEngine } from './audio-engine.js';
import { CameraDirector } from './camera-director.js';
import './performance.css';
import { t, bindTranslations, onLanguageChange } from './i18n.js';

const PATTERNS = {
  four: [1,0,0,0,.8,0,0,0,.95,0,0,0,.8,0,0,0],
  broken: [1,0,0,.6,0,0,.85,0,1,0,0,0,0,.7,0,.5],
  euclid: [1,0,0,.7,0,0,.9,0,0,.7,0,0,.85,0,0,0],
  heartbeat: [1,0,.6,0,0,0,0,0,.9,0,.55,0,0,0,0,0],
};

const buttonIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m9 5 10 7-10 7Z"/></svg>';

export function mountPerformance({ fluid, getWorker, getPaused, getPreset=()=> 'orbit', onResume }) {
  document.querySelector('.presets-section').insertAdjacentHTML('beforebegin', `
    <section class="performance-panel" aria-label="音と流体のパフォーマンス">
      <div class="performance-heading"><div><div class="eyebrow">LIQUID SCORE / SOUND × MATTER</div><h2>流れを、演奏する。</h2><p>低音が水を動かし、光が余韻を描く。</p></div><div class="audio-transport"><span id="audio-status" class="audio-status">SOUND OFF</span><button id="audio-run" class="audio-run" aria-label="音を再生">${buttonIcon}<span>音をはじめる</span></button></div></div>
      <div class="audio-source-row"><div class="audio-sources" role="group" aria-label="音の入力"><button data-source="sequencer" class="active" aria-pressed="true">Kick sequence</button><button data-source="file" aria-pressed="false">音源を読み込む <span>↗</span></button><button data-source="microphone" aria-pressed="false">マイク入力</button></div><span id="audio-file-name" class="audio-file-name">16 steps. Infinite forms.</span><input id="audio-file-input" type="file" accept="audio/*,.wav,.mp3,.aiff,.aif,.m4a,.ogg,.flac" hidden /></div>
      <div class="sequencer" id="sequencer"><div class="sequencer-meta"><span>KICK / 16</span><div class="pattern-wrap"><label for="pattern-select">PATTERN</label><select id="pattern-select"><option value="four">Four on the floor</option><option value="broken">Broken current</option><option value="euclid">Euclidean / 5</option><option value="heartbeat">Heartbeat</option></select></div><span class="bar-position" id="bar-position">01 / 16</span></div><div class="step-grid" role="group" aria-label="16ステップのキックシーケンサー">${Array.from({length:16},(_,i)=>`<button class="seq-step ${i%4===0?'active':''} ${i%4===0?'downbeat':''}" data-step="${i}" aria-label="ステップ ${i+1}" aria-pressed="${i%4===0}"><span class="step-number">${String(i+1).padStart(2,'0')}</span><span class="step-mark"></span></button>`).join('')}</div><div class="sequencer-caption"><span>タップでキックを配置</span><span>音と同じ時計で、流れを刻む。</span></div></div>
      <div class="audio-file-display" id="audio-file-display" hidden><div class="audio-visual" aria-hidden="true">${Array.from({length:32},(_,i)=>`<i style="--i:${i}"></i>`).join('')}</div><p id="input-caption">低音の立ち上がりを検出し、流体へ伝えます。</p><span>選んだ音源は端末内だけで再生・解析されます。</span></div>
      <div class="performance-settings">
        <div class="tempo-control"><label for="bpm">TEMPO</label><div><input id="bpm" type="number" min="40" max="200" step="1" value="120" inputmode="numeric" aria-label="テンポ BPM" /><span>BPM</span><button id="tap-tempo" title="数回タップしてテンポを指定">TAP</button></div></div>
        <div class="performance-knob"><label for="swing">スウィング <output id="swing-output">0%</output></label><input id="swing" type="range" min="0" max="0.45" step="0.01" value="0" /></div>
        <div class="performance-knob"><label for="reactivity">水への強さ <output id="reactivity-output">78%</output></label><input id="reactivity" type="range" min="0" max="1" step="0.01" value="0.78" /></div>
        <div class="performance-knob"><label for="audio-volume">音量 <output id="audio-volume-output">35%</output></label><input id="audio-volume" type="range" min="0" max="1" step="0.01" value="0.35" /></div>
        <button id="manual-kick" class="manual-kick">●<span>Kick</span><small>K</small></button>
      </div>
      <div class="performance-experiments"><div class="reaction-selector" role="group" aria-label="音への反応"><span class="experiment-label">音で水を彫る</span><button data-reaction="pulse" class="active" aria-pressed="true">Pulse <span>鼓動</span></button><button data-reaction="vortex" aria-pressed="false">Vortex <span>旋回</span></button><button data-reaction="levitate" aria-pressed="false">Levitate <span>浮遊</span></button></div><div class="experiment-toggles"><label class="experiment-toggle"><input id="time-lens" type="checkbox" role="switch" /><span>時のレンズ<small>キックの瞬間をスローモーションに</small></span></label><label class="experiment-toggle"><input id="light-echo" type="checkbox" role="switch" checked /><span>光の余韻<small>水と光が、同じ音を聴く</small></span></label></div></div>
    </section>`);

  document.querySelector('.controls .control-section').insertAdjacentHTML('afterend', `
    <section class="control-section optics-section"><div class="section-label"><h2>水と光の密度</h2><span>OPTICS</span></div>
      <label class="slider-label" for="surface-smoothness"><span>表面の滑らかさ</span><output id="surface-smoothness-output">78%</output></label><input id="surface-smoothness" type="range" min="0" max="1" step="0.01" value="0.78" />
      <label class="slider-label" for="water-clarity"><span>透明感</span><output id="water-clarity-output">96%</output></label><input id="water-clarity" type="range" min="0" max="1" step="0.01" value="0.96" />
      <label class="slider-label" for="light-dispersion"><span>光の分散</span><output id="light-dispersion-output">8%</output></label><input id="light-dispersion" type="range" min="0" max="1" step="0.01" value="0.08" />
    </section>`);
  document.querySelector('#camera-controls').innerHTML = `
    <button id="camera-morph" class="camera-morph" aria-pressed="false"><span class="camera-led"></span><span>カメラ位置をモーフィング</span><b>OFF</b></button>
    <div class="camera-style"><label class="select-label" for="camera-style">カメラワーク</label><div class="select-wrap"><select id="camera-style"><option value="drift">Drift / 浮かぶ視線</option><option value="orbit">Orbit / まわり込む</option><option value="macro">Intimate / 水に近づく</option></select><span>⌄</span></div></div>
    <label class="slider-label camera-speed-label" for="camera-speed"><span>移動の速さ</span><output id="camera-speed-output">30%</output></label><input id="camera-speed" type="range" min="0.1" max="1" step="0.01" value="0.3" />`;

  document.querySelector('.view-actions').insertAdjacentHTML('afterbegin','<button id="camera-quick" class="camera-quick" aria-label="カメラの自動移動" aria-pressed="false">CAMERA <span>OFF</span></button>');

  const $ = selector => document.querySelector(selector);
  let reaction='pulse', reactivity=.78, pulse=0, audio, disposed=false, lastUpdate=0, lastAudioForce=0, currentStep=-1, sourceRequest=0, timeLens=false, lightEcho=true;
  const optics={smoothness:.78, clarity:.96, dispersion:.08};
  const camera=new CameraDirector(fluid.camera,fluid.controls);
  let cameraEnabled=false, latestSnapshot=null;
  const showMessage=message=>{const el=$('#toast');el.dataset.i18nMessage=message;el.textContent=t(message);el.classList.add('visible');clearTimeout(showMessage.timer);showMessage.timer=setTimeout(()=>el.classList.remove('visible'),4000);};
  const paintRange=input=>input.style.setProperty('--fill',`${(Number(input.value)-Number(input.min))/(Number(input.max)-Number(input.min))*100}%`);
  const paintSteps=()=>{const pattern=audio?.pattern||PATTERNS.four;document.querySelectorAll('[data-step]').forEach((button,i)=>{button.classList.toggle('active',Boolean(pattern[i]));button.setAttribute('aria-pressed',String(Boolean(pattern[i])));});};
  const setCamera=value=>{cameraEnabled=Boolean(value);camera.setEnabled(cameraEnabled);$('#camera-morph').setAttribute('aria-pressed',String(cameraEnabled));$('#camera-morph b').textContent=cameraEnabled?'ON':'OFF';$('#camera-quick').setAttribute('aria-pressed',String(cameraEnabled));$('#camera-quick span').textContent=cameraEnabled?'ON':'OFF';};
  const paintState=snapshot=>{
    latestSnapshot=snapshot;
    const running=snapshot.running;
    $('#audio-run span').textContent=t(running?'音を止める':'音をはじめる');
    $('#audio-run').setAttribute('aria-label',t(running?'音を停止':'音を再生'));
    $('#audio-run').classList.toggle('running',running);
    $('#audio-status').textContent=t((snapshot.status==='loading'||snapshot.loadingFile)?'LOADING…':snapshot.status==='error'?'AUDIO ERROR':running?'SOUND ON':'SOUND OFF');
    $('#audio-status').classList.toggle('running',running);
    document.querySelectorAll('[data-source]').forEach(button=>{const active=button.dataset.source===snapshot.mode;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));});
    const isSequence=snapshot.mode==='sequencer';$('#sequencer').hidden=!isSequence;$('#audio-file-display').hidden=isSequence;
    $('#bpm').disabled=!isSequence;$('#swing').disabled=!isSequence;$('#tap-tempo').disabled=!isSequence;
    $('#audio-file-name').textContent=isSequence?t('16 steps. Infinite forms.'): snapshot.mode==='microphone'?t(running?'MIC / 入力音を聴いています':snapshot.status==='loading'?'MIC / 許可を待っています':'MIC / 停止中'):snapshot.fileInfo?.name||t('音源を選んでください');
    $('#input-caption').textContent=t(snapshot.mode==='microphone'?'マイクで聴いた低音が、水の動きになります。':'低音の立ち上がりを検出し、流体へ伝えます。');
    if(snapshot.error)showMessage(snapshot.error);
    if(!running){currentStep=-1;document.querySelectorAll('[data-step]').forEach(button=>button.classList.remove('playing'));}
    paintSteps();
  };
  const waveControls=mountWaveControls({fluid,getWorker,getPreset});
  const launchWave=(velocity=1)=>{
    const strength=Math.min(1.5,Math.max(0,velocity)*reactivity*1.5);
    if(getPaused()||strength===0)return;
    const source=waveControls.getSource(currentStep);
    fluid.triggerWave?.({strength,mode:reaction,source});
    if(fluid.flowMode!=='vascular')getWorker()?.postMessage({type:'beat',strength,mode:reaction,position:source});
  };
  audio=new AudioEngine({
    onStep:({step})=>{currentStep=step;$('#bar-position').textContent=`${String(step+1).padStart(2,'0')} / 16`;document.querySelectorAll('[data-step]').forEach((button,i)=>button.classList.toggle('playing',i===step));},
    onBeat:({velocity=1})=>{
      pulse=Math.min(1.5,Math.max(pulse,velocity));
      $('#manual-kick').classList.add('hit');clearTimeout(manualFlash);manualFlash=setTimeout(()=>$('#manual-kick').classList.remove('hit'),110);
      launchWave(velocity);
    },onState:paintState,
  });
  let manualFlash;
  audio.setPattern(PATTERNS.four);audio.setBpm(120);audio.setVolume(.35);camera.setSpeed(.3);fluid.setOptics?.(optics);
  $('#audio-run').addEventListener('click',async()=>{sourceRequest++;try{if(audio.running)audio.stop();else{onResume();await audio.start();}}catch(error){showMessage(error.message||'音を開始できませんでした');}});
  document.querySelectorAll('[data-step]').forEach(button=>button.addEventListener('click',()=>{audio.toggleStep(Number(button.dataset.step));paintSteps();}));
  $('#pattern-select').addEventListener('change',event=>{audio.setPattern(PATTERNS[event.target.value]);paintSteps();});
  $('#bpm').addEventListener('change',event=>{const bpm=Math.max(40,Math.min(200,Number(event.target.value)||120));event.target.value=bpm;audio.setBpm(bpm);});
  $('#tap-tempo').addEventListener('click',()=>{const bpm=audio.tapTempo();if(Number.isFinite(bpm))$('#bpm').value=Math.round(bpm);});
  $('#swing').addEventListener('input',event=>{const v=Number(event.target.value);audio.setSwing(v);$('#swing-output').textContent=`${Math.round(v*100)}%`;paintRange(event.target);});
  $('#reactivity').addEventListener('input',event=>{reactivity=Number(event.target.value);$('#reactivity-output').textContent=`${Math.round(reactivity*100)}%`;paintRange(event.target);});
  $('#audio-volume').addEventListener('input',event=>{const v=Number(event.target.value);audio.setVolume(v);$('#audio-volume-output').textContent=`${Math.round(v*100)}%`;paintRange(event.target);});
  document.querySelectorAll('[data-source]').forEach(button=>button.addEventListener('click',async()=>{
    sourceRequest++;
    try{
      if(button.dataset.source==='sequencer')await audio.useSequencer();
      if(button.dataset.source==='file')$('#audio-file-input').click();
      if(button.dataset.source==='microphone'){onResume();await audio.useMicrophone();}
    }catch(error){showMessage(error.message||'入力を開始できませんでした');}
  }));
  $('#audio-file-input').addEventListener('change',async event=>{const file=event.target.files?.[0];if(!file)return;const request=++sourceRequest;try{const info=await audio.loadFile(file);if(!info||disposed||request!==sourceRequest)return;onResume();await audio.useFile();}catch(error){showMessage(error.message||'この音源を読み込めませんでした');}finally{event.target.value='';}});
  const manualKick=async()=>{try{onResume();await audio.triggerKick(1);}catch(error){showMessage(error.message||'キックを再生できませんでした');}};
  $('#manual-kick').addEventListener('click',manualKick);
  const keyHandler=event=>{if(event.target.matches('input,select,textarea')||document.querySelector('dialog[open]'))return;if(event.key.toLowerCase()==='k'&&!event.repeat){event.preventDefault();manualKick();}};
  document.addEventListener('keydown',keyHandler);
  document.querySelectorAll('[data-reaction]').forEach(button=>button.addEventListener('click',()=>{reaction=button.dataset.reaction;document.querySelectorAll('[data-reaction]').forEach(b=>{const active=b===button;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));});}));
  $('#time-lens').addEventListener('change',event=>timeLens=event.target.checked);$('#light-echo').addEventListener('change',event=>lightEcho=event.target.checked);
  const opticalControl=[['surface-smoothness','smoothness'],['water-clarity','clarity'],['light-dispersion','dispersion']];
  opticalControl.forEach(([id,key])=>$(`#${id}`).addEventListener('input',event=>{optics[key]=Number(event.target.value);$(`#${id}-output`).textContent=`${Math.round(optics[key]*100)}%`;paintRange(event.target);fluid.setOptics?.(optics);}));
  $('#camera-morph').addEventListener('click',()=>setCamera(!cameraEnabled));$('#camera-quick').addEventListener('click',()=>setCamera(!cameraEnabled));
  $('#camera-style').addEventListener('change',event=>camera.setStyle(event.target.value));
  $('#camera-speed').addEventListener('input',event=>{const v=Number(event.target.value);camera.setSpeed(v);$('#camera-speed-output').textContent=`${Math.round(v*100)}%`;paintRange(event.target);});
  const manualCamera=event=>{if(cameraEnabled&&(event.button===2||document.querySelector('[data-mode="orbit"]').getAttribute('aria-pressed')==='true'))setCamera(false);};
  fluid.renderer.domElement.addEventListener('pointerdown',manualCamera,true);
  document.querySelector('[data-mode="orbit"]').addEventListener('click',()=>setCamera(false));
  document.querySelectorAll('.performance-panel input[type="range"],.optics-section input[type="range"],#camera-speed').forEach(paintRange);

  const paintStepLabels=()=>document.querySelectorAll('[data-step]').forEach((button,i)=>button.setAttribute('aria-label',t('ステップ {step}',{step:i+1})));
  bindTranslations();paintStepLabels();
  const removeLanguageListener=onLanguageChange(()=>{paintStepLabels();if(latestSnapshot)paintState({...latestSnapshot,error:undefined});});

  return {
    audio,camera,
    pulseVisual(strength=1){pulse=Math.max(0,Math.min(1.5,Number(strength)||0));if(pulse>0)launchWave(pulse);else waveControls.reset();},
    resetWaves(){pulse=0;waveControls.reset();},
    update(now){
      if(disposed)return;
      const dt=lastUpdate?Math.min(.1,(now-lastUpdate)/1000):1/60;lastUpdate=now;
      const bands=audio.update(now);fluid.setAudioBands?.(bands);
      pulse*=Math.exp(-dt*4.9);
      const echo=lightEcho?Math.min(1,pulse*.65+(bands.high||0)*.25+(bands.energy||0)*.12):0;
      fluid.setVesselPulse?.(pulse);fluid.setTimeScale?.(timeLens?1-Math.min(.83,pulse*.83):1);fluid.setLightPulse?.(echo);camera.setAudioEnergy?.(Math.min(1,(bands.low||0)*.6+pulse*.35));camera.update(now);
      $('.performance-panel').style.setProperty('--beat',Math.min(1,pulse));
      if(fluid.flowMode!=='vascular'&&audio.running&&!getPaused()&&now-lastAudioForce>65){getWorker()?.postMessage({type:'audio',energy:(bands.energy||0)*reactivity,low:(bands.low||0)*reactivity,mid:(bands.mid||0)*reactivity,high:(bands.high||0)*reactivity});lastAudioForce=now;}
      if(!audio.running&&lastAudioForce){getWorker()?.postMessage({type:'audio',energy:0,low:0,mid:0,high:0});lastAudioForce=0;}
      if(audio.mode!=='sequencer')document.querySelectorAll('.audio-visual i').forEach((bar,i)=>{const band=i<10?bands.low:i<22?bands.mid:bands.high;bar.style.transform=`scaleY(${.08+Math.min(1,(band||0)*1.5)*(.55+.45*Math.sin(now*.003+i*.5)**2)})`;});
    },
    getSpeedScale(){return timeLens?1-Math.min(.83,pulse*.83):1;},
    dispose(){disposed=true;waveControls.dispose();removeLanguageListener();sourceRequest++;clearTimeout(manualFlash);clearTimeout(showMessage.timer);audio.dispose();camera.dispose();document.removeEventListener('keydown',keyHandler);fluid.renderer.domElement.removeEventListener('pointerdown',manualCamera,true);},
  };
}

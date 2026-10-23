import './style.css';
import { FluidRenderer } from './fluid-renderer.js';
import { mountPerformance } from './performance-panel.js';
import { mountVascular } from './vascular-panel.js';
import { t, bindTranslations, onLanguageChange, mountLanguageSwitch } from './i18n.js';

const icons = {
  drop: '<path d="M12 2C9 7 5 10 5 15a7 7 0 0 0 14 0c0-5-4-8-7-13Z"/><path d="M8.5 14.5c-1 3 1 4 2 4"/>',
  reset: '<path d="M3 10a9 9 0 1 1 1 7M3 4v6h6"/>',
  camera: '<path d="M4 7h4l2-3h4l2 3h4v13H4Z"/><circle cx="12" cy="13" r="4"/>',
  expand: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m8 0h5v-5"/>',
  pause: '<path d="M9 5v14M15 5v14"/>',
  play: '<path d="m8 4 12 8-12 8Z"/>',
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  orbit: '<circle cx="12" cy="12" r="3"/><ellipse cx="12" cy="12" rx="11" ry="5" transform="rotate(-35 12 12)"/>',
  hand: '<path d="M8 12V5a2 2 0 0 1 4 0v6-7a2 2 0 0 1 4 0v8-5a2 2 0 0 1 4 0v8c0 5-3 7-7 7-3 0-5-2-7-5l-3-4a2 2 0 0 1 3-2l2 1Z"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 4 2c-1 .7-1.5 1-1.5 3m0 3h.01"/>',
  github: '<path d="M9 20c-5 1.5-5-2.5-7-3m14 6v-4a3.5 3.5 0 0 0-1-2.7c3.5-.4 7-1.7 7-7.5a6 6 0 0 0-1.5-4.2A5.5 5.5 0 0 0 20 0s-1.3-.4-4.3 1.6a15 15 0 0 0-7.4 0C5.3-.4 4 0 4 0a5.5 5.5 0 0 0-.5 4.6A6 6 0 0 0 2 8.8c0 5.8 3.5 7.1 7 7.5A3.5 3.5 0 0 0 8 19v4"/>',
  wave: '<path d="M2 12c4-12 6 12 10 0S18 0 22 12M2 20h20"/>',
  chevron: '<path d="m8 10 4 4 4-4"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
};
const svg = (name, cls = '') => `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || ''}</svg>`;
const presetArt = {
  cascade: '<path d="M8 9h17v12c0 12 2 25 15 28 10 3 21 1 24-3M9 15h10v10c0 16 4 24 20 27"/><path d="M10 60c13-6 28 4 45-2 5-2 9-2 15 0"/>',
  dam: '<path d="M8 54V12h22v21c0 14 8 15 18 17 8 1 15 4 20 8M13 51V17h11v18c0 17 10 20 25 21"/><path d="m8 62 60-1"/>',
  orbit: '<path d="M44 13c14 3 18 14 12 26S37 61 23 52 10 25 23 18s28 1 30 13-8 18-15 18-16-7-16-16 9-15 17-12"/><path d="M9 51c8 7 39-5 53-22"/>',
  rain: '<path d="M16 9v14m13-7v18M43 9v14m14-7v18M20 36v11m20-4v10m18-15v10M8 60c14-9 25 4 42-2 9-3 14-3 20 1"/>',
};
const presets = [
  {id:'cascade', name:'Cascade', ja:'流れ落ちる', index:'01', caption:'重力がつくる、途切れない流れ。', gravity:9.8, viscosity:0.06, turbulence:0.2},
  {id:'dam', name:'Release', ja:'解き放つ', index:'02', caption:'せき止めた水が、空間へ広がる。', gravity:9.8, viscosity:0.04, turbulence:0.12},
  {id:'orbit', name:'Orbit', ja:'無重力の渦', index:'03', caption:'重力を離れ、流れがかたちを結ぶ。', gravity:0, viscosity:0.1, turbulence:0.5},
  {id:'rain', name:'Rain', ja:'降りそそぐ', index:'04', caption:'無数のしずくが、ひとつの水面になる。', gravity:9.8, viscosity:0.03, turbulence:0.1},
];
const particleCounts = [1800,3600,6000,12000,20000,32000];
const materialNotes={water:'透明な水。光の屈折と反射を、立体として。',chrome:'鏡面が映し出す、流れる彫刻。',amber:'光を吸い込み、深く透ける琥珀。',ink:'暗い水面に、細い光が浮かぶ。',polar:'偏光する液晶。視点とともに光の帯が流れる。',abyss:'黒い液体の内側を、音の光脈が走る。',nacre:'薄膜の干渉色が、真珠のように漂う。',phase:'ひとつの水面を、鏡と透明が移り変わる。'};
const state = {flowMode:'liquid',preset:'orbit', material:'water', environment:'studio', quality:matchMedia('(max-width: 700px)').matches ? 'fast':'balanced', count:matchMedia('(max-width:700px)').matches?1800:3600, gravity:0, viscosity:0.1, turbulence:0.5, speed:1, paused:false, mode:'stir', rotate:false};

document.querySelector('#app').innerHTML = `
  <header class="header">
    <a class="brand" href="./" aria-label="ホーム"><span class="brand-symbol">${svg('drop')}</span></a>
    <div class="header-right"><span class="live-status"><i></i> INTERACTIVE 3D</span><a class="source-link" href="https://github.com/keigoyoshida7/fluid-studio" target="_blank" rel="noopener noreferrer">GitHub ${svg('arrow')}</a><button class="icon-button" id="help" aria-label="使い方">${svg('help')}</button></div>
  </header>
  <main class="workspace">
    <section class="stage" id="stage" aria-label="3D流体シミュレーション">
      <div id="viewport" aria-label="ドラッグで水をかき混ぜる3Dビュー"></div>
      <div class="stage-top-right"><span class="scene-id">SCENE <b id="scene-number">03</b> / 04</span><div class="view-actions"><button class="icon-button" id="snapshot" aria-label="画像を保存" title="画像を保存">${svg('camera')}</button><button class="icon-button" id="fullscreen" aria-label="全画面表示" title="全画面表示">${svg('expand')}</button></div></div>
      <div class="loading" id="loading"><span class="loading-orbit"></span><p>流れを準備しています</p></div>
      <div class="stage-side-label">EXPERIMENT IN THREE DIMENSIONS</div>
      <div class="stage-bottom"><div class="interaction-hint">${svg('hand')}<span id="interaction-hint">ドラッグでかき混ぜる</span><span class="hint-separator">·</span><span class="desktop-hint">スクロールで拡大</span></div><div class="axis" aria-label="3D座標軸"><span class="axis-y">Y</span><span class="axis-z">Z</span><span class="axis-x">X</span><svg viewBox="0 0 68 64"><path d="M32 36V6m0 30L8 50m24-14 26 15"/></svg></div></div>
      <div class="transport"><button id="pause" class="play-button" aria-label="一時停止">${svg('pause')}</button><span class="transport-line"></span><button id="reset" class="transport-button" title="はじめから (R)">${svg('reset')}<span>リセット</span></button><button id="impulse" class="transport-button">${svg('wave')}<span>波を起こす</span></button><div class="transport-spacer"></div><span class="frame-label"><i></i><b id="fps">—</b> FPS</span></div>
    </section>
    <aside class="controls" aria-label="シミュレーション設定">
      <div class="controls-title"><span>流れをつくる</span><span class="control-number">/ 01</span></div>
      <section class="control-section"><div class="section-label"><h2>質感</h2><span>MATERIAL</span></div><div class="materials" role="group" aria-label="流体の質感">
        ${[['water','Water','水'],['chrome','Chrome','金属'],['amber','Amber','琥珀'],['ink','Ink','インク'],['polar','Polar','偏光液晶'],['abyss','Abyss','深海の光脈'],['nacre','Nacre','干渉する光膜'],['phase','Phase','鏡と透明の相転移']].map(([id,en,ja])=>`<button class="material ${['polar','abyss','nacre','phase'].includes(id)?'experimental':''} ${state.material===id?'active':''}" data-material="${id}" aria-pressed="${state.material===id}" title="${ja}"><span class="material-orb ${id}"></span><span>${en}</span></button>`).join('')}
      </div><p id="material-note" class="material-note">${materialNotes[state.material]}</p></section>
      <section class="control-section physics-controls"><div class="section-label"><h2>ふるまい</h2><span>PHYSICS</span></div>
        <label class="slider-label" for="gravity"><span>重力</span><output id="gravity-value">9.8 <small>m/s²</small></output></label><input id="gravity" type="range" min="0" max="15" step="0.1" value="${state.gravity}" />
        <label class="slider-label" for="viscosity"><span>粘性</span><output id="viscosity-value">6 <small>%</small></output></label><input id="viscosity" type="range" min="0" max="1" step="0.01" value="${state.viscosity}" /><div class="range-legend"><span>さらさら</span><span>とろり</span></div>
        <label class="slider-label" for="turbulence"><span>渦の強さ</span><output id="turbulence-value">20 <small>%</small></output></label><input id="turbulence" type="range" min="0" max="1" step="0.01" value="${state.turbulence}" />
        <label class="slider-label" for="speed"><span>時間の速さ</span><output id="speed-value">1.00 <small>×</small></output></label><input id="speed" type="range" min="0.25" max="1.5" step="0.05" value="1" />
      </section>
      <section class="control-section"><div class="section-label"><h2>光と視点</h2><span>SCENE</span></div><label class="select-label" for="environment">ライティング</label><div class="select-wrap"><select id="environment"><option value="studio">Studio / 柔らかな光</option><option value="night">Night / 深い青</option><option value="warm">Dusk / 夕暮れ</option></select>${svg('chevron')}</div><div id="camera-controls"></div><div class="segmented" role="group" aria-label="ドラッグ操作"><button data-mode="stir" class="active" aria-pressed="true">${svg('hand')}かき混ぜる</button><button data-mode="orbit" aria-pressed="false">${svg('orbit')}視点を回す</button></div></section>
      <section class="control-section quality-section"><div class="section-label"><h2>描画品質</h2><span>QUALITY</span></div><div class="quality-options" role="group" aria-label="描画品質">${[['fast','軽量'],['balanced','標準'],['high','高精細'],['ultra','極細']].map(([id,ja])=>`<button class="${state.quality===id?'active':''}" data-quality="${id}" aria-pressed="${state.quality===id}">${ja}</button>`).join('')}</div><p class="quality-note"><span id="particle-count">3,600</span> particles <span>·</span> <span id="simulation-status">実行中</span></p><label class="slider-label particle-detail-label" for="particle-detail"><span>粒子の細かさ</span><output id="particle-detail-value">${state.count.toLocaleString()} <small>粒</small></output></label><input id="particle-detail" type="range" min="0" max="5" step="1" value="${particleCounts.indexOf(state.count)}" /><div class="range-legend"><span>1,800</span><span>32,000</span></div><p class="particle-detail-note">粒子数と水面の解像度を独立して選べます。<br>極細では水の時間がゆっくり進むことがあります。</p></section>
      <div class="controls-footer"><span class="tiny-cross">+</span><p>流れには、同じ瞬間がない。<br><span>Every moment, a new form.</span></p></div>
    </aside>
    <section class="presets-section" aria-label="シーンを選ぶ"><div class="presets-intro"><span class="eyebrow">START WITH A FLOW</span><h2>流れのかたち</h2><span class="preset-sub">4つのシーンから、自由に。</span></div><div class="presets">${presets.map(p=>`<button class="preset ${p.id===state.preset?'active':''}" data-preset="${p.id}" aria-pressed="${p.id===state.preset}"><div class="preset-art"><svg viewBox="0 0 80 72" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">${presetArt[p.id]}</svg></div><div class="preset-copy"><span class="preset-index">${p.index}</span><span class="preset-name">${p.name}</span><span class="preset-ja">${p.ja}</span></div><span class="preset-arrow">↗</span></button>`).join('')}</div></section>
  </main>
  <footer class="footer"><span>Simulated in your browser. Shaped by you.</span><button id="about-footer">この実験について ${svg('arrow')}</button></footer>
  <div class="toast" id="toast" role="status" aria-live="polite"></div>
  <dialog id="help-dialog" aria-labelledby="guide-title"><div class="dialog-head"><span class="eyebrow">A LITTLE GUIDE</span><button class="icon-button" id="close-help" aria-label="閉じる">${svg('close')}</button></div><h2 id="guide-title">流れと、遊ぶ。</h2><p>水面をドラッグして流れをつくり、重力や粘性を変えてみてください。視点を回すと、奥行きのある水のかたちが見えてきます。</p><div class="help-row"><span>ドラッグ</span><span>水をかき混ぜる / 視点を回す</span></div><div class="help-row"><span>スクロール / ピンチ</span><span>拡大・縮小</span></div><div class="help-row"><span><kbd>Space</kbd> / <kbd>R</kbd></span><span>一時停止 / リセット</span></div><div class="help-row"><span><kbd>H</kbd></span><span>このガイドを開く</span></div><div class="help-row"><span><kbd>K</kbd></span><span>キックを鳴らして水を動かす</span></div><p class="technical-note">Position Based Fluids による3D粒子計算から、滑らかな立体の水面を再構成しています。落下・衝突・圧力・粘性をリアルタイムに計算します。CascadeとRainは水を循環させます。研究・映像制作向けのオフラインソルバーとは精度・解像度が異なります。</p><p class="dialog-foot">WebGL 2 対応のブラウザを推奨。動きが重いときは描画品質を「軽量」に。</p><a class="dialog-source" href="https://github.com/keigoyoshida7/fluid-studio" target="_blank" rel="noopener noreferrer">ソースコードを開く ${svg('arrow')}</a></dialog>
`;

const $ = s => document.querySelector(s);
let toastSource='', failureMessage='';
const toast = message => { toastSource=message; $('#toast').dataset.i18nMessage=message; $('#toast').textContent = t(message); $('#toast').classList.add('visible'); clearTimeout(toast.timer); toast.timer = setTimeout(()=>$('#toast').classList.remove('visible'),3500); };
let fluid, worker, pending = false, ready = false, frameCount = 0, receivedFrames = 0, lastFps = performance.now(), simulationTime = 0, stepDuration = 0, lastStepSent = 0;
let impulseTimer, performancePanel, vascularPanel;

function updateRange(id) {
  const input = $(`#${id}`); const value = Number(input.value); state[id] = value;
  input.style.setProperty('--fill', `${(value-Number(input.min))/(Number(input.max)-Number(input.min))*100}%`);
  const content = id==='gravity' ? `${value.toFixed(1)} <small>m/s²</small>` : id==='speed' ? `${value.toFixed(2)} <small>×</small>` : `${Math.round(value*100)} <small>%</small>`;
  $(`#${id}-value`).innerHTML = content;
  if(worker) worker.postMessage({type:'params', gravity:state.gravity, viscosity:state.viscosity, turbulence:state.turbulence, speed:state.speed});
}
function selectButtons(selector, key, value) { document.querySelectorAll(selector).forEach(button=>{ const active=button.dataset[key]===value; button.classList.toggle('active',active); button.setAttribute('aria-pressed',String(active)); }); }
function resetSimulation() {
  performancePanel?.resetWaves?.();fluid?.resetWaves?.();
  if(state.flowMode==='vascular'){fluid?.resetVessel?.();performancePanel?.pulseVisual?.(0);return;}
  if(!worker) return;
  ready=false; pending=true; simulationTime=0; lastStepSent=0; $('#loading').hidden=false;
  worker.postMessage({type:'pointer',active:false});
  worker.postMessage({type:'reset', preset:state.preset, count:state.count});
  worker.postMessage({type:'params',gravity:state.gravity,viscosity:state.viscosity,turbulence:state.turbulence,speed:state.speed});
}
function setPaused(value) { state.paused=value;fluid?.setPaused(value); if(value)worker?.postMessage({type:'pointer',active:false});lastStepSent=0; $('#pause').innerHTML=svg(value?'play':'pause'); $('#pause').setAttribute('aria-label',t(value?'再生':'一時停止')); $('#simulation-status').textContent=t(value?'一時停止中':'実行中'); $('#pause').classList.toggle('is-paused',value); }
function setMode(mode) { state.mode=mode; fluid?.setInteractionMode(mode); selectButtons('[data-mode]','mode',mode); $('#interaction-hint').textContent=t(mode==='stir'?'ドラッグでかき混ぜる':'ドラッグで視点を回す'); $('#viewport').classList.toggle('orbit-mode',mode==='orbit'); }

['gravity','viscosity','turbulence','speed'].forEach(id=>{const input=$(`#${id}`);input.addEventListener('input',()=>updateRange(id));updateRange(id);});
const detailInput=$('#particle-detail');
const previewDetail=()=>{const count=particleCounts[Number(detailInput.value)];$('#particle-detail-value').innerHTML=`${count.toLocaleString()} <small>${t('粒')}</small>`;detailInput.style.setProperty('--fill',`${Number(detailInput.value)/5*100}%`);};
detailInput.addEventListener('input',previewDetail);detailInput.addEventListener('change',()=>{state.count=particleCounts[Number(detailInput.value)];resetSimulation();});previewDetail();
document.querySelectorAll('[data-preset]').forEach(button=>button.addEventListener('click',()=>{
  if(state.flowMode!=='liquid')vascularPanel?.setMode('liquid');
  const preset=presets.find(p=>p.id===button.dataset.preset); state.preset=preset.id; selectButtons('[data-preset]','preset',preset.id);
  $('#scene-number').textContent=preset.index;
  for(const key of ['gravity','viscosity','turbulence']) { $(`#${key}`).value=preset[key]; updateRange(key); }
  setPaused(false); resetSimulation();
}));
document.querySelectorAll('[data-material]').forEach(button=>button.addEventListener('click',()=>{ state.material=button.dataset.material;selectButtons('[data-material]','material',state.material);fluid?.setMaterial(state.material);$('#material-note').textContent=t(materialNotes[state.material]); }));
document.querySelectorAll('[data-quality]').forEach(button=>button.addEventListener('click',()=>{
  if(state.quality===button.dataset.quality)return;
  state.quality=button.dataset.quality;selectButtons('[data-quality]','quality',state.quality);fluid?.setQuality(state.quality);
}));
document.querySelectorAll('[data-mode]').forEach(button=>button.addEventListener('click',()=>setMode(button.dataset.mode)));
$('#environment').addEventListener('change',event=>{state.environment=event.target.value;fluid?.setEnvironment(state.environment);});

$('#pause').addEventListener('click',()=>setPaused(!state.paused));
$('#reset').addEventListener('click',()=>{resetSimulation();toast('流れをリセットしました');});
$('#impulse').addEventListener('click',()=>{
  if(!worker)return; setPaused(false);
  if(state.flowMode==='vascular'){performancePanel?.pulseVisual?.(1.4);return;}
  worker.postMessage({type:'pointer',active:true,position:[0,state.preset==='orbit'?1.7:0.45,0],force:[2.2,4.2,0.5]});clearTimeout(impulseTimer);
  impulseTimer=setTimeout(()=>worker?.postMessage({type:'pointer',active:false,position:[0,0.75,0],force:[0,0,0]}),400);
});
$('#snapshot').addEventListener('click',()=>{
  try { const url=fluid.capture();const link=document.createElement('a');link.href=url;link.download=`fluid-${state.preset}-${Date.now()}.png`;link.click();toast('画像を保存しました'); }catch{toast('画像を保存できませんでした');}
});
$('#fullscreen').addEventListener('click',async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else if($('#stage').requestFullscreen)await $('#stage').requestFullscreen();else toast('このブラウザでは全画面表示に対応していません');}catch{toast('全画面表示を開始できませんでした');}});
const showHelp=()=>$('#help-dialog').showModal();$('#help').addEventListener('click',showHelp);$('#about-footer').addEventListener('click',showHelp);$('#close-help').addEventListener('click',()=>$('#help-dialog').close());
$('#help-dialog').addEventListener('click',event=>{if(event.target===$('#help-dialog')){const r=event.target.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)event.target.close();}});
document.addEventListener('keydown',event=>{if(event.target.matches('input,select,textarea')||$('#help-dialog').open)return;if(event.code==='Space'){event.preventDefault();setPaused(!state.paused);}if(event.key.toLowerCase()==='r')resetSimulation();if(event.key.toLowerCase()==='h')showHelp();});

function fail(message) { failureMessage=message; $('#loading').hidden=false;$('#loading').innerHTML=`<span class="error-symbol">↗</span><p>${t(message)}</p><button class="error-retry">${t('再読み込み')}</button>`;$('#loading .error-retry').addEventListener('click',()=>location.reload());$('#simulation-status').textContent=t('起動できませんでした'); }
mountLanguageSwitch();
onLanguageChange(()=>{
  $('#material-note').textContent=t(materialNotes[state.material]);
  setPaused(state.paused);setMode(state.mode);previewDetail();
  if($('#toast').classList.contains('visible'))$('#toast').textContent=t($('#toast').dataset.i18nMessage||toastSource);
  if(failureMessage)fail(failureMessage);
});

try {
  fluid=new FluidRenderer($('#viewport'),{onInteract:data=>{if(!state.paused||!data.active)worker?.postMessage({type:'pointer',...data});}});
  fluid.setQuality(state.quality);fluid.setMaterial(state.material);setMode(state.mode);
  worker=new Worker(new URL('./physics-worker.js',import.meta.url),{type:'module'});
  worker.onmessage=({data})=>{
    if(data.type==='ready') {ready=true;pending=true;$('#particle-count').textContent=Number(data.count).toLocaleString('en-US');if(data.renderRadius)fluid.setParticleRadius(data.renderRadius);}
    if(data.type==='frame') {fluid.setSimulationTime?.(data.simTime);stepDuration=data.stepMs ?? 0;pending=false;ready=true;receivedFrames++;simulationTime=data.simTime ?? simulationTime;fluid.setParticles(data.positions,data.count);if(data.renderRadius)fluid.setParticleRadius(data.renderRadius);$('#loading').hidden=true;}
    if(data.type==='error'){pending=false;fail(data.message||'流体計算を開始できませんでした');}
  };
  worker.onerror=()=>{pending=false;fail('流体計算を開始できませんでした。再読み込みしてください。');};
  worker.postMessage({type:'init',count:state.count,preset:state.preset});
  worker.postMessage({type:'params',gravity:state.gravity,viscosity:state.viscosity,turbulence:state.turbulence,speed:state.speed});
  performancePanel=mountPerformance({fluid,getWorker:()=>worker,getPaused:()=>state.paused,getPreset:()=>state.preset,onResume:()=>setPaused(false)});
  vascularPanel=mountVascular({fluid,onMode:mode=>{state.flowMode=mode;lastStepSent=0;worker.postMessage({type:'clear-effects'});performancePanel?.resetWaves?.();setPaused(false);setMode(mode==='vascular'?'orbit':'stir');}});
  let lastTime=performance.now();
  function animate(now) {
    requestAnimationFrame(animate);
    if(document.hidden){lastTime=now;return;}
    const dt=Math.min((now-lastTime)/1000,1/30);lastTime=now;
    performancePanel.update(now);
    if(state.flowMode==='liquid'&&ready&&!pending&&(!state.paused||receivedFrames===0)) {pending=true;const stepDt=lastStepSent?Math.min((now-lastStepSent)/1000,1/30):1/60;lastStepSent=now;worker.postMessage({type:'step',dt:Math.max(1/360,stepDt*performancePanel.getSpeedScale())});}
    fluid.render(now);frameCount++;
    if(now-lastFps>1000){$('#fps').textContent=String(Math.round(frameCount*1000/(now-lastFps)));frameCount=0;lastFps=now;}
  }
  requestAnimationFrame(animate);
  document.addEventListener('visibilitychange',()=>{lastStepSent=0;if(document.hidden)worker.postMessage({type:'pointer',active:false});});
  window.addEventListener('pagehide',()=>{vascularPanel?.dispose();performancePanel?.dispose();worker.terminate();fluid.dispose();},{once:true});
  window.fluidLab={ get state(){return {...state};}, get stats(){return {receivedFrames,simulationTime,stepDuration,pending,ready};}, get renderer(){return fluid;},get performance(){return performancePanel;}, reset:resetSimulation };
} catch(error) {console.error(error);fail('WebGL 2 に対応したブラウザで開いてください。');}

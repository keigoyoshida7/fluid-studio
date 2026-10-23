import { translations, bindTranslations } from './i18n.js';

for(const [ja,en] of [
  ['流れのモデル','Flow model'],['自由な水','Free liquid'],['血管拡張','Vasodilation'],
  ['水の毛細管','Water capillaries'],['網の広がり','Spatial spread'],['枝の密度','Branch density'],['張力','Tension'],['自律活動','Autonomy'],['水の色','Water palette'],
  ['管の太さ','Lumen size'],['枝を再生成','Regenerate branches'],['枝のかたちを更新しました','Branch structure regenerated'],['内部の粒','Flow detail'],['流速','Flow speed'],
  ['白銀','Silver'],['深紅','Crimson'],['黒鉛','Graphite'],['素材に連動','Follow material'],
  ['透明な管の内側を、細かな水の流れが巡る。','Fine currents travel inside transparent capillaries.'],
  ['枝から枝へ流れがつながり、音で局所的に脈動する。','Continuous currents branch at junctions. Sound adds local pulsation.'],
  ['糸を伝う。波がひらく。','Along the threads, the wave unfolds.'],
])translations[ja]={ja,en};

export function mountVascular({fluid,onMode,initialMode='vascular'}){
  document.querySelector('.controls-title').insertAdjacentHTML('afterend',`
    <section class="control-section vascular-section" aria-label="流れのモデル"><div class="section-label"><h2>流れのモデル</h2><span>FLOW STUDY</span></div><div class="flow-models" role="group" aria-label="流れのモデル"><button data-flow-model="liquid" class="active" aria-pressed="true">自由な水</button><button data-flow-model="vascular" aria-pressed="false">Vasodilation</button></div><div id="vessel-settings" hidden><div class="network-heading"><span>CAPILLARY / INNER FLOW</span><h3>水の毛細管</h3></div><p class="vessel-caption">透明な管の内側を、細かな水の流れが巡る。</p><button id="regenerate-capillaries" class="regenerate-capillaries">枝を再生成 <span aria-hidden="true">↻</span></button>
      ${[['capillary-lumen','管の太さ',.55],['tracer-density','内部の粒',.72],['vessel-flow','流速',.55],['network-density','枝の密度',1],['network-tension','張力',.68],['vessel-dilation','網の広がり',.55],['network-autonomy','自律活動',.45]].map(([id,label,value])=>`<label class="slider-label" for="${id}"><span>${label}</span><output id="${id}-output">${Math.round(value*100)}%</output></label><input id="${id}" type="range" min="0" max="1" step="0.01" value="${value}"/>`).join('')}
      <label class="select-label network-palette-label" for="network-palette">水の色</label><div class="select-wrap"><select id="network-palette"><option value="silver">白銀</option><option value="crimson">深紅</option><option value="graphite">黒鉛</option><option value="material" selected>素材に連動</option></select></div><p class="vessel-detail-note">枝から枝へ流れがつながり、音で局所的に脈動する。</p></div></section>`);
  const $=s=>document.querySelector(s);
  let mode='liquid';
  function setMode(next){
    mode=next;fluid.setFlowMode(next);
    document.querySelectorAll('[data-flow-model]').forEach(button=>{const active=button.dataset.flowModel===next;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));});
    $('#vessel-settings').hidden=next!=='vascular';
    $('.scene-id').hidden=next==='vascular';
    $('.physics-controls').hidden=next==='vascular';$('.quality-section').hidden=next==='vascular';
    $('#loading').hidden=true;
    onMode(next);
  }
  document.querySelectorAll('[data-flow-model]').forEach(button=>button.addEventListener('click',()=>setMode(button.dataset.flowModel)));
  for(const [id,method]of[['capillary-lumen','setCapillaryLumen'],['tracer-density','setTracerDensity'],['vessel-flow','setVesselFlow'],['vessel-dilation','setVesselDilation'],['network-density','setNetworkDensity'],['network-tension','setNetworkTension'],['network-autonomy','setNetworkAutonomy']]){
    const input=$(`#${id}`);const paint=()=>{const v=Number(input.value);$(`#${id}-output`).textContent=`${Math.round(v*100)}%`;input.style.setProperty('--fill',`${v*100}%`);fluid[method]?.(v);};input.addEventListener('input',paint);paint();
  }
  $('#regenerate-capillaries').addEventListener('click',()=>fluid.regenerateCapillaries?.());
  $('#network-palette').addEventListener('change',event=>fluid.setNetworkPalette?.(event.target.value));fluid.setNetworkPalette?.('material');
  const mobile=matchMedia('(max-width:700px)');
  const section=$('.vascular-section');
  const place=()=>{if(mobile.matches){$('.performance-panel').before(section);}else{$('.controls-title').after(section);}};
  mobile.addEventListener('change',place);place();
  bindTranslations(section);
  setMode(initialMode);
  return {get mode(){return mode;},setMode,dispose(){mobile.removeEventListener('change',place);}};
}

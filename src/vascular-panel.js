import { translations, bindTranslations } from './i18n.js';

for(const [ja,en] of [
  ['流れのモデル','Flow model'],['自由な水','Free liquid'],['血管拡張','Vasodilation'],
  ['糸状の神経網','Filament network'],['網の広がり','Spatial spread'],['糸の密度','Filament density'],['張力','Tension'],['自律活動','Autonomy'],['糸の色','Filament palette'],
  ['白銀','Silver'],['深紅','Crimson'],['黒鉛','Graphite'],['素材に連動','Follow material'],
  ['細い糸を張りめぐらせ、音の波を枝から枝へ。','Weave fine threads. Let sound travel from branch to branch.'],
  ['空洞と張力、伝播する光。非有機的な網が、微かに生きている。','Voids, tension and traveling light. An inorganic network, faintly alive.'],
  ['糸を伝う。波がひらく。','Along the threads, the wave unfolds.'],
])translations[ja]={ja,en};

export function mountVascular({fluid,onMode,initialMode='vascular'}){
  document.querySelector('.controls-title').insertAdjacentHTML('afterend',`
    <section class="control-section vascular-section" aria-label="流れのモデル"><div class="section-label"><h2>流れのモデル</h2><span>FLOW STUDY</span></div><div class="flow-models" role="group" aria-label="流れのモデル"><button data-flow-model="liquid" class="active" aria-pressed="true">自由な水</button><button data-flow-model="vascular" aria-pressed="false">Vasodilation</button></div><div id="vessel-settings" hidden><div class="network-heading"><span>FILAMENT / RESONANCE</span><h3>糸状の神経網</h3></div><p class="vessel-caption">細い糸を張りめぐらせ、音の波を枝から枝へ。</p>
      ${[['network-density','糸の密度',.84],['network-tension','張力',.72],['vessel-dilation','網の広がり',.55],['network-autonomy','自律活動',.30]].map(([id,label,value])=>`<label class="slider-label" for="${id}"><span>${label}</span><output id="${id}-output">${Math.round(value*100)}%</output></label><input id="${id}" type="range" min="0" max="1" step="0.01" value="${value}"/>`).join('')}
      <label class="select-label network-palette-label" for="network-palette">糸の色</label><div class="select-wrap"><select id="network-palette"><option value="silver">白銀</option><option value="crimson">深紅</option><option value="graphite">黒鉛</option><option value="material">素材に連動</option></select></div><p class="vessel-detail-note">空洞と張力、伝播する光。非有機的な網が、微かに生きている。</p></div></section>`);
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
  for(const [id,method]of[['vessel-dilation','setVesselDilation'],['network-density','setNetworkDensity'],['network-tension','setNetworkTension'],['network-autonomy','setNetworkAutonomy']]){
    const input=$(`#${id}`);const paint=()=>{const v=Number(input.value);$(`#${id}-output`).textContent=`${Math.round(v*100)}%`;input.style.setProperty('--fill',`${v*100}%`);fluid[method]?.(v);};input.addEventListener('input',paint);paint();
  }
  $('#network-palette').addEventListener('change',event=>fluid.setNetworkPalette?.(event.target.value));fluid.setNetworkPalette?.('silver');
  const mobile=matchMedia('(max-width:700px)');
  const section=$('.vascular-section');
  const place=()=>{if(mobile.matches){$('.performance-panel').before(section);}else{$('.controls-title').after(section);}};
  mobile.addEventListener('change',place);place();
  bindTranslations(section);
  setMode(initialMode);
  return {get mode(){return mode;},setMode,dispose(){mobile.removeEventListener('change',place);}};
}

import { translations, t, bindTranslations, onLanguageChange } from './i18n.js';

for(const [ja,en] of [
  ['流れのモデル','Flow model'],['自由な水','Free liquid'],['血管拡張','Vasodilation'],
  ['管の広がり','Vessel dilation'],['流れの速さ','Flow speed'],
  ['管をゆっくり広げ、キックで拍動を加える。','Open the vessel slowly. Let each kick add a pulse.'],
  ['血管拡張と拍動をモチーフにした、軽量な3D表現です。','A lightweight artistic study of vessel dilation and pulsatile flow.'],
  ['管をひらく。流れを探る。','Open the vessel. Explore the flow.'],
])translations[ja]={ja,en};

export function mountVascular({fluid,onMode}){
  document.querySelector('.controls-title').insertAdjacentHTML('afterend',`
    <section class="control-section vascular-section" aria-label="流れのモデル"><div class="section-label"><h2>流れのモデル</h2><span>FLOW STUDY</span></div><div class="flow-models" role="group" aria-label="流れのモデル"><button data-flow-model="liquid" class="active" aria-pressed="true">自由な水</button><button data-flow-model="vascular" aria-pressed="false">Vasodilation</button></div><div id="vessel-settings" hidden><p class="vessel-caption">管をゆっくり広げ、キックで拍動を加える。</p><label class="slider-label" for="vessel-dilation"><span>管の広がり</span><output id="vessel-dilation-output">35%</output></label><input id="vessel-dilation" type="range" min="0" max="1" step="0.01" value="0.35"/><label class="slider-label" for="vessel-flow"><span>流れの速さ</span><output id="vessel-flow-output">45%</output></label><input id="vessel-flow" type="range" min="0" max="1" step="0.01" value="0.45"/><p class="vessel-detail-note">血管拡張と拍動をモチーフにした、軽量な3D表現です。</p></div></section>`);
  const $=s=>document.querySelector(s);
  let mode='liquid';
  function setMode(next){
    mode=next;fluid.setFlowMode(next);
    document.querySelectorAll('[data-flow-model]').forEach(button=>{const active=button.dataset.flowModel===next;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));});
    $('#vessel-settings').hidden=next!=='vascular';
    $('.scene-id').hidden=next==='vascular';
    $('.physics-controls').hidden=next==='vascular';$('.quality-section').hidden=next==='vascular';
    $('#loading').hidden=true;
    if(next==='vascular')$('#preset-caption').textContent=t('管をひらく。流れを探る。');
    onMode(next);
  }
  document.querySelectorAll('[data-flow-model]').forEach(button=>button.addEventListener('click',()=>setMode(button.dataset.flowModel)));
  for(const [id,method]of[['vessel-dilation','setVesselDilation'],['vessel-flow','setVesselFlow']]){
    const input=$(`#${id}`);const paint=()=>{const v=Number(input.value);$(`#${id}-output`).textContent=`${Math.round(v*100)}%`;input.style.setProperty('--fill',`${v*100}%`);fluid[method](v);};input.addEventListener('input',paint);paint();
  }
  document.querySelectorAll('[data-preset]').forEach(button=>button.addEventListener('click',()=>{if(mode==='vascular')setMode('liquid');}));
  const mobile=matchMedia('(max-width:700px)');
  const section=$('.vascular-section');
  const place=()=>{if(mobile.matches){$('.performance-panel').before(section);}else{$('.controls-title').after(section);}};
  mobile.addEventListener('change',place);place();
  bindTranslations(section);
  const unsubscribe=onLanguageChange(()=>{if(mode==='vascular')$('#preset-caption').textContent=t('管をひらく。流れを探る。');});
  return {get mode(){return mode;},dispose(){mobile.removeEventListener('change',place);unsubscribe();}};
}

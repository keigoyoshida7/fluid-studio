import { translations, bindTranslations } from './i18n.js';

for(const [ja,en]of[
  ['波動の伝わり方','Wave propagation'],['音の衝撃を、距離と遅れをもつ波に。','A shock becomes a wave with distance and delay.'],
  ['伝播速度','Propagation speed'],['波の余韻','Wave afterglow'],['波の起点','Excitation point'],
  ['左から','From the left'],['中心から','From the center'],['巡回する','Moving sources'],
  ['低音で脈を送り、中高音で水の微振動を変える。','Bass launches pulses; higher frequencies change the water’s microvibrations.'],
])translations[ja]={ja,en};

export function mountWaveControls({fluid,getWorker,getPreset}){
  document.querySelector('.performance-experiments').insertAdjacentHTML('beforebegin',`
    <section class="wave-controls" aria-label="波動の伝わり方"><div class="wave-controls-heading"><span class="eyebrow">PROPAGATION / DISTANCE × TIME</span><h3>波動の伝わり方</h3><p>音の衝撃を、距離と遅れをもつ波に。</p></div><div class="wave-knobs"><div class="performance-knob"><label for="wave-speed">伝播速度 <output id="wave-speed-output">38%</output></label><input id="wave-speed" type="range" min="0" max="1" step="0.01" value="0.38" /></div><div class="performance-knob"><label for="wave-afterglow">波の余韻 <output id="wave-afterglow-output">76%</output></label><input id="wave-afterglow" type="range" min="0" max="1" step="0.01" value="0.76" /></div><div class="wave-origin"><label class="select-label" for="wave-origin">波の起点</label><div class="select-wrap"><select id="wave-origin"><option value="left">左から</option><option value="center">中心から</option><option value="moving">巡回する</option></select></div></div></div><p class="wave-band-note">低音で脈を送り、中高音で水の微振動を変える。</p></section>`);
  const $=s=>document.querySelector(s);
  let speed=.38, afterglow=.76, sourceMode='left', serial=0;
  const apply=()=>{
    const params={speed:.8+speed*4.2,strength:.86,damping:1-afterglow};
    fluid.setWaveParams?.(params);fluid.setNetworkAfterglow?.(afterglow);
    getWorker()?.postMessage({type:'params',params:{waveSpeed:params.speed,waveStrength:params.strength,waveDamping:params.damping}});
  };
  for(const [id,set]of[['wave-speed',value=>speed=value],['wave-afterglow',value=>afterglow=value]]){
    const input=$(`#${id}`);const paint=()=>{const value=Number(input.value);set(value);$(`#${id}-output`).textContent=`${Math.round(value*100)}%`;input.style.setProperty('--fill',`${value*100}%`);apply();};input.addEventListener('input',paint);paint();
  }
  $('#wave-origin').addEventListener('change',event=>sourceMode=event.target.value);
  bindTranslations($('.wave-controls'));
  return {
    getSource(step=-1){
      const network=fluid.flowMode==='vascular';const orbit=getPreset()==='orbit';
      if(sourceMode==='center')return[0,network?1.6:orbit?1.7:.32,0];
      if(sourceMode==='left')return network?[-1.65,1.55,-.15]:[-.68,orbit?1.65:.3,0];
      const index=step>=0?Math.floor(step/4)%4:serial++%4;
      const sources=network?[[-1.65,.85,-.55],[1.65,2.65,.45],[-1.5,2.85,.7],[1.5,.5,-.75]]:[[-.68,orbit?1.65:.3,0],[.65,orbit?1.8:.3,.2],[0,orbit?2.2:.3,-.55],[0,orbit?1.1:.3,.55]];
      return sources[index];
    },
    reset(){serial=0;fluid.resetWaves?.();apply();},
    dispose(){},
  };
}

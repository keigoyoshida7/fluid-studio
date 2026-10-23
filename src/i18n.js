// Local, explicit bilingual copy. Numeric readouts and user filenames stay intact.
const entries = [
  ['FLUID ホーム','FLUID home'], ['使い方','Help'], ['3D流体シミュレーション','3D fluid simulation'], ['ドラッグで水をかき混ぜる3Dビュー','3D view: drag to stir the water'],
  ['流体を、','Touch the'], ['触る。','flow.'], ['画像を保存','Save image'], ['全画面表示','Fullscreen'], ['流れを準備しています','Preparing the flow'],
  ['ドラッグでかき混ぜる','Drag to stir'], ['ドラッグで視点を回す','Drag to orbit'], ['スクロールで拡大','Scroll to zoom'], ['3D座標軸','3D coordinate axes'],
  ['一時停止','Pause'], ['再生','Play'], ['はじめから (R)','Reset (R)'], ['リセット','Reset'], ['波を起こす','Make waves'], ['シミュレーション設定','Simulation settings'],
  ['流れをつくる','Shape the flow'], ['質感','Material'], ['流体の質感','Fluid material'], ['水','Water'], ['金属','Chrome'], ['琥珀','Amber'], ['インク','Ink'], ['偏光液晶','Polar liquid crystal'], ['深海の光脈','Abyssal light veins'], ['干渉する光膜','Interference film'], ['鏡と透明の相転移','Mirror / transparency phase transition'],
  ['透明な水。光の屈折と反射を、立体として。','Clear water, shaped by refracted and reflected light.'],
  ['鏡面が映し出す、流れる彫刻。','A flowing sculpture reflecting its surroundings.'],
  ['光を吸い込み、深く透ける琥珀。','Amber that absorbs light and reveals its depth.'],
  ['暗い水面に、細い光が浮かぶ。','Fine highlights floating on dark liquid.'],
  ['偏光する液晶。視点とともに光の帯が流れる。','Polar liquid crystal: bands of light shift with your viewpoint.'],
  ['黒い液体の内側を、音の光脈が走る。','Veins of sound-driven light travel through black liquid.'],
  ['薄膜の干渉色が、真珠のように漂う。','Thin-film interference colors drift like liquid pearl.'],
  ['ひとつの水面を、鏡と透明が移り変わる。','A single surface shifting between mirror and transparency.'],
  ['ふるまい','Behavior'], ['重力','Gravity'], ['粘性','Viscosity'], ['さらさら','Fluid'], ['とろり','Viscous'], ['渦の強さ','Turbulence'], ['時間の速さ','Time scale'],
  ['光と視点','Light & viewpoint'], ['ライティング','Lighting'], ['Studio / 柔らかな光','Studio / Soft light'], ['Night / 深い青','Night / Deep blue'], ['Dusk / 夕暮れ','Dusk / Warm glow'], ['ドラッグ操作','Drag interaction'], ['かき混ぜる','Stir'], ['視点を回す','Orbit'],
  ['描画品質','Render quality'], ['軽量','Fast'], ['標準','Balanced'], ['高精細','High'], ['極細','Ultra'], ['実行中','Running'], ['一時停止中','Paused'], ['粒子の細かさ','Particle detail'], ['粒','particles'], ['particles','particles'],
  ['粒子数と水面の解像度を独立して選べます。','Choose particle count and surface resolution independently.'],
  ['極細では水の時間がゆっくり進むことがあります。','Ultra detail may slow simulation time on your device.'],
  ['流れには、同じ瞬間がない。','No two moments of flow are alike.'], ['シーンを選ぶ','Choose a scene'], ['流れのかたち','Forms of flow'], ['4つのシーンから、自由に。','Explore four starting scenes.'],
  ['流れ落ちる','Falling water'], ['解き放つ','Release the water'], ['無重力の渦','A weightless vortex'], ['降りそそぐ','Falling rain'],
  ['重力がつくる、途切れない流れ。','An unbroken flow, shaped by gravity.'], ['せき止めた水が、空間へ広がる。','Held water opens into space.'], ['重力を離れ、流れがかたちを結ぶ。','Free from gravity, the flow finds its form.'], ['無数のしずくが、ひとつの水面になる。','Countless drops become a single surface.'],
  ['この実験について','About this experiment'], ['閉じる','Close'], ['流れと、遊ぶ。','Play with the flow.'],
  ['水面をドラッグして流れをつくり、重力や粘性を変えてみてください。視点を回すと、奥行きのある水のかたちが見えてきます。','Drag the surface to stir the flow, then adjust gravity and viscosity. Orbit the camera to explore the water in three dimensions.'],
  ['ドラッグ','Drag'], ['水をかき混ぜる / 視点を回す','Stir water / Orbit the camera'], ['スクロール / ピンチ','Scroll / Pinch'], ['拡大・縮小','Zoom in / out'], ['一時停止 / リセット','Pause / Reset'], ['このガイドを開く','Open this guide'], ['キックを鳴らして水を動かす','Play a kick and move the water'],
  ['Position Based Fluids による3D粒子計算から、滑らかな立体の水面を再構成しています。落下・衝突・圧力・粘性をリアルタイムに計算します。CascadeとRainは水を循環させます。研究・映像制作向けのオフラインソルバーとは精度・解像度が異なります。','A smooth 3D surface is reconstructed from a Position Based Fluids particle simulation. Gravity, collisions, pressure and viscosity are calculated in real time. Cascade and Rain recirculate water. Accuracy and resolution differ from offline solvers used for research and film production.'],
  ['WebGL 2 対応のブラウザを推奨。動きが重いときは描画品質を「軽量」に。','Use a browser with WebGL 2. If motion becomes slow, set render quality to Fast.'], ['ソースコードを開く','Open source code'],
  ['流れをリセットしました','Flow reset'], ['画像を保存しました','Image saved'], ['画像を保存できませんでした','Could not save the image'], ['このブラウザでは全画面表示に対応していません','Fullscreen is unavailable in this browser'], ['全画面表示を開始できませんでした','Could not enter fullscreen'], ['再読み込み','Reload'], ['起動できませんでした','Could not start'], ['流体計算を開始できませんでした','Could not start the fluid simulation'], ['流体計算を開始できませんでした。再読み込みしてください。','Could not start the fluid simulation. Please reload.'], ['WebGL 2 に対応したブラウザで開いてください。','Please open this page in a browser with WebGL 2.'],
  ['音と流体のパフォーマンス','Sound and fluid performance'], ['流れを、演奏する。','Perform the flow.'], ['低音が水を動かし、光が余韻を描く。','Bass moves the water. Light traces its resonance.'], ['音を再生','Play sound'], ['音を停止','Stop sound'], ['音をはじめる','Start sound'], ['音を止める','Stop sound'], ['音の入力','Audio source'], ['音源を読み込む','Load audio'], ['マイク入力','Microphone'], ['16ステップのキックシーケンサー','16-step kick sequencer'], ['ステップ {step}','Step {step}'], ['タップでキックを配置','Tap to place kicks'], ['音と同じ時計で、流れを刻む。','One clock for the sound and the flow.'], ['低音の立ち上がりを検出し、流体へ伝えます。','Bass onsets are detected and transferred to the fluid.'], ['選んだ音源は端末内だけで再生・解析されます。','Your audio is played and analyzed only on your device.'], ['テンポ BPM','Tempo BPM'], ['数回タップしてテンポを指定','Tap several times to set the tempo'], ['スウィング','Swing'], ['水への強さ','Fluid response'], ['音量','Volume'], ['音への反応','Audio reaction'], ['音で水を彫る','Sculpt water with sound'], ['鼓動','Beat'], ['旋回','Swirl'], ['浮遊','Float'], ['時のレンズ','Time lens'], ['キックの瞬間をスローモーションに','Slow down the moment of each kick'], ['光の余韻','Light echo'], ['水と光が、同じ音を聴く','Water and light listen to the same sound'], ['水と光の密度','Water & light'], ['表面の滑らかさ','Surface smoothness'], ['透明感','Clarity'], ['光の分散','Dispersion'], ['カメラ位置をモーフィング','Morph camera position'], ['カメラワーク','Camera movement'], ['Drift / 浮かぶ視線','Drift / Floating viewpoint'], ['Orbit / まわり込む','Orbit / Circling the flow'], ['Intimate / 水に近づく','Intimate / Close to the water'], ['移動の速さ','Movement speed'], ['カメラの自動移動','Automatic camera movement'],
  ['MIC / 入力音を聴いています','MIC / Listening'], ['MIC / 許可を待っています','MIC / Waiting for permission'], ['MIC / 停止中','MIC / Stopped'], ['音源を選んでください','Choose an audio file'], ['マイクで聴いた低音が、水の動きになります。','Bass heard through the microphone becomes motion in the water.'], ['音を開始できませんでした','Could not start audio'], ['入力を開始できませんでした','Could not start the audio input'], ['この音源を読み込めませんでした','Could not load this audio file'], ['キックを再生できませんでした','Could not play the kick'],
  ['音のエンジンは終了しています。ページを再読み込みしてください。','The audio engine has closed. Please reload the page.'], ['このブラウザでは Web Audio を利用できません。','Web Audio is unavailable in this browser.'], ['音を開始できませんでした。','Could not start audio.'], ['先に音声ファイルを選択してください。','Please choose an audio file first.'], ['音を開始するには、再生ボタンをもう一度押してください。','Press Play again to start the audio.'], ['このブラウザではマイク入力を利用できません。','Microphone input is unavailable in this browser.'], ['マイク入力が停止されました。再開するにはマイクボタンを押してください。','Microphone input stopped. Press Microphone to resume.'], ['マイクの使用が許可されていません。ブラウザの設定を確認してください。','Microphone permission was denied. Check your browser settings.'], ['音声ファイルを選択してください。','Please choose an audio file.'], ['音声ファイルに再生できる音がありません。','This audio file contains no playable sound.'], ['この音声形式を読み込めませんでした。MP3・WAV・M4Aなどをお試しください。','This audio format could not be loaded. Try MP3, WAV or M4A.'], ['音声ファイルを読み込めませんでした。','Could not load the audio file.'], ['パターンは16ステップで指定してください。','The pattern must contain 16 steps.'],
];

export const translations = Object.fromEntries(entries.map(([ja,en])=>[ja,{ja,en}]));
Object.assign(translations,{
  '16 steps. Infinite forms.':{ja:'16ステップから、無数のかたち。',en:'16 steps. Infinite forms.'},
  'SOUND OFF':{ja:'音声 OFF',en:'SOUND OFF'},
  'SOUND ON':{ja:'音声 ON',en:'SOUND ON'},
  'LOADING…':{ja:'読み込み中…',en:'LOADING…'},
  'AUDIO ERROR':{ja:'音声エラー',en:'AUDIO ERROR'},
  'particles':{ja:'粒',en:'particles'},
});
const listeners=new Set(), bindings=[];
let language='ja';
try { const saved=localStorage.getItem('fluid-language'); if(saved==='ja'||saved==='en')language=saved; } catch { /* Storage can be disabled. */ }
export function getLanguage(){return language;}
export function t(key,values={}){let value=translations[key]?.[language]??key;for(const [name,replacement]of Object.entries(values))value=value.replaceAll(`{${name}}`,String(replacement));return value;}
function translateText(value){const trimmed=value.trim();return translations[trimmed]?value.replace(trimmed,t(trimmed)):value;}
function paintBinding(binding){if(!binding.node.isConnected)return;if(binding.attribute)binding.node.setAttribute(binding.attribute,translateText(binding.source));else binding.node.nodeValue=translateText(binding.source);}

/** Bind only explicitly listed copy, preserving icons, labels, and form state. */
export function bindTranslations(root=document){
  const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let node;
  while((node=walker.nextNode())){if(!translations[node.nodeValue.trim()]||bindings.some(binding=>binding.node===node&&!binding.attribute))continue;const binding={node,source:node.nodeValue};bindings.push(binding);paintBinding(binding);}
  root.querySelectorAll('[aria-label],[title]').forEach(element=>{for(const attribute of ['aria-label','title']){const source=element.getAttribute(attribute);if(!source||!translations[source.trim()]||bindings.some(binding=>binding.node===element&&binding.attribute===attribute))continue;const binding={node:element,source,attribute};bindings.push(binding);paintBinding(binding);}});
}
export function onLanguageChange(listener){listeners.add(listener);return()=>listeners.delete(listener);}
export function setLanguage(value){if(value!=='ja'&&value!=='en')return;language=value;try{localStorage.setItem('fluid-language',value);}catch{}document.documentElement.lang=value;for(const binding of bindings)paintBinding(binding);document.querySelectorAll('[data-language]').forEach(button=>{const active=button.dataset.language===value;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));});listeners.forEach(listener=>listener(value));}
export function mountLanguageSwitch(){document.querySelector('.header-right').insertAdjacentHTML('afterbegin','<div class="language-switch" role="group" aria-label="Language / 言語"><button type="button" data-language="ja" aria-label="日本語" lang="ja">JA</button><button type="button" data-language="en" aria-label="English" lang="en">EN</button></div>');document.querySelectorAll('[data-language]').forEach(button=>button.addEventListener('click',()=>setLanguage(button.dataset.language)));bindTranslations();setLanguage(language);}

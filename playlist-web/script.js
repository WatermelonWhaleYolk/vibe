'use strict';

const $ = (selector) => document.querySelector(selector);
const escapeHTML = (value) => String(value).replace(/[&<>"']/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const uid = () => globalThis.crypto?.randomUUID?.() || `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const KEY = 'offbeat.library.v1';
const DEMOS = [
  {id:'demo-0',title:'Soft Landing',artist:'offbeat studio',album:'Slow mornings',color:0,mood:'chill',duration:32,root:130.81},
  {id:'demo-1',title:'Sunday, Somewhere',artist:'offbeat studio',album:'Green room',color:1,mood:'chill',duration:32,root:146.83},
  {id:'demo-2',title:'Lavender Skies',artist:'offbeat studio',album:'After hours',color:2,mood:'night',duration:32,root:110},
  {id:'demo-3',title:'Blue Hour',artist:'offbeat studio',album:'City in slow motion',color:3,mood:'focus',duration:32,root:164.81},
  {id:'demo-4',title:'Bloom Again',artist:'offbeat studio',album:'Little things',color:4,mood:'energy',duration:32,root:174.61},
  {id:'demo-5',title:'A Place to Stay',artist:'offbeat studio',album:'Analog days',color:5,mood:'focus',duration:32,root:123.47},
  {id:'demo-6',title:'Midnight Walk',artist:'offbeat studio',album:'After hours',color:2,mood:'night',duration:32,root:98},
  {id:'demo-7',title:'Golden Afternoon',artist:'offbeat studio',album:'Slow mornings',color:0,mood:'energy',duration:32,root:196}
];
const DEFAULTS = [
  {id:'slow-mornings',name:'느리게 시작하는 아침',description:'서두르지 않아도 괜찮은 아침. 따뜻한 커피와 부드러운 사운드.',word:'slow\nmornings.',color:0,mood:'chill',tracks:['demo-0','demo-1','demo-7']},
  {id:'green-room',name:'나만의 작은 그루브',description:'일상에 초록빛 리듬을 더하는 시간.',word:'green\nroom.',color:1,mood:'energy',tracks:['demo-1','demo-4','demo-7']},
  {id:'after-hours',name:'밤이 깊어질수록',description:'불빛이 잦아든 도시, 나에게 집중하는 밤.',word:'after\nhours.',color:2,mood:'night',tracks:['demo-2','demo-6','demo-0']},
  {id:'blue-hour',name:'생각이 흐르는 시간',description:'몰입이 필요한 순간을 위한 잔잔한 선율.',word:'blue\nhour.',color:3,mood:'focus',tracks:['demo-3','demo-5','demo-2']}
];
function loadState() {
  const fallback = {version:1,playlists:structuredClone(DEFAULTS),likes:[],imports:[],volume:.7};
  try {
    const data = JSON.parse(localStorage.getItem(KEY));
    if (!data || data.version !== 1 || !Array.isArray(data.playlists) || !Array.isArray(data.likes)) return fallback;
    const imports = Array.isArray(data.imports) ? data.imports.filter(t => typeof t.id === 'string' && typeof t.title === 'string').map(t => ({...t,color:Math.max(0,Math.min(5,Number(t.color)||0)),duration:Number(t.duration)||0,local:true})) : [];
    const valid = new Set([...DEMOS,...imports].map(t=>t.id));
    const seen = new Set();
    const playlists = data.playlists.filter(p => typeof p.id === 'string' && typeof p.name === 'string' && Array.isArray(p.tracks) && !seen.has(p.id) && seen.add(p.id)).map(p => ({...p,description:String(p.description||''),color:Math.max(0,Math.min(5,Number(p.color)||0)),tracks:[...new Set(p.tracks)].filter(id=>valid.has(id))}));
    return {version:1,playlists,likes:[...new Set(data.likes)].filter(id=>valid.has(id)),imports,volume:Number.isFinite(data.volume)?Math.max(0,Math.min(1,data.volume)):.7};
  } catch { return fallback; }
}
let state = loadState();
let view = 'home', activePlaylist = null, mood = 'all', query = '', editingId = null, addingId = null;
let currentId = null, queue = [], shuffle = false, repeating = false, requestId = 0;
let toastTimeout;
const audio = $('#audio');
const urls = new Map();
const sessionFiles = new Map();
const allTracks = () => [...DEMOS,...state.imports];
const trackById = (id) => allTracks().find(t=>t.id===id);
const playlistById = (id) => state.playlists.find(p=>p.id===id);
const time = (seconds) => Number.isFinite(seconds) && seconds >= 0 ? `${Math.floor(seconds/60)}:${String(Math.floor(seconds%60)).padStart(2,'0')}` : '0:00';
function toast(message) { $('#toast').textContent=message; $('#toast').classList.add('show'); clearTimeout(toastTimeout); toastTimeout=setTimeout(()=>$('#toast').classList.remove('show'),3500); }
function save() { try { localStorage.setItem(KEY,JSON.stringify(state)); } catch { toast('저장 공간을 사용할 수 없어 이번 변경은 현재 창에서만 유지됩니다.'); } }

// IndexedDB stores imported audio itself, while localStorage holds only metadata.
let dbPromise;
function database() {
  if (!dbPromise) dbPromise = new Promise((resolve,reject)=>{
    if (!globalThis.indexedDB) return reject(new Error('Storage unavailable'));
    const request=indexedDB.open('offbeat-audio',1);
    request.onupgradeneeded=()=>request.result.createObjectStore('files');
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error);
    request.onblocked=()=>reject(new Error('Storage blocked'));
  });
  return dbPromise;
}
async function fileStore(method,id,file) {
  const db=await database();
  return new Promise((resolve,reject)=>{
    const transaction=db.transaction('files',method==='get'?'readonly':'readwrite');
    const request=method==='get'?transaction.objectStore('files').get(id):transaction.objectStore('files').put(file,id);
    transaction.oncomplete=()=>resolve(request.result);
    transaction.onerror=()=>reject(transaction.error);
    transaction.onabort=()=>reject(transaction.error);
  });
}

function cover(item,extra='') {
  const word=item.word || item.name || item.title || 'your\nsound.';
  return `<div class="cover art art-${item.color||0} ${extra}" aria-hidden="true"><span class="cover-word">${escapeHTML(word).replace(/\n/g,'<br>')}</span><span class="cover-label">OFFBEAT SELECTS / VOL. 0${(item.color||0)+1}</span><span class="cover-badge">↗</span></div>`;
}
function card(p) { return `<button class="playlist-card" data-playlist="${escapeHTML(p.id)}">${cover(p)}<h3>${escapeHTML(p.name)}</h3><p>${p.tracks.length}곡 <span>·</span> ${escapeHTML(({chill:'편안한 하루',energy:'기분 좋은 리듬',night:'늦은 밤의 무드',focus:'오롯이 집중'})[p.mood] || '나만의 플레이리스트')}</p></button>`; }
function rows(tracks,detail=false) {
  if (!tracks.length) return '<div class="empty"><h3>아직 음악이 없어요</h3>음악을 가져오거나, 곡의 ＋ 버튼으로 플레이리스트에 담아보세요.</div>';
  return `<div class="track-table ${detail?'detail-table':''}"><div class="track-header"><span>#</span><span>제목 / 아티스트</span><span class="track-album">앨범</span><span>시간</span><span style="text-align:right">${detail?'관리':'저장'}</span></div>${tracks.map((t,i)=>`<div class="track-row ${currentId===t.id?'playing':''}" data-track-row="${escapeHTML(t.id)}"><button class="track-number" data-track="${escapeHTML(t.id)}" aria-label="${escapeHTML(t.title)} 재생">${currentId===t.id&&!audio.paused?'♫':String(i+1).padStart(2,'0')}</button><div class="track-title-cell"><div class="cover art art-${t.color} track-cover" aria-hidden="true"><span>${escapeHTML(t.title.slice(0,1))}</span></div><div class="track-copy"><button class="track-name" data-track="${escapeHTML(t.id)}">${escapeHTML(t.title)}</button><span>${escapeHTML(t.artist)}<span class="source-label">${t.local?'LOCAL':'DEMO'}</span></span></div></div><span class="track-album">${escapeHTML(t.album)}</span><span class="track-time">${time(t.duration)}</span><div class="track-actions"><button class="icon-btn ${state.likes.includes(t.id)?'liked':''}" data-like="${escapeHTML(t.id)}" aria-label="${escapeHTML(t.title)} 좋아요" aria-pressed="${state.likes.includes(t.id)}">${state.likes.includes(t.id)?'♥':'♡'}</button>${detail?`<div class="reorder-actions"><button class="icon-btn" data-move="${escapeHTML(t.id)}" data-direction="-1" aria-label="곡 위로 이동" ${i===0?'disabled':''}>↑</button><button class="icon-btn" data-move="${escapeHTML(t.id)}" data-direction="1" aria-label="곡 아래로 이동" ${i===tracks.length-1?'disabled':''}>↓</button><button class="icon-btn" data-remove="${escapeHTML(t.id)}" aria-label="플레이리스트에서 곡 제거">×</button></div>`:`<button class="icon-btn" data-add="${escapeHTML(t.id)}" aria-label="${escapeHTML(t.title)} 플레이리스트에 추가">＋</button>`}</div></div>`).join('')}</div>`;
}
const uploadStrip = () => '<div class="upload-strip"><div><h3>당신의 음악도 이곳에.</h3><p>MP3, WAV 등 보유한 음원을 불러오세요. 파일은 이 브라우저에만 저장됩니다.</p></div><button class="secondary-btn" data-action="import">＋ 음악 가져오기</button></div>';
function renderSidebar() {
  $('#sidebar-playlists').innerHTML=state.playlists.map(p=>`<button class="side-playlist" data-playlist="${escapeHTML(p.id)}"><span class="playlist-dot" style="background:${['#eaa76b','#849668','#b8a7d0','#769bab','#c78a8c','#c6b89e'][p.color]}"></span><span>${escapeHTML(p.name)}</span></button>`).join('');
  $('#like-count').textContent=state.likes.length;
  document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===view));
  $('#breadcrumb').textContent=({home:'둘러보기',library:'내 플레이리스트',likes:'좋아요한 음악',detail:'플레이리스트'})[view];
}
function render() {
  renderSidebar();
  const main=$('#main');
  if(query) {
    const normalized=query.toLocaleLowerCase();
    const tracks=allTracks().filter(t=>`${t.title} ${t.artist} ${t.album}`.toLocaleLowerCase().includes(normalized));
    const playlists=state.playlists.filter(p=>`${p.name} ${p.description}`.toLocaleLowerCase().includes(normalized));
    main.innerHTML=`<h1 class="results-title">‘${escapeHTML(query)}’ 검색 결과</h1><div class="section-heading"><h2>플레이리스트 <small>${playlists.length}개</small></h2></div>${playlists.length?`<div class="playlist-grid">${playlists.map(card).join('')}</div>`:'<p class="demo-note">일치하는 플레이리스트가 없습니다.</p>'}<div class="section-heading"><h2>음악 <small>${tracks.length}곡</small></h2></div>${tracks.length?rows(tracks):'<div class="empty">검색 결과가 없어요. 다른 제목이나 아티스트로 찾아보세요.</div>'}`;
    return;
  }
  if(view==='detail') {
    const p=playlistById(activePlaylist);
    if(!p) { navigate('library'); return; }
    const tracks=p.tracks.map(trackById).filter(Boolean);
    main.innerHTML=`<div style="margin-top:24px"><button class="text-btn" data-view="library">← 내 플레이리스트</button></div><div class="detail-top">${cover(p,'detail-cover')}<div class="detail-info"><span class="eyebrow">PERSONAL PLAYLIST</span><h1>${escapeHTML(p.name)}</h1><p>${escapeHTML(p.description||'나만의 순간을 담은 플레이리스트')}</p><span class="detail-meta">나의 보관함 · ${tracks.length}곡 · ${time(tracks.reduce((s,t)=>s+t.duration,0))}</span></div></div><div class="detail-buttons"><button class="primary-btn" data-action="play-list">▶ 전체 재생</button><button class="secondary-btn" data-action="edit">편집</button><button class="secondary-btn" data-action="import">＋ 음악 가져오기</button><button class="secondary-btn danger-btn" data-action="delete">삭제</button></div>${rows(tracks,true)}<p class="demo-note">↑ ↓ 버튼으로 곡 순서를 바꿀 수 있어요. 곡은 한 플레이리스트에 한 번씩 담깁니다.</p>`;
  } else if(view==='library') {
    main.innerHTML=`<div class="intro"><div><span class="eyebrow">YOUR OWN COLLECTION</span><h1>내 플레이리스트<span class="spark">✳</span></h1><p>좋아하는 순간을 모아, 나만의 리듬으로.</p></div></div><div class="section-heading"><h2>나의 컬렉션 <small>${state.playlists.length}개</small></h2><button class="secondary-btn" data-action="create">＋ 새 플레이리스트</button></div>${state.playlists.length?`<div class="playlist-grid">${state.playlists.map(card).join('')}</div>`:'<div class="empty"><h3>첫 번째 플레이리스트를 만들어보세요</h3>위의 새 플레이리스트 버튼으로 시작하세요.</div>'}${uploadStrip()}<div class="section-heading"><h2>가져온 음악 <small>${state.imports.length}곡</small></h2></div>${rows(state.imports)}`;
  } else if(view==='likes') {
    main.innerHTML=`<div class="intro"><div><span class="eyebrow">ON REPEAT, IN YOUR HEART</span><h1>좋아요한 음악 <span class="spark">♡</span></h1><p>다시 듣고 싶은 그 순간, ${state.likes.length}곡의 취향.</p></div></div>${state.likes.length?rows(state.likes.map(trackById).filter(Boolean)):'<div class="empty"><h3>마음에 드는 음악을 발견했나요?</h3>곡 옆의 ♡를 누르면 이곳에 모여요.</div>'}`;
  } else {
    const playlists=state.playlists.filter(p=>mood==='all'||p.mood===mood);
    const tracks=allTracks().filter(t=>mood==='all'||t.mood===mood);
    const date=new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric'}).format(new Date()).toUpperCase();
    main.innerHTML=`<div class="intro"><div><span class="eyebrow">GOOD MUSIC. YOUR WAY.</span><h1>오늘은 어떤 리듬인가요<span class="spark">✳</span></h1><p>당신의 하루에 어울리는 음악을 만나보세요.</p></div><span class="date-label">${date}</span></div><section class="hero" aria-label="오늘의 추천"><div class="hero-copy"><span class="eyebrow">THE OFFBEAT EDIT · 001</span><h2>A little slower.<br>A little closer.</h2><p>잠깐, 속도를 늦춰도 좋아요.<br>오롯이 나에게 집중하는 시간의 사운드트랙.</p><button class="primary-btn" data-action="hero-play">지금 들어보기 <span>↗</span></button></div><div class="hero-art" aria-hidden="true"><div class="record"></div><div class="record-hole"></div><div class="hero-sticker">TAKE IT<br>SLOW ✳</div></div><span class="hero-number">CURATED WITH FEELING / 01</span></section><section><div class="section-heading"><h2>지금, 이 무드 <small>순간마다 다른 취향</small></h2><button class="text-btn" data-view="library">모두 보기 <span>↗</span></button></div><div class="filters" role="group" aria-label="무드 필터">${[['all','전체'],['chill','☁ 편안하게'],['focus','◎ 집중할 때'],['night','☾ 늦은 밤'],['energy','✳ 기분 전환']].map(([id,label])=>`<button class="filter ${mood===id?'active':''}" data-mood="${id}" aria-pressed="${mood===id}">${label}</button>`).join('')}</div>${playlists.length?`<div class="playlist-grid">${playlists.map(card).join('')}</div>`:'<div class="empty">이 무드의 플레이리스트가 아직 없어요.</div>'}</section><section class="music-section"><div class="section-heading"><h2>취향의 발견 <small>새롭게 만나는 사운드</small></h2><button class="text-btn" data-action="import">내 음악 추가 <span>＋</span></button></div>${rows(tracks)}<p class="demo-note">DEMO 표시는 offbeat가 코드로 합성한 32초 앰비언트 샘플입니다. 실제 아티스트의 음원이 아닙니다.</p></section>${uploadStrip()}`;
  }
}
function navigate(next,id) {
  view=next;activePlaylist=id||null;query='';$('#search').value='';
  const hash=next==='detail'?`playlist/${encodeURIComponent(id)}`:next;
  if(location.hash.slice(1)!==hash) location.hash=hash;
  render();window.scrollTo({top:0,behavior:'instant'});
}
function route() {
  const hash=location.hash.slice(1);
  if(hash.startsWith('playlist/')) { try { activePlaylist=decodeURIComponent(hash.slice(9));view='detail'; } catch { view='home'; } }
  else { view=['home','library','likes'].includes(hash)?hash:'home';activePlaylist=null; }
  query='';$('#search').value='';render();
}
window.addEventListener('hashchange',route);

function openEditor(id=null) {
  editingId=id;const p=playlistById(id);
  $('#dialog-title').textContent=p?'플레이리스트 편집':'새 플레이리스트';
  $('#playlist-name').value=p?.name||'';$('#playlist-description').value=p?.description||'';$('#playlist-color').value=p?.color||0;
  $('#playlist-dialog').showModal();$('#playlist-name').focus();
}
$('#playlist-form').addEventListener('submit',event=>{
  event.preventDefault();const name=$('#playlist-name').value.trim();
  if(!name) { $('#playlist-name').setCustomValidity('이름을 입력해주세요.');$('#playlist-name').reportValidity();return; }
  const fields={name,description:$('#playlist-description').value.trim(),color:Number($('#playlist-color').value)};
  let p=playlistById(editingId);
  if(p) { Object.assign(p,fields);delete p.word; } else { p={id:uid(),...fields,mood:'custom',tracks:[]};state.playlists.push(p); }
  save();$('#playlist-dialog').close();navigate('detail',p.id);toast('플레이리스트를 저장했어요.');
});
$('#playlist-name').addEventListener('input',()=>$('#playlist-name').setCustomValidity(''));
function toggleLike(id) { if(!trackById(id))return;state.likes=state.likes.includes(id)?state.likes.filter(x=>x!==id):[...state.likes,id];save();render();updatePlayer(); }
function openAdd(id) {
  addingId=id;
  $('#add-options').innerHTML=state.playlists.length?state.playlists.map(p=>`<button class="add-option" data-add-to="${escapeHTML(p.id)}" ${p.tracks.includes(id)?'disabled':''}><span>${escapeHTML(p.name)}</span><small>${p.tracks.includes(id)?'추가됨':'＋'}</small></button>`).join(''):'<p class="demo-note">먼저 내 플레이리스트에서 새 플레이리스트를 만들어주세요.</p>';
  $('#add-dialog').showModal();
}
document.addEventListener('click',async event=>{
  const button=event.target.closest('button');if(!button||button.disabled)return;
  const d=button.dataset;
  if(d.view)navigate(d.view);
  else if(d.playlist)navigate('detail',d.playlist);
  else if(d.mood){mood=d.mood;render();}
  else if(d.track){const visible=[...$('#main').querySelectorAll('[data-track-row]')].map(e=>e.dataset.trackRow);await playTrack(d.track,visible);}
  else if(d.like)toggleLike(d.like);
  else if(d.add)openAdd(d.add);
  else if(d.addTo){const p=playlistById(d.addTo);if(p&&!p.tracks.includes(addingId)){p.tracks.push(addingId);save();render();toast('플레이리스트에 담았어요.');}$('#add-dialog').close();}
  else if(d.move){const p=playlistById(activePlaylist);if(!p)return;const i=p.tracks.indexOf(d.move),j=i+Number(d.direction);if(i>=0&&j>=0&&j<p.tracks.length){[p.tracks[i],p.tracks[j]]=[p.tracks[j],p.tracks[i]];if(queuePlaylist===p.id)queue=[...p.tracks];save();render();const target=[...document.querySelectorAll('[data-move]')].find(b=>b.dataset.move===d.move&&b.dataset.direction===d.direction&&!b.disabled);target?.focus();}}
  else if(d.remove){const p=playlistById(activePlaylist);if(p){p.tracks=p.tracks.filter(id=>id!==d.remove);if(queuePlaylist===p.id)queue=[...p.tracks];save();render();toast('플레이리스트에서 제거했어요.');}}
  else if(d.action==='create')openEditor();
  else if(d.action==='edit')openEditor(activePlaylist);
  else if(d.action==='close-dialog')$('#playlist-dialog').close();
  else if(d.action==='close-add')$('#add-dialog').close();
  else if(d.action==='import')$('#file-input').click();
  else if(d.action==='hero-play')await playTrack('demo-0',['demo-0','demo-1','demo-5']);
  else if(d.action==='play-list'){const p=playlistById(activePlaylist);if(p?.tracks.length){await playTrack(p.tracks[0],p.tracks);queuePlaylist=p.id;}else toast('먼저 플레이리스트에 음악을 담아주세요.');}
  else if(d.action==='delete'){const p=playlistById(activePlaylist);if(p&&confirm(`‘${p.name}’ 플레이리스트를 삭제할까요? 음원 파일과 좋아요는 유지됩니다.`)){state.playlists=state.playlists.filter(x=>x.id!==p.id);save();navigate('library');toast('플레이리스트를 삭제했어요.');}}
});
$('#search').addEventListener('input',event=>{query=event.target.value.trim();render();});
document.addEventListener('keydown',event=>{if(event.key==='/'&&!event.ctrlKey&&!event.metaKey&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)){event.preventDefault();$('#search').focus();}});
document.querySelectorAll('dialog').forEach(dialog=>dialog.addEventListener('click',event=>{if(event.target!==dialog)return;const rect=dialog.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)dialog.close();}));

// Generate a real PCM WAV: layered chords, a bass pulse and soft bell notes.
// No commercial recordings, audio downloads or fake playback timers are used.
function synthesize(track) {
  const rate=16000,length=rate*32,buffer=new ArrayBuffer(44+length*2),data=new DataView(buffer);
  const write=(offset,text)=>{for(let i=0;i<text.length;i++)data.setUint8(offset+i,text.charCodeAt(i));};
  write(0,'RIFF');data.setUint32(4,36+length*2,true);write(8,'WAVE');write(12,'fmt ');data.setUint32(16,16,true);data.setUint16(20,1,true);data.setUint16(22,1,true);data.setUint32(24,rate,true);data.setUint32(28,rate*2,true);data.setUint16(32,2,true);data.setUint16(34,16,true);write(36,'data');data.setUint32(40,length*2,true);
  const progression=[0,-3,-5,-2],notes=[0,7,12,16,14,7,4,12];
  for(let i=0;i<length;i++){
    const t=i/rate,bar=Math.floor(t/8),root=track.root*Math.pow(2,progression[bar%4]/12),phase=t%8;
    const envelope=Math.min(1,phase/.8)*Math.min(1,(8-phase)/1.5),fade=Math.min(1,t/1.2,(32-t)/2);
    let sample=0;
    for(const interval of [0,4,7,11]){const f=root*Math.pow(2,interval/12);sample+=(Math.sin(2*Math.PI*f*t)+.17*Math.sin(2*Math.PI*(f*2+.25)*t))*.055*envelope;}
    const step=Math.floor(t*2),bell=root*2*Math.pow(2,notes[(step+track.color)%notes.length]/12);
    sample+=Math.sin(2*Math.PI*bell*t)*Math.exp(-(t%.5)*9)*.055;
    sample+=Math.sin(2*Math.PI*root*.5*t)*(.06+.02*Math.sin(t*Math.PI));
    data.setInt16(44+i*2,Math.max(-1,Math.min(1,sample*fade))*32767,true);
  }
  return new Blob([buffer],{type:'audio/wav'});
}
let queuePlaylist=null;
async function sourceFor(track) {
  if(urls.has(track.id))return urls.get(track.id);
  const blob=track.local?(sessionFiles.get(track.id)||await fileStore('get',track.id)):synthesize(track);
  if(!blob)throw new Error('Missing local file');
  const url=URL.createObjectURL(blob);urls.set(track.id,url);return url;
}
async function playTrack(id,ids=null) {
  const track=trackById(id);if(!track)return;
  const ticket=++requestId;
  if(ids){queue=[...ids];queuePlaylist=view==='detail'?activePlaylist:null;}
  if(currentId===id&&audio.getAttribute('src')) { if(audio.paused) {try{await audio.play();}catch{toast('재생할 수 없어요. 음원 형식을 확인해주세요.');}}else audio.pause();return; }
  audio.pause();audio.removeAttribute('src');audio.load();
  currentId=id;$('#seek').value=0;$('#seek').disabled=true;$('#elapsed').textContent='0:00';$('#duration').textContent=time(track.duration);$('#player-title').textContent='음악 불러오는 중…';
  try {
    const url=await sourceFor(track);if(ticket!==requestId)return;
    audio.src=url;audio.load();updatePlayer();render();await audio.play();
  } catch(error) {if(ticket===requestId){audio.pause();audio.removeAttribute('src');audio.load();updatePlayer();render();toast(track.local?'음원에 접근할 수 없어요. 파일을 다시 가져와주세요.':'음원을 재생할 수 없어요. 재생 버튼으로 다시 시도해주세요.');}}
}
function updatePlayer() {
  const t=trackById(currentId);
  if(t){$('#player-title').textContent=t.title;$('#player-artist').textContent=`${t.artist} · ${t.local?'내 음악':'오리지널 데모'}`;$('#player-cover').className=`cover art art-${t.color} mini-cover`;$('#player-cover').innerHTML=`<span>${escapeHTML(t.title.slice(0,1))}.</span>`;}
  $('#play').textContent=audio.paused?'▶':'Ⅱ';$('#play').setAttribute('aria-label',audio.paused?'재생':'일시정지');
  const liked=state.likes.includes(currentId);$('#player-like').disabled=!t;$('#player-like').textContent=liked?'♥':'♡';$('#player-like').classList.toggle('liked',liked);$('#player-like').setAttribute('aria-pressed',String(liked));
  document.querySelectorAll('[data-track-row]').forEach(row=>{const active=row.dataset.trackRow===currentId;row.classList.toggle('playing',active);const number=row.querySelector('.track-number');if(number)number.textContent=active&&!audio.paused?'♫':String([...row.parentElement.querySelectorAll('[data-track-row]')].indexOf(row)+1).padStart(2,'0');});
}
async function advance(direction,automatic=false) {
  if(!queue.length) {toast('먼저 재생할 음악을 골라주세요.');return;}
  if(direction<0&&audio.currentTime>3){audio.currentTime=0;return;}
  let index=queue.indexOf(currentId),next;
  if(shuffle&&queue.length>1){const choices=queue.filter(id=>id!==currentId);next=choices[Math.floor(Math.random()*choices.length)];}
  else {let j=index+direction;if(j>=queue.length&&automatic&&!repeating){audio.pause();audio.currentTime=0;updatePlayer();return;}j=(j+queue.length)%queue.length;next=queue[j];}
  if(next===currentId){audio.currentTime=0;try{await audio.play();}catch{toast('다시 재생하려면 재생 버튼을 눌러주세요.');}}else await playTrack(next);
}
$('#play').addEventListener('click',async()=>{if(!currentId){await playTrack(DEMOS[0].id,DEMOS.map(t=>t.id));return;}if(!audio.getAttribute('src')){await playTrack(currentId);return;}if(audio.paused){try{await audio.play();}catch{toast('재생할 수 없는 음원입니다.');}}else audio.pause();});
$('#previous').addEventListener('click',()=>advance(-1));$('#next').addEventListener('click',()=>advance(1));
$('#player-like').addEventListener('click',()=>toggleLike(currentId));
$('#shuffle').addEventListener('click',()=>{shuffle=!shuffle;$('#shuffle').setAttribute('aria-pressed',String(shuffle));$('#shuffle').classList.toggle('liked',shuffle);toast(shuffle?'셔플을 켰어요.':'셔플을 껐어요.');});
$('#repeat').addEventListener('click',()=>{repeating=!repeating;$('#repeat').setAttribute('aria-pressed',String(repeating));$('#repeat').classList.toggle('liked',repeating);toast(repeating?'재생 목록을 반복합니다.':'반복 재생을 껐어요.');});
audio.volume=state.volume;$('#volume').value=state.volume;
$('#volume').addEventListener('input',event=>{audio.volume=Number(event.target.value);audio.muted=false;state.volume=audio.volume;$('#mute').setAttribute('aria-pressed','false');$('#mute').textContent=audio.volume===0?'◖×':'◖))';});
$('#volume').addEventListener('change',save);
$('#mute').addEventListener('click',()=>{audio.muted=!audio.muted;$('#mute').setAttribute('aria-pressed',String(audio.muted));$('#mute').setAttribute('aria-label',audio.muted?'음소거 해제':'음소거');$('#mute').textContent=audio.muted?'◖×':'◖))';});
$('#seek').addEventListener('input',event=>{if(Number.isFinite(audio.duration)&&audio.duration>0)audio.currentTime=audio.duration*Number(event.target.value)/100;});
audio.addEventListener('timeupdate',()=>{$('#elapsed').textContent=time(audio.currentTime);$('#seek').value=Number.isFinite(audio.duration)&&audio.duration>0?audio.currentTime/audio.duration*100:0;});
audio.addEventListener('loadedmetadata',()=>{$('#duration').textContent=time(audio.duration);$('#seek').disabled=!Number.isFinite(audio.duration)||audio.duration<=0;const t=trackById(currentId);if(t?.local&&Number.isFinite(audio.duration)){t.duration=audio.duration;save();render();}});
audio.addEventListener('play',updatePlayer);audio.addEventListener('pause',updatePlayer);
audio.addEventListener('ended',()=>advance(1,true));
audio.addEventListener('error',()=>{if(audio.getAttribute('src')){toast('파일을 재생할 수 없어요. 다른 음원이나 지원되는 형식을 선택해주세요.');updatePlayer();}});

function readDuration(file) {
  return new Promise(resolve=>{const probe=new Audio(),url=URL.createObjectURL(file);let settled=false;const finish=()=>{if(settled)return;settled=true;const duration=Number.isFinite(probe.duration)?probe.duration:0;probe.removeAttribute('src');probe.load();URL.revokeObjectURL(url);clearTimeout(timeout);resolve(duration);};const timeout=setTimeout(finish,5000);probe.onloadedmetadata=finish;probe.onerror=finish;probe.src=url;});
}
$('#file-input').addEventListener('change',async event=>{
  const files=Array.from(event.target.files);event.target.value='';if(!files.length)return;
  const destination=view==='detail'?activePlaylist:null;
  let count=0,persistent=true;
  toast('음악을 가져오고 있어요…');
  for(const file of files){
    if(!file.type.startsWith('audio/')&&!/\.(mp3|wav|ogg|m4a|flac|aac|opus|aiff|webm)$/i.test(file.name))continue;
    const id=uid(),duration=await readDuration(file);
    try{await fileStore('put',id,file);}catch{sessionFiles.set(id,file);persistent=false;}
    const base=file.name.replace(/\.[^.]+$/,''),parts=base.split(' - ');
    state.imports.push({id,title:parts.length>1?parts.slice(1).join(' - '):base,artist:parts.length>1?parts[0]:'나의 음악',album:'직접 가져온 음악',color:count%6,duration,local:true,mood:'custom'});
    const p=playlistById(destination);if(p)p.tracks.push(id);count++;
  }
  save();render();toast(count?`${count}곡을 가져왔어요.${persistent?'':' 저장소를 사용할 수 없어 음원은 현재 창에서만 재생됩니다.'}`:'지원되는 오디오 파일을 선택해주세요.');
});
window.addEventListener('beforeunload',()=>urls.forEach(url=>URL.revokeObjectURL(url)));
route();updatePlayer();

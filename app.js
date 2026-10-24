'use strict';
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const url = s => /^https:\/\//.test(s || '') ? s : '#';
const params = new URLSearchParams(location.search);
const hadDayParam = params.has('day');
let selectedDay = Math.max(1, Math.floor(Number(params.get('day')) || 1));
let start = params.get('start') === '17' ? 17 : 16;
// Only write ?day=&start= into the address once the visitor has chosen something (or arrived with them).
let addressDirty = hadDayParam || params.has('start');
let D, map, mapLayers, activeMarkers = new Map(), mapMode = 'day', rainOpen = false, todoWho = 'all', toastTimer = 0, returnTo = null;
const motion = matchMedia('(prefers-reduced-motion: reduce)');
let reducedMotion = motion.matches; motion.addEventListener?.('change', e => { reducedMotion = e.matches; });
const coarsePointer = matchMedia('(pointer: coarse)').matches;
const narrow = () => innerWidth <= 800;
const behavior = () => reducedMotion ? 'auto' : 'smooth';
// Start loading the data before Leaflet finishes downloading (app.js is the first deferred script).
const dataRequest = fetch('data.json',{cache:'no-cache'});
// Deferred scripts (Leaflet included) have all run by DOMContentLoaded; never wait for images via window.load.
let domReady = document.readyState === 'complete'; addEventListener('DOMContentLoaded', () => { domReady = true; }, {once:true});
const leafletReady = () => new Promise(resolve => { if (window.L || domReady) return resolve(!!window.L); addEventListener('DOMContentLoaded', () => resolve(!!window.L), {once:true}); });
const dateOf = day => `2026-11-${String(start + day - 1).padStart(2, '0')}`;
const shortDate = date => `${Number(date.slice(5,7))}/${Number(date.slice(8))}`;
const weekday = date => '周' + '日一二三四五六'[new Date(`${date}T12:00:00Z`).getUTCDay()];
const shiftDate = date => {
  const value = new Date(`${date}T12:00:00Z`); value.setUTCDate(value.getUTCDate() + start - 16);
  return value.toISOString().slice(0,10);
};
const scheduleText = text => start===16 ? text : String(text || '').replace(/11\/(1[5-9]|2[0-7])(?!\d)/g, (_,day)=>`11/${Number(day)+1}`);
const geo = p => Number.isFinite(p.lat) && Number.isFinite(p.lon) && Math.abs(p.lat)<=90 && Math.abs(p.lon)<=180;
const nav = p => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${p.lat},${p.lon}`)}`;
const refLinks = ids => (ids || []).map(id => D.sources.find(s => s.id === id)).filter(Boolean).map(s => `<a href="${esc(url(s.url))}" target="_blank" rel="noopener">${esc(s.shortTitle || s.title)} ↗</a>`).join('');
const flightShiftNote = '（顺延一天：改为11/16周一晚上到浦东T1、11/17 00:10起飞；MU735每日执飞，但余票和价格须重查）';
const eventText = e => scheduleText(e.detail || '') + (start===17 && /MU735/.test(`${e.place||''}${e.detail||''}`) ? flightShiftNote : '');
const isOptional = e => !!e.optional || e.kind === 'photo_optional';
const TZ = {'Asia/Shanghai':'北京','Australia/Sydney':'悉尼','Pacific/Auckland':'新西兰'};
const AIRPORT_TZ = {pvg:'Asia/Shanghai',syd_t1:'Australia/Sydney',akl_airport:'Pacific/Auckland',zqn_airport:'Pacific/Auckland',chc_airport:'Pacific/Auckland'};
const startZone = e => e.timezone || (e.endTimezone ? AIRPORT_TZ[e.placeId] || null : null);
const workTitle = p => String(p.sourceTitle || '').replace(/^File:\s*/i,'').replace(/\.[a-z0-9]{2,5}$/i,'').trim();
const cc0 = p => /^CC0\b/i.test(p.license || '');
const licenseLabel = p => cc0(p) ? 'CC0（公有领域贡献）' : p.license;
const byline = p => `${cc0(p)?'':'© '}${p.author}`;
const yuan = n => `¥${Math.round(n).toLocaleString('zh-CN')}`;
function toast(text) { clearTimeout(toastTimer); $('#toast').textContent=text; $('#toast').classList.add('show'); toastTimer=setTimeout(()=>$('#toast').classList.remove('show'),3500); }
function updateAddress() { if(!addressDirty)return; const next=new URL(location.href); next.searchParams.set('day',selectedDay); next.searchParams.set('start',start); history.replaceState(null,'',next); }
function hotelUrl(h) {
  const raw=url(h.sourceUrl); if(start!==17) return raw;
  // Only rewrite date params that already exist (booking.com: checkin/checkout; book-directonline: checkInDate/checkOutDate); keep other params byte-for-byte.
  const dates={checkin:h.checkin,checkInDate:h.checkin,checkout:h.checkout,checkOutDate:h.checkout};
  try{const u=new URL(raw);u.search=u.search.replace(/([?&])(checkin|checkout|checkInDate|checkOutDate)=[^&#]*/g,(_,sep,k)=>`${sep}${k}=${shiftDate(dates[k])}`);return u.href;}catch{return raw;}
}
function hotelHtml(h, day, print=false) {
  if(!h) return '<div class="hotel-card"><span class="eyebrow">OVERNIGHT（过夜）</span><p>国际飞行夜 / 当日抵达，不计酒店住宿。</p></div>';
  return `<div class="hotel-card"${print?'':` id="stay-${day.day}"`}><span class="eyebrow">今晚住 · 候选，未预订</span><h4>${esc(h.name)}</h4><p>${esc(h.beds)}<br>${esc(h.address)}</p><p>${shortDate(shiftDate(h.checkin))}–${shortDate(shiftDate(h.checkout))} · ${esc(h.nights)}晚${start===16?` · ${esc(h.price)}`:' · 库存与价格需重新核查'}</p><p>${start===16?esc(h.cancel):'顺延后取消期限需按新订单核实。'}</p><div class="card-actions"><a class="button small" href="${esc(hotelUrl(h))}" target="_blank" rel="noopener">查看房型与日期 ↗</a>${geo(h)?`<a class="button small quiet" href="${esc(nav(h))}" target="_blank" rel="noopener">地图位置 ↗</a>`:''}</div></div>`;
}
function timeHtml(e, day) {
  const from = startZone(e), to = e.endTimezone, zones = from && to && from !== to;
  return `<div class="time">${esc(e.time)}${zones?`<em>${TZ[from]||''}</em>`:''}${e.endTime?`<small>— ${esc(e.endTime)}${zones?` ${TZ[to]||''}`:''}</small>`:''}</div>`;
}
function timelineHtml(day, print=false) {
  return `<ol class="timeline">${day.events.map((e,i)=>`<li${print?'':` id="evt-${i}"`}${isOptional(e)?' class="optional"':''}>${timeHtml(e, day)}<div class="event"><h4>${print?'':`<span class="pin" data-index="${i}" aria-hidden="true" hidden></span>`}${isOptional(e)?'<span class="badge">可选</span>':''}${esc(e.place)}</h4><p>${esc(eventText(e))}</p>${e.photoTip?`<div class="photo-tip"><b>拍摄笔记</b>${esc(e.photoTip)}</div>`:''}${!print&&geo(e)?`<div class="event-actions"><button class="chip-button locate-event" data-index="${i}" type="button">在地图上看</button><a class="chip-button" href="${esc(nav(e))}" target="_blank" rel="noopener">打开导航 ↗</a></div>`:''}</div></li>`).join('')}</ol>`;
}
function dayFrameHtml(day) {
  const sun = D.light.find(s=>s.date===day.date && s.area===day.area);
  return `<section class="day-frame"><p class="eyebrow">今日拍摄</p><h4>${esc(day.photoGoal || '让旅途有呼吸的空间')}</h4><p>${esc(scheduleText(day.lightNote || '相机设置是拍摄起点；云量、风和山体遮挡决定现场光线。'))}</p>${sun?`<div class="light-times"><span>日出约 ${esc(sun.sunrise)}</span><span>日落约 ${esc(sun.sunset)}</span></div><p class="light-note">${start===17?'顺延日期未重算；此处仍为原计划日期参考。':esc(sun.note || '平地天文时刻；山体会改变实际见光时间。')}</p>`:''}</section>`;
}
function renderStrip() {
  $('#loading-note').hidden=true;
  $('#day-strip').innerHTML=D.days.map(d=>{const on=d.day===selectedDay;return `<button class="day-button${on?' active':''}" id="tab-${d.day}" data-day="${d.day}" role="tab" aria-selected="${on}" aria-controls="day-detail" tabindex="${on?0:-1}" type="button"><small>${shortDate(dateOf(d.day))} · 第${d.day}天</small><b>${esc(d.shortTitle || d.area)}</b></button>`;}).join('');
  $$('#day-strip .day-button').forEach(b=>b.addEventListener('click',()=>chooseDay(Number(b.dataset.day))));
}
function renderDay(announce=true) {
  const day = D.days.find(d=>d.day===selectedDay), a=document.activeElement;
  const focusKey = a?.closest?.('#day-strip,#day-detail') ? (a.matches('.day-button') ? `.day-button[data-day="${a.dataset.day}"]` : a.id ? `#${a.id}` : null) : null;
  renderStrip();
  const h = D.hotels.find(x=>x.id===day.hotelId), prev = D.days.find(d=>d.day===day.day-1), next = D.days.find(d=>d.day===day.day+1);
  const opt = day.events.filter(isOptional).length;
  $('#day-detail').innerHTML=`<div class="day-head"><p class="eyebrow">第${day.day}天 · ${shortDate(dateOf(day.day))} ${weekday(dateOf(day.day))}</p><div class="day-controls"><button id="prev-day" aria-label="前一天" type="button" ${day.day===1?'disabled':''}>‹</button><button id="next-day" aria-label="后一天" type="button" ${day.day===D.days.length?'disabled':''}>›</button></div></div><h3 class="day-title" id="day-title" tabindex="-1">${esc(day.title)}</h3><p class="day-summary">${esc(scheduleText(day.summary))}</p><div class="day-meta"><span class="tag">${esc(day.timezone)}</span><span class="tag">${esc(day.drive)}</span><span class="tag">${day.events.length-opt}项安排${opt?` · ${opt}项可选`:''}</span>${h?`<a class="tag link" href="#stay-${day.day}">今晚住：${esc(h.name)} ↓</a>`:''}</div>${dayFrameHtml(day)}<details class="rain-plan" id="rain-plan"${rainOpen?' open':''}><summary>天气不好怎么办</summary><p>${esc(scheduleText(day.weatherPlan))}</p></details>${timelineHtml(day)}${hotelHtml(h, day)}<nav class="day-pager" aria-label="翻到前后一天">${prev?`<button class="pager prev" data-go="${prev.day}" type="button"><small>上一天</small><b>第${prev.day}天 · ${esc(prev.shortTitle||prev.area)}</b></button>`:'<span></span>'}${next?`<button class="pager next" data-go="${next.day}" type="button"><small>下一天</small><b>第${next.day}天 · ${esc(next.shortTitle||next.area)}</b></button>`:'<span></span>'}</nav>`;
  $('#day-detail').setAttribute('aria-labelledby',`tab-${day.day}`);
  $('#prev-day').onclick=()=>chooseDay(selectedDay-1); $('#next-day').onclick=()=>chooseDay(selectedDay+1);
  $$('#day-detail .pager').forEach(b=>b.onclick=()=>{chooseDay(Number(b.dataset.go));revealDay();});
  $('#rain-plan').ontoggle=e=>{rainOpen=e.target.open;};
  $$('#day-detail .locate-event').forEach(b=>b.onclick=()=>focusEvent(Number(b.dataset.index), b));
  $('#hero-dates').textContent=`11.${start} — 11.${start+D.days.length-1}`;
  $('#shift-notice').hidden=start!==17; $('#toggle-draft').hidden=start===17; document.body.classList.toggle('draft',start===17);
  if(focusKey){let f=$(focusKey);if(f?.disabled)f=$(focusKey==='#prev-day'?'#next-day':'#prev-day');f?.focus({preventScroll:true});}
  if(announce)$('#day-status').textContent=`第${day.day}天 · ${shortDate(dateOf(day.day))} · ${day.shortTitle || day.area}`;
  hideReturn(); updateAddress(); renderMap(); renderOverview();
}
// Scroll only the strip horizontally so deep links and day changes never move the whole page.
function stripTo(smooth) { const s=$('#day-strip'),b=s.querySelector('.day-button.active'); if(!b)return; const sr=s.getBoundingClientRect(),br=b.getBoundingClientRect(); s.scrollTo({left:s.scrollLeft+br.left-sr.left-(sr.width-br.width)/2,behavior:smooth&&!reducedMotion?'smooth':'auto'}); }
function chooseDay(n) { selectedDay=Math.min(D.days.length,Math.max(1,n)); mapMode='day'; addressDirty=true; renderDay(); stripTo(true); }
// After paging from the bottom of a long day, bring the new day's heading back into view.
function revealDay() { const t=$('#day-title'); if(!t)return; const top=t.getBoundingClientRect().top; if(top<0||top>innerHeight*.6){t.scrollIntoView({behavior:behavior(),block:'start'});} t.focus({preventScroll:true}); }
function initMap() {
  map=L.map('map',{scrollWheelZoom:false,keyboard:true,zoomControl:false,dragging:!coarsePointer,zoomAnimation:!reducedMotion,fadeAnimation:!reducedMotion}).setView([-43.9,170.1],7);
  L.control.zoom({position:'topright',zoomInTitle:'Zoom in（放大）',zoomOutTitle:'Zoom out（缩小）'}).addTo(map);map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a><span class="zh">（地图组件）</span>');
  if(coarsePointer)$('#map-hint').hidden=false;
  let errors=0;
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:18,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors<span class="zh">（开放街图贡献者）</span>',crossOrigin:true}).on('tileerror',()=>{if(++errors>3)$('#map-fallback').hidden=false;}).addTo(map);
  mapLayers=L.layerGroup().addTo(map);
  // Phones: the zoom buttons share the map's right edge with popups, so step them aside while a popup is open.
  map.on('popupopen',()=>map.getContainer().classList.add('popup-open'));map.on('popupclose',()=>map.getContainer().classList.remove('popup-open'));
}
function mapUnavailable() { $('#map-fallback').hidden=false; $('#map').textContent='地图组件无法载入，请使用每条行程下的导航链接。'; $('.map-toolbar').hidden=true; }
// evs: [day,index,event] triples drawn at this point; several events (or a hotel's own stay events) are listed in one popup.
function marker(p,label,hotel=false,evs=[],optional=false) {
  const icon=L.divIcon({className:'marker-hit',html:`<div class="map-marker${hotel?' hotel':''}${optional?' optional':''}">${esc(label)}</div>`,iconSize:[44,44],iconAnchor:[22,22],popupAnchor:[0,-14]});
  const m=L.marker([p.lat,p.lon],{icon,title:p.place||p.name,alt:p.place||p.name,keyboard:true,zIndexOffset:hotel?-100:0}).addTo(mapLayers);
  const list=evs.length>1||(hotel&&evs.length)?`<ul>${evs.map(([day,,e])=>`<li><b>${mapMode==='all'?`第${day.day}天 `:''}${esc(e.time)}</b> ${isOptional(e)?'（可选）':''}${!hotel&&e.place!==p.place?`${esc(e.place)}：`:''}${esc(eventText(e))}${e.photoTip?`<br><small>${esc(e.photoTip)}</small>`:''}</li>`).join('')}</ul>`:'';
  const small=innerWidth<=600, maxHeight=Math.max(150,($('#map').clientHeight||320)-(small?150:96));
  m.bindPopup(`<h4>${esc(p.place||p.name)}</h4>${hotel?`<p>${esc(p.beds||'')}</p>${list}`:list||`<p>${esc(eventText(p))}</p>${p.photoTip?`<p>${esc(p.photoTip)}</p>`:''}`}<p class="popup-note">规划定位；以现场入口、标识为准。</p><a href="${esc(nav(p))}" target="_blank" rel="noopener">打开地图导航 ↗</a>`,{maxHeight,autoPanPaddingTopLeft:L.point(16,64),autoPanPaddingBottomRight:small?L.point(60,44):L.point(16,24)});
  return m;
}
function renderMap() {
  $('#day-view').parentElement.style.setProperty('--seg-index',mapMode==='all'?1:0);
  $('#day-view').classList.toggle('active',mapMode==='day'); $('#day-view').setAttribute('aria-pressed',mapMode==='day');
  $('#all-view').classList.toggle('active',mapMode==='all'); $('#all-view').setAttribute('aria-pressed',mapMode==='all');
  $('#map-mode-note').textContent=mapMode==='all'?'新西兰全程只画第4–10天；悉尼三天和飞行日请切回“当天”。数字＝第几天':'虚线只表示先后顺序，不是道路导航';
  if(!map)return;
  mapLayers.clearLayers();activeMarkers.clear();const bounds=[],flightBounds=[],all=mapMode==='all',labels=[],points=new Map();let n=0;
  // Overview keeps to the South Island road trip; Sydney and flight days are readable only day by day.
  const days=all?D.days.filter(d=>d.day>=4&&d.day<=D.days.length-2):D.days.filter(d=>d.day===selectedDay);
  // Hotels shown as H absorb their own stay events (same placeId), so no numbered marker hides under the H.
  const stays=new Map(($('#hotels-toggle').checked?D.hotels.filter(h=>geo(h)&&(all||days.some(d=>d.hotelId===h.id))):[]).map(h=>[h.id,{p:h,label:'H',evs:[]}]));
  days.forEach(day=>{
    const line=[];
    day.events.forEach((e,i)=>{if(!geo(e))return; const key=`${e.lat},${e.lon}`;line.push([e.lat,e.lon]);(e.kind==='flight'?flightBounds:bounds).push([e.lat,e.lon]);
      const pt=stays.get(e.placeId)||points.get(key)||points.set(key,{p:e,label:all?day.day:++n,evs:[]}).get(key);pt.evs.push([day,i,e]);
    });
    if(line.length>1)L.polyline(line,{color:day.day<=3?'#c55300':'#6155f5',weight:2.5,opacity:.7,dashArray:'5,8',interactive:false}).addTo(mapLayers);
  });
  [...points.values(),...stays.values()].forEach(pt=>{const hotel=pt.label==='H',m=marker(pt.p,pt.label,hotel,all&&hotel?[]:pt.evs,!hotel&&pt.evs.every(([, ,e])=>isOptional(e)));if(hotel)bounds.push([pt.p.lat,pt.p.lon]);pt.evs.forEach(([day,i])=>{activeMarkers.set(`${day.day}-${i}`,m);if(!all)labels[i]=pt.label;});});
  $$('#day-detail .pin').forEach(s=>{const l=labels[s.dataset.index];s.hidden=l==null;s.textContent=l??'';s.classList.toggle('hotel',l==='H');});
  // Departure airports would zoom a landing day out to half a continent; frame the ground plan when there is one.
  const frame=bounds.length?bounds:flightBounds;
  if(frame.length)map.fitBounds(frame,{paddingTopLeft:[28,72],paddingBottomRight:[28,28],maxZoom:13,animate:!reducedMotion});
}
function focusEvent(index, trigger) {
  if(!map){toast('地图未载入，请使用每条行程下的导航链接。');return;}
  let m=activeMarkers.get(`${selectedDay}-${index}`);if(!m&&mapMode!=='day'){mapMode='day';renderMap();m=activeMarkers.get(`${selectedDay}-${index}`);}
  if(!m){toast('此地点暂未标注精确坐标，请使用导航链接。');return;}
  const r=$('#map').getBoundingClientRect(), visible=r.top>=0&&r.bottom<=innerHeight;
  if(!visible){returnTo={index,trigger,left:false};$('#map').scrollIntoView({behavior:behavior(),block:'center'});showReturn(index);}
  map.setView(m.getLatLng(),14,{animate:!reducedMotion});
  // Open after the pan settles so the popup is not clipped; the timer covers a setView that does not move.
  let opened=false;const open=()=>{if(opened)return;opened=true;m.openPopup();document.querySelector('.leaflet-popup a[href^="https"]')?.focus({preventScroll:true});};
  if(reducedMotion)open();else{map.once('moveend',open);setTimeout(open,700);}
}
function showReturn(index){const b=$('#return-pill');b.textContent=`↓ 回到第${index+1}项`;b.hidden=false;}
function hideReturn(){$('#return-pill').hidden=true;returnTo=null;}
function backToEvent(){if(!returnTo)return hideReturn();const {index,trigger}=returnTo;const li=$(`#evt-${index}`);hideReturn();li?.scrollIntoView({behavior:behavior(),block:'center'});(trigger&&document.contains(trigger)?trigger:li?.querySelector('.locate-event'))?.focus({preventScroll:true});}
function imageFailure(img){if(img.hasAttribute('srcset')){img.removeAttribute('srcset');img.removeAttribute('sizes');img.src=img.src;return;}const parent=img.parentElement;img.hidden=true;parent.classList.add('image-error');const note=document.createElement('p');note.textContent='照片暂时无法加载 · 可查看原出处';parent.append(note);}
// Wikimedia thumbnails can be requested at smaller widths; never ask for more than the stored width.
// Wikimedia only serves its standard thumbnail widths (https://w.wiki/GHai); 480/800 return HTTP 400.
const THUMB_WIDTHS=[330,500,960,1280];
function srcset(src){const m=String(src).match(/\/(\d+)px-[^/]+$/);if(!m)return '';const w=Number(m[1]);return [...new Set([...THUMB_WIDTHS.filter(x=>x<w),w])].map(x=>`${esc(src.replace(/\/\d+px-([^/]+)$/,`/${x}px-$1`))} ${x}w`).join(', ');}
function showPhoto(id) {const p=D.photos.find(p=>p.id===id);if(!p)return;$('#dialog-content').innerHTML=`<img src="${esc(url(p.imageUrl))}" alt="${esc(p.alt)}" width="1280" height="853"><div class="dialog-copy"><h3 id="dialog-title">${esc(p.title)}</h3><p>${esc(p.shootingTip)}</p><p>${esc(p.seasonNote)}</p><p class="dialog-credit">真实摄影作品${workTitle(p)?` · 原题“${esc(workTitle(p))}”`:''} · ${esc(byline(p))} · <a href="${esc(url(p.licenseUrl))}" target="_blank" rel="noopener">${esc(licenseLabel(p))}</a> · <a href="${esc(url(p.sourceUrl))}" target="_blank" rel="noopener">查看原作品与大图 ↗</a></p>${p.day?`<button class="button small" id="dialog-day" data-day="${p.day}" type="button">在第${p.day}天行程中查看</button>`:''}</div>`;const go=$('#dialog-day');if(go)go.onclick=()=>{$('#photo-dialog').close();openDayFromElsewhere(Number(go.dataset.day));};$('#photo-dialog').showModal();}
function openDayFromElsewhere(day){chooseDay(day);$('#planner').scrollIntoView({behavior:behavior()});setTimeout(()=>$('#day-title')?.focus({preventScroll:true}),reducedMotion?0:450);}
function renderPhotos() {
  $('#photo-grid').innerHTML=D.photos.map(p=>{const set=srcset(url(p.imageUrl));return `<article class="photo-card"><button class="photo-button" data-photo="${esc(p.id)}" aria-label="放大查看${esc(p.title)}" type="button"><img src="${esc(url(p.imageUrl))}"${set?` srcset="${set}" sizes="(max-width: 600px) calc(100vw - 32px), (max-width: 1100px) 50vw, 400px"`:''} alt="${esc(p.alt)}" loading="lazy" decoding="async" width="720" height="500"><span>真实摄影 ↗</span></button><div class="photo-copy"><p class="eyebrow">${esc(p.place)}</p><h3>${esc(p.title)}</h3><p>${esc(p.shootingTip)}</p><p class="season-note">${esc(p.seasonNote)}</p><a class="credit" href="${esc(url(p.sourceUrl))}" target="_blank" rel="noopener">${esc(byline(p))} · ${esc(licenseLabel(p))} · 原作品 ↗</a>${p.day?`<button class="chip-button photo-day" data-day="${p.day}" type="button">在第${p.day}天行程中查看</button>`:''}</div></article>`;}).join('');
  $$('#photo-grid [data-photo]').forEach(b=>b.onclick=()=>showPhoto(b.dataset.photo));
  $$('#photo-grid .photo-day').forEach(b=>b.onclick=()=>openDayFromElsewhere(Number(b.dataset.day)));
  $$('#photo-grid img').forEach(img=>img.onerror=()=>imageFailure(img));
  const hero=D.photos.find(p=>p.hero)||D.photos[0];if(hero){const img=$('#hero-image');if(img.getAttribute('src')!==url(hero.imageUrl))img.src=url(hero.imageUrl);img.onerror=()=>{img.hidden=true;};$('#hero-credit').href=url(hero.sourceUrl);$('#hero-credit').textContent=`照片：${hero.place} · ${hero.author} · ${licenseLabel(hero)} ↗`;}
}
function cards(items,className) {return (items||[]).map(c=>`<article class="${className}"><h3>${esc(c.title)}</h3><p>${esc(c.body).replace(/\n/g,'<br>')}</p><div class="source-links">${refLinks(c.sourceIds)}</div></article>`).join('');}
const amount = n => n.toLocaleString('zh-CN',{maximumFractionDigits:2});
const range = r => r.min===r.max ? amount(r.min) : `${amount(r.min)}–${amount(r.max)}`;
const GROUPS=[['flight','机票'],['hotel','住宿'],['rental','租车'],['activity','峡湾游船'],['food','餐饮'],['ground','交通、油费和停车'],['other','入境、保险、通信、行李和机动金']];
const groupOf = r => GROUPS.some(([k])=>k===r.category) ? r.category : 'other';
function renderBudget(){
  const s=D.budget.summary, fx=D.budget.fx, rows=D.budget.rows, max=s.totalCNY.max, over=-s.headroomCNY;
  const pick=id=>rows.find(r=>r.id===id)?.perPersonCnyUnrounded.max||0, lean=max-pick('bag-oversize')-pick('card-fx-fee');
  const sums=GROUPS.map(([k,label])=>({k,label,min:rows.filter(r=>groupOf(r)===k).reduce((a,r)=>a+r.perPersonCnyUnrounded.min,0),max:rows.filter(r=>groupOf(r)===k).reduce((a,r)=>a+r.perPersonCnyUnrounded.max,0)}));
  $('#budget-hero').innerHTML=`<div class="budget-total"><p class="eyebrow">每人全程（含¥1,000机动金）</p><p class="big-number">${yuan(s.totalCNY.min)}<span>–</span>${yuan(max)}</p><p class="budget-verdict ${over>0?'over':'ok'}">${over>0?`按上限超出3万约 ${yuan(over)}`:`按上限距3万还剩 ${yuan(-over)}`}</p><p class="budget-tip">换三边和≤158cm的托运箱，并确认招行卡是免货币兑换费的人民币结算版，上限约 ${yuan(lean)}。悉尼两卧公寓和多打车是选定的舒适度取舍。</p></div><div class="budget-bars" role="list">${sums.map(g=>`<div class="bar-row" role="listitem"><span class="bar-label">${g.label}</span><span class="bar"><i style="width:${(g.max/max*100).toFixed(1)}%"></i></span><span class="bar-value">${g.min===g.max?yuan(g.max):`${yuan(g.min)}–${yuan(g.max)}`}</span></div>`).join('')}</div>`;
  const hotelPer=h=>h.nativeTotal*fx[h.currency]/3;
  $('#stay-table').innerHTML=`<ul class="list-table">${D.hotels.map(h=>`<li><div><b>${esc(h.name)}</b><small>${shortDate(h.checkin)}–${shortDate(h.checkout)} · ${h.nights}晚 · ${esc(h.beds)}</small></div><span class="num">${yuan(hotelPer(h))}<small>每人</small></span></li>`).join('')}</ul>`;
  $('#flight-table').innerHTML=`<ul class="list-table">${rows.filter(r=>r.category==='flight').map(r=>`<li><div><b>${esc(r.title)}</b><small>${esc(r.status)}</small></div><span class="num">${yuan(r.perPersonCny.min)}<small>每人</small></span></li>`).join('')}</ul>`;
  const groupRows=GROUPS.map(([k,label])=>{const list=rows.filter(r=>groupOf(r)===k);if(!list.length)return '';const g=sums.find(x=>x.k===k);return `<tr class="group-row"><th scope="rowgroup" colspan="2">${label}</th><td>${g.min===g.max?yuan(g.max):`${yuan(g.min)}–${yuan(g.max)}`}</td></tr>${list.map(r=>`<tr><td data-label="项目"><strong>${esc(r.title)}</strong><small>${esc(r.status)}</small><details class="row-note"><summary>说明与来源</summary><small>${esc(r.note)}</small>${refLinks(r.sourceIds)}</details></td><td data-label="每人原币">${esc(r.currency)} ${range(r.perPersonNative)}</td><td data-label="约合人民币">${r.perPersonCny.min===r.perPersonCny.max?yuan(r.perPersonCny.min):`${yuan(r.perPersonCny.min)}–${yuan(r.perPersonCny.max)}`}</td></tr>`).join('')}`;}).join('');
  $('#budget-table').innerHTML=`<div class="table-scroll"><table class="budget"><caption>11月16日主方案 · 上海出发者本人费用 · 报价快照</caption><thead><tr><th>项目</th><th>每人原币</th><th>约合人民币</th></tr></thead><tbody>${groupRows}</tbody><tfoot><tr><th colspan="2">合计（每人）</th><td>${yuan(s.totalCNY.min)}–${yuan(s.totalCNY.max)}</td></tr></tfoot></table></div><p class="planner-note">${esc(s.narrative)}</p><p class="planner-note">折算：AUD1≈¥${esc(fx.AUD)}；NZD1≈¥${esc(fx.NZD)}（${esc(fx.note)}）。${esc(D.budget.summary.comparisonNote)} 现金是上述消费的支付方式，不再次加进总额。可退押金或信用卡预授权需另留额度。</p>`;
  const native=s.nativeTotals;
  $('#budget-table').insertAdjacentHTML('beforeend',`<p class="planner-note">个人原币支出合计：人民币 ¥${range(native.CNY)} ＋ 澳元 AUD ${range(native.AUD)} ＋ 新西兰元 NZD ${range(native.NZD)}；折合人民币的总额见上。三种货币分别列示，包含预算及机动金，不是三人的总花费。</p>`);
  $('#licence-detail').innerHTML=cards(D.budget.licences.map(l=>({title:l.driver,body:l.advice,sourceIds:l.sourceIds})),'risk-card');
}
const WHO={user:'你',tokyo:'东京同学',melbourne:'墨尔本同学',all:'全员'};
const todoKey=id=>`trip-todo:${id}`;
// Session copy keeps ticks working when storage is blocked; storage only makes them survive a reload.
const todoMemory=new Map();let storageWarned=false;
const todoDone=id=>{if(todoMemory.has(id))return todoMemory.get(id);try{return localStorage.getItem(todoKey(id))==='1';}catch{return false;}};
function setTodo(id,done){todoMemory.set(id,done);try{done?localStorage.setItem(todoKey(id),'1'):localStorage.removeItem(todoKey(id));}catch{if(!storageWarned){storageWarned=true;toast('这台设备不能保存勾选，刷新后会丢失。');}}}
const localToday=()=>{const n=new Date();return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}-${String(n.getDate()).padStart(2,'0')}`;};
const overdue=t=>t.due!=='asap'&&t.due<localToday()&&!todoDone(t.id);
const dueLabel=t=>t.due==='asap'?'尽快':`${shortDate(t.due)} ${weekday(t.due)}${overdue(t)?' · 已过期':''}`;
function nextTodo(){const list=(D.todos||[]).filter(t=>!todoDone(t.id));return list.find(overdue)||list.find(t=>t.due==='asap'||t.due>=localToday());}
function renderTodos(){
  const list=(D.todos||[]).filter(t=>todoWho==='all'||t.who.includes(todoWho)||t.who.includes('all'));
  const count=()=>{$('#todo-count').textContent=`已完成 ${list.filter(t=>todoDone(t.id)).length} / ${list.length}`;};count();
  $('#todo-list').innerHTML=list.map(t=>`<li class="${todoDone(t.id)?'done':''}${overdue(t)?' overdue':''}"><label class="todo-check"><input type="checkbox" data-todo="${esc(t.id)}" ${todoDone(t.id)?'checked':''}><span class="due ${t.due==='asap'||overdue(t)?'asap':''}">${dueLabel(t)}</span></label><div class="todo-body"><b>${esc(t.title)}</b><small>${esc(t.detail)}</small><span class="who">${t.who.map(w=>WHO[w]).join('、')}</span>${t.sourceIds?.length?`<span class="source-links">${t.sourceIds.map(id=>D.sources.find(x=>x.id===id)).filter(Boolean).map((x,i)=>`<a href="${esc(url(x.url))}" target="_blank" rel="noopener" title="${esc(x.title)}">来源${i+1} ↗</a>`).join('')}</span>`:''}</div></li>`).join('');
  // Update the ticked row in place so keyboard and screen-reader focus stays on the checkbox.
  $$('#todo-list input').forEach(i=>i.onchange=()=>{const t=list.find(x=>x.id===i.dataset.todo);setTodo(t.id,i.checked);const li=i.closest('li');li.classList.toggle('done',i.checked);li.classList.toggle('overdue',overdue(t));const due=li.querySelector('.due');due.textContent=dueLabel(t);due.classList.toggle('asap',t.due==='asap'||overdue(t));count();renderFacts();});
}
function renderFacts(){
  const s=D.budget.summary, over=-s.headroomCNY, t=nextTodo();
  $('#fact-grid').innerHTML=`<div class="fact"><dt>日期</dt><dd>${shortDate(dateOf(1))} — ${shortDate(dateOf(D.days.length))}<small>${start===17?'顺延草案':'11/15周日深夜从浦东出发'}</small></dd></div><div class="fact"><dt>住宿</dt><dd>悉尼3晚 → 南岛7晚<small>5处，三人各一张床</small></dd></div><div class="fact link"><dt>每人预算</dt><dd><a href="#budget">${yuan(s.totalCNY.min)}–${yuan(s.totalCNY.max)}</a><small>${over>0?`按上限超3万约${yuan(over)} →`:'在3万以内 →'}</small></dd></div><div class="fact link"><dt>最近要办</dt><dd><a href="#before">${t?esc(t.title):'行前事项都已勾完'}</a><small>${t?`${dueLabel(t)} · ${t.who.map(w=>WHO[w]).join('、')} →`:''}</small></dd></div>`;
}
function renderOverview(){
  $('#overview-list').innerHTML=D.days.map(d=>{const h=D.hotels.find(x=>x.id===d.hotelId),date=dateOf(d.day);return `<li><button class="overview-row${d.day===selectedDay?' current':''}" data-day="${d.day}" type="button" aria-label="打开第${d.day}天：${esc(d.title)}"><span class="ov-date"><b>${shortDate(date)}</b><small>${weekday(date)} · 第${d.day}天</small></span><span class="ov-main"><b>${esc(d.title)}</b><small>${esc(d.drive)}</small></span><span class="ov-stay">${h?esc(h.name):'飞机上 / 当日抵达'}</span></button></li>`;}).join('');
  $$('#overview-list .overview-row').forEach(b=>b.onclick=()=>openDayFromElsewhere(Number(b.dataset.day)));
}
function renderRental(){
  $('#rental-highlight').innerHTML=`<h3>${esc(D.rental.title).replace(/\n/g,'<br>')}</h3><div><p>${esc(D.rental.body)}</p><div class="source-links">${refLinks(D.rental.sourceIds)}</div></div>`;
  $('#rental-cards').innerHTML=cards(D.rental.cards,'before-card');
  const quote=D.rental.quote;
  $('#rental-proof').innerHTML=`<summary>查看APEX（租车公司）实际报价截图 <span>未预订</span></summary><p class="planner-note">${esc(quote.proofCaption)}</p><img src="${esc(quote.proofImage)}" alt="${esc(quote.proofAlt || quote.proofCaption)}" loading="lazy" class="proof-image">`;
}
function renderStatic() {
  $('#route-review').innerHTML=cards(D.routeReview,'before-card');
  $('#gear-grid').innerHTML=cards(D.gear,'gear-card');
  $('#weather-highlight').innerHTML=`<h3>${esc(D.weather.highlight.title)}</h3><div><p>${esc(D.weather.highlight.body)}</p><div class="source-links">${refLinks(D.weather.highlight.sourceIds)}</div></div>`;
  $('#weather-grid').innerHTML=cards(D.weather.cards,'weather-card');$('#risk-grid').innerHTML=cards(D.weather.risks,'risk-card');
  $('#before-grid').innerHTML=cards(D.before,'before-card');
  renderBudget();renderRental();renderTodos();renderFacts();renderOverview();
  $('#drone-areas').innerHTML=cards(D.droneAreas.map(a=>({title:a.place,body:a.conclusion,sourceIds:a.sourceIds})),'risk-card');
  $('#sources').innerHTML=`<ul class="sources-list">${D.sources.map(s=>`<li><a href="${esc(url(s.url))}" target="_blank" rel="noopener">${esc(s.title)} ↗</a> <span class="source-date">${s.checked?`核查 ${esc(String(s.checked).replace(/-/g,'.'))}`:'未复核'}</span></li>`).join('')}</ul>`;
  $('#credits').innerHTML=`<h3>照片授权</h3><ul class="credits-list">${D.photos.map(p=>`<li>${esc(p.title)} — ${workTitle(p)?`原题“${esc(workTitle(p))}”，`:''}${esc(byline(p))}；<a href="${esc(url(p.sourceUrl))}" target="_blank" rel="noopener">原作品</a>；<a href="${esc(url(p.licenseUrl))}" target="_blank" rel="noopener">${esc(licenseLabel(p))}</a>。页面卡片以CSS裁切显示，放大视图保留原比例；未将作品标记为本次旅行实拍。</li>`).join('')}</ul>`;
}
function setStart(next){start=next;addressDirty=true;renderDay();renderFacts();stripTo(false);$(next===17?'#back-main':'#toggle-draft').focus({preventScroll:true});}
function buildPrint(){document.querySelector('#print-plan')?.remove();const section=document.createElement('section');section.id='print-plan';section.className='print-only wrap';section.innerHTML=`<h2>完整${D.days.length}日计划 · ${shortDate(dateOf(1))}–${shortDate(dateOf(D.days.length))}</h2><p>${start===17?"17日顺延草案：仅日期顺延，全部报价、航班、库存、取消期限与日月时刻未复核。":"主方案；全部尚未预订。"}</p>`+D.days.map(day=>`<article class="print-day"><p class="eyebrow">第${day.day}天 · ${shortDate(dateOf(day.day))} ${weekday(dateOf(day.day))} · ${esc(day.timezone)}</p><h3>${esc(day.title)}</h3><p>${esc(scheduleText(day.summary))}</p>${timelineHtml(day,true)}<p>风雨替代：${esc(scheduleText(day.weatherPlan))}</p>${hotelHtml(D.hotels.find(h=>h.id===day.hotelId), day, true)}</article>`).join('');$('#overview').after(section);}
// Any print path (button, Ctrl+P, browser menu, mobile "save as PDF") rebuilds the plan for the current start date and opens every <details> until printing ends.
let printState=null;
function beforePrint(){if(!D?.days||!$('.day-button'))return;buildPrint();if(!printState){printState=[...document.querySelectorAll('details:not(.row-note):not([data-print="closed"])')].map(d=>[d,d.open]);printState.forEach(([d])=>d.open=true);}}
function afterPrint(){printState?.forEach(([d,open])=>d.open=open);printState=null;$('#print-plan')?.remove();}
addEventListener('beforeprint',beforePrint);addEventListener('afterprint',afterPrint);
async function share(){
  const link=location.href, what=addressDirty?`第${selectedDay}天（${start===17?'顺延草案':'主方案'}）`:'整份手册';
  if(navigator.share&&coarsePointer){try{await navigator.share({title:document.title,url:link});return;}catch(e){if(e.name==='AbortError')return;}}
  try{await navigator.clipboard.writeText(link);toast(`已复制${what}链接，可以直接发给同行朋友。`);}catch{toast('请复制浏览器地址栏中的链接。');}
}
function initChrome(){
  const bar=$('.topbar'),hero=$('.hero');
  if('IntersectionObserver' in window){
    new IntersectionObserver(([e])=>{bar.dataset.state=e.isIntersecting?'over-media':'scrolled';document.documentElement.toggleAttribute('data-scrolled',!e.isIntersecting);},{rootMargin:'-80px 0px 0px 0px'}).observe(hero);
    // One section is "current" at a time; the tab bar has no rental tab, so rental lights up 行前.
    const tabFor={planner:'planner',overview:'planner',summary:'planner',budget:'budget',before:'before',rental:'before',weather:'weather',photography:'photography'};
    const spy=new IntersectionObserver(es=>es.forEach(e=>{if(!e.isIntersecting)return;const id=e.target.id;$$('.topnav a').forEach(a=>a.hash==='#'+id?a.setAttribute('aria-current','true'):a.removeAttribute('aria-current'));$$('.tabbar a').forEach(a=>a.hash==='#'+tabFor[id]?a.setAttribute('aria-current','true'):a.removeAttribute('aria-current'));}),{rootMargin:'-45% 0px -50% 0px'});
    ['summary','overview','planner','budget','before','rental','weather','photography'].forEach(id=>spy.observe(document.getElementById(id)));
    new IntersectionObserver(([e])=>{if(e.isIntersecting)$$('.topnav a,.tabbar a').forEach(a=>a.removeAttribute('aria-current'));},{rootMargin:'-45% 0px -50% 0px'}).observe(hero);
  } else bar.dataset.state='scrolled';
  // The phone day strip turns into a glass bar once it sticks under the top bar (scroll+rAF: observers miss deep-link jumps).
  const strip=$('#day-strip');let ticking=false;
  const check=()=>{ticking=false;const top=parseFloat(getComputedStyle(strip).top)||0,r=strip.getBoundingClientRect(),sec=$('#planner').getBoundingClientRect();strip.classList.toggle('is-pinned',narrow()&&r.top<=top+1&&sec.bottom>r.bottom);
    if(returnTo){const li=$(`#evt-${returnTo.index}`)?.getBoundingClientRect();const seen=li&&li.bottom>0&&li.top<innerHeight;if(!seen)returnTo.left=true;else if(returnTo.left)hideReturn();}};
  addEventListener('scroll',()=>{if(!ticking){ticking=true;requestAnimationFrame(check);}},{passive:true});addEventListener('resize',check);check();
}
function bindControls(){
  $('#day-view').onclick=()=>{mapMode='day';renderMap();};$('#all-view').onclick=()=>{mapMode='all';renderMap();};$('#hotels-toggle').onchange=renderMap;
  $('#share').onclick=share;$('#print').onclick=()=>window.print();
  $('#toggle-draft').onclick=()=>setStart(17);$('#back-main').onclick=()=>setStart(16);
  $('#return-pill').onclick=backToEvent;
  $('#close-photo').onclick=()=>$('#photo-dialog').close();$('#photo-dialog').onclick=e=>{if(e.target===$('#photo-dialog'))$('#photo-dialog').close();};
  $$('#todo-filter button').forEach((b,i)=>b.onclick=()=>{todoWho=b.dataset.who;$('#todo-filter').style.setProperty('--seg-index',i);$$('#todo-filter button').forEach(x=>{x.classList.toggle('active',x===b);x.setAttribute('aria-pressed',x===b);});renderTodos();});
  // Roving tabindex: the strip is one Tab stop; arrows/Home/End move between days.
  $('#day-strip').addEventListener('keydown',e=>{const keys={ArrowRight:1,ArrowLeft:-1};if(!(e.key in keys)&&e.key!=='Home'&&e.key!=='End')return;e.preventDefault();const n=e.key==='Home'?1:e.key==='End'?D.days.length:selectedDay+keys[e.key];chooseDay(n);$(`.day-button[data-day="${selectedDay}"]`)?.focus();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&map&&!document.querySelector('dialog[open]')&&document.querySelector('.leaflet-popup')){const from=document.activeElement;map.closePopup();if(from?.closest?.('.leaflet-popup'))$('#map').focus();}});
}
async function main(){
  try{const r=await dataRequest;if(!r.ok)throw new Error('行程数据未能载入');D=await r.json();if(!Array.isArray(D.days)||D.days.length!==12||D.days.some((day,index)=>day.day!==index+1))throw new Error('行程数据不完整');selectedDay=Math.min(D.days.length,selectedDay);
    bindControls();renderStatic();renderPhotos();renderDay(false);stripTo(false);initChrome();
    if(hadDayParam)$('#planner').scrollIntoView({behavior:'auto'});
    if(await leafletReady()){initMap();renderMap();}else mapUnavailable();
  }catch(e){$('#loading-note').hidden=false;$('#loading-note').className='fatal-error';$('#loading-note').textContent=`${e.message}。请刷新页面；若仍失败，可从页脚打开行程仓库。`;console.error(e);}
}
main();

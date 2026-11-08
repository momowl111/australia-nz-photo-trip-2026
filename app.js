'use strict';
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const url = s => /^https:\/\//.test(s || '') ? s : '#';
const params = new URLSearchParams(location.search);
const hadDayParam = params.has('day');
let selectedDay = Math.max(1, Math.floor(Number(params.get('day')) || 1));
let start = 17;
// Only write ?day=&start= into the address once the visitor has chosen something (or arrived with them).
let addressDirty = hadDayParam || params.has('start');
let D, map, mapLayers, activeMarkers = new Map(), mapMode = 'day', rainOpen = false, shootOpen = false, todoWho = 'all', toastTimer = 0, returnTo = null;
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
const dotDate = date => `${Number(date.slice(5,7))}.${date.slice(8)}`;
const weekday = date => '周' + '日一二三四五六'[new Date(`${date}T12:00:00Z`).getUTCDay()];
const shiftDate = date => {
  const value = new Date(`${date}T12:00:00Z`); value.setUTCDate(value.getUTCDate() + start - 17);
  return value.toISOString().slice(0,10);
};
const scheduleText = text => start===17 ? text : String(text || '').replace(/11\/(1[5-9]|2[0-7])(?!\d)/g, (_,day)=>`11/${Number(day)+1}`);
const geo = p => Number.isFinite(p.lat) && Number.isFinite(p.lon) && Math.abs(p.lat)<=90 && Math.abs(p.lon)<=180;
// Every New Zealand stop lies east of 166°E and every Australian one west of 154°E, so 165°E splits the two countries.
const inNZ = p => geo(p) && p.lon > 165;
const nav = p => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${p.lat},${p.lon}`)}`;
const sourcesOf = ids => (ids || []).map(id => D.sources.find(s => s.id === id)).filter(Boolean);
const refLinks = ids => sourcesOf(ids).map(s => `<a href="${esc(url(s.url))}" target="_blank" rel="noopener">${esc(s.shortTitle || s.title)} ↗</a>`).join('<span aria-hidden="true"> · </span>');
// Source links sit under the text they support, small, and only once the text is expanded.
const srcBlock = ids => { const links = refLinks(ids); return links ? `<p class="src">来源：${links}</p>` : ''; };
// Always-visible texts keep their sources behind a small "来源 · N条" toggle.
const srcFold = ids => { const n = sourcesOf(ids).length; return n ? `<details class="src-fold"><summary>来源 · ${n}条</summary><p class="src">${refLinks(ids)}</p></details>` : ''; };
const eventText = e => scheduleText(e.detail || '');
const isOptional = e => !!e.optional || e.kind === 'photo_optional';
const TZ = {'Asia/Shanghai':'北京','Australia/Sydney':'悉尼','Australia/Melbourne':'墨尔本','Pacific/Auckland':'新西兰'};
const AIRPORT_TZ = {pvg:'Asia/Shanghai',syd_t1:'Australia/Sydney',mel_t2:'Australia/Melbourne',akl_airport:'Pacific/Auckland',zqn_airport:'Pacific/Auckland',chc_airport:'Pacific/Auckland'};
const startZone = e => e.timezone || (e.endTimezone ? AIRPORT_TZ[e.placeId] || null : null);
const workTitle = p => String(p.sourceTitle || '').replace(/^File:\s*/i,'').replace(/\.[a-z0-9]{2,5}$/i,'').trim();
const cc0 = p => /^CC0\b/i.test(p.license || '');
// Creative Commons = 知识共享, BY = 署名, SA = 相同方式共享.
const licenseLabel = p => cc0(p) ? 'CC0（公有领域贡献）' : /^CC BY-SA\s/i.test(p.license || '') ? `${p.license}（知识共享署名—相同方式共享）` : /^CC BY\s/i.test(p.license || '') ? `${p.license}（知识共享署名）` : p.license;
const byline = p => `${cc0(p)?'':'© '}${p.author}`;
const yuan = n => `¥${Math.round(n).toLocaleString('zh-CN')}`;
// Australia/New Zealand colour coding comes from the one-page summary; a day without one falls back to where its stops are.
const regionOf = n => D.glance?.days?.find(g => g.day === n)?.region || (D.days[n-1]?.events.some(inNZ) ? 'nz' : 'au');
function toast(text) { clearTimeout(toastTimer); $('#toast').textContent=text; $('#toast').classList.add('show'); toastTimer=setTimeout(()=>$('#toast').classList.remove('show'),3500); }
function updateAddress() { if(!addressDirty)return; const next=new URL(location.href); next.searchParams.set('day',selectedDay); next.searchParams.set('start',start); history.replaceState(null,'',next); }
function hotelUrl(h) {
  const raw=url(h.sourceUrl); if(start!==17) return raw;
  // Only rewrite date params that already exist (booking.com: checkin/checkout; book-directonline: checkInDate/checkOutDate); keep other params byte-for-byte.
  const dates={checkin:h.checkin,checkInDate:h.checkin,checkout:h.checkout,checkOutDate:h.checkout};
  try{const u=new URL(raw);u.search=u.search.replace(/([?&])(checkin|checkout|checkInDate|checkOutDate)=[^&#]*/g,(_,sep,k)=>`${sep}${k}=${shiftDate(dates[k])}`);return u.href;}catch{return raw;}
}
function hotelHtml(h, day, print=false) {
  if(!h) return '<div class="hotel-card"><p class="kicker">今晚 · 过夜</p><p class="hotel-none">国际飞行夜 / 当日抵达，不计酒店住宿。</p></div>';
  return `<div class="hotel-card"${print?'':` id="stay-${day.day}"`}><p class="kicker">今晚住 · ${h.booked&&start===17?'<span class="ok">已预订</span>':'候选，未预订'}</p><h4>${esc(h.name)}</h4><dl class="kv"><dt>床位</dt><dd>${esc(h.beds)}</dd><dt>地址</dt><dd>${esc(h.address)}</dd>${h.reviews?`<dt>住客评分</dt><dd>${esc(h.reviews)}</dd>`:''}<dt>日期</dt><dd>${shortDate(shiftDate(h.checkin))}–${shortDate(shiftDate(h.checkout))} · ${esc(h.nights)}晚${start===17?` · ${esc(h.price)}`:' · 库存与价格需重新核查'}</dd><dt>取消</dt><dd>${start===17?esc(h.cancel):'顺延后取消期限需按新订单核实。'}</dd></dl><div class="card-actions"><a class="link-btn" href="${esc(hotelUrl(h))}" target="_blank" rel="noopener">查看房型与日期 ↗</a>${geo(h)?`<a class="link-btn" href="${esc(nav(h))}" target="_blank" rel="noopener">地图位置 ↗</a>`:''}</div></div>`;
}
// The time column is narrow on phones: "— 次日07:00" reads in order (it wraps as "— 次日" / "07:00"), and the arrival city gets its own line.
function timeHtml(e, day) {
  const from = startZone(e), to = e.endTimezone, zones = from && to && from !== to, [, pre='', end=''] = /^(\D*)(.*)$/.exec(e.endTime || '') || [];
  return `<div class="time">${esc(e.time)}${zones?`<em>${TZ[from]||''}</em>`:''}${e.endTime?`<small>— ${esc(pre.trim())}${esc(end || e.endTime)}</small>${zones&&TZ[to]?`<small>${esc(TZ[to])}</small>`:''}`:''}</div>`;
}
// On screen each event shows three lines; 展开全文 reveals the rest and its photo note. Print shows everything.
function timelineHtml(day, print=false) {
  return `<ol class="timeline">${day.events.map((e,i)=>{
    const tip=e.photoTip?`<div class="photo-tip"><b>拍摄笔记</b>${esc(e.photoTip)}</div>`:'';
    const body=print?`<p>${esc(eventText(e))}</p>${tip}`:`<div class="clamp" id="evt-text-${i}"><p>${esc(eventText(e))}</p>${tip}</div><button class="more" type="button" aria-expanded="false" aria-controls="evt-text-${i}">展开全文</button>`;
    return `<li${print?'':` id="evt-${i}"`}${isOptional(e)?' class="optional"':''}>${timeHtml(e, day)}<div class="event"><h4>${print?'':`<span class="pin" data-index="${i}" aria-hidden="true" hidden></span>`}${isOptional(e)?'<span class="badge">可选</span>':''}${esc(e.place)}</h4>${body}${!print&&geo(e)?`<div class="event-actions"><button class="link-btn locate-event" data-index="${i}" type="button">在地图上看</button><a class="link-btn" href="${esc(nav(e))}" target="_blank" rel="noopener">打开导航 ↗</a></div>`:''}</div></li>`;}).join('')}</ol>`;
}
const lightOf = day => D.light.find(s=>s.date===day.date && s.area===day.area);
// The day's photo plan and the bad-weather plan sit after the timetable as two closed rows, so the hours come first.
function dayMoreHtml(day) {
  const sun = lightOf(day);
  return `<div class="day-more"><details class="more-row shoot" id="shoot-plan"${shootOpen?' open':''}><summary><i aria-hidden="true"></i>今日拍摄与光线</summary><div class="more-body"><p class="goal">${esc(day.photoGoal || '让旅途有呼吸的空间')}</p><p>${esc(scheduleText(day.lightNote || '相机设置是拍摄起点；云量、风和山体遮挡决定现场光线。'))}</p>${sun?`<p class="light-note">${start!==17?'顺延日期未重算；此处仍为原计划日期参考。':esc(sun.note || '平地天文时刻；山体会改变实际见光时间。')}</p>`:''}</div></details><details class="more-row rain" id="rain-plan"${rainOpen?' open':''}><summary><i aria-hidden="true"></i>天气不好怎么办</summary><div class="more-body"><p>${esc(scheduleText(day.weatherPlan))}</p></div></details></div>`;
}
function renderStrip() {
  $('#loading-note').hidden=true;
  const today=localToday();
  $('#day-strip').innerHTML=D.days.map(d=>{const on=d.day===selectedDay,date=dateOf(d.day),now=date===today;return `<button class="day-button ${regionOf(d.day)}${on?' active':''}${now?' today':''}" id="tab-${d.day}" data-day="${d.day}" role="tab" aria-selected="${on}" aria-controls="day-detail" tabindex="${on?0:-1}" type="button"><small><span class="sr-only">第${d.day}天 </span>${shortDate(date)} ${weekday(date)}${now?' · 今天':''}</small><b>${esc(d.shortTitle || d.area)}</b></button>`;}).join('');
  // From the pinned phone strip (reading deep inside a day), a new day opens at its map instead of mid-timeline.
  $$('#day-strip .day-button').forEach(b=>b.addEventListener('click',()=>{const pinned=$('#day-strip').classList.contains('is-pinned');chooseDay(Number(b.dataset.day));if(pinned)$('#planner .planner-shell')?.scrollIntoView({behavior:behavior(),block:'start'});}));
}
function renderDay(announce=true) {
  const day = D.days.find(d=>d.day===selectedDay), a=document.activeElement;
  const focusKey = a?.closest?.('#day-strip,#day-detail') ? (a.matches('.day-button') ? `.day-button[data-day="${a.dataset.day}"]` : a.id ? `#${a.id}` : null) : null;
  renderStrip();
  const h = D.hotels.find(x=>x.id===day.hotelId), prev = D.days.find(d=>d.day===day.day-1), next = D.days.find(d=>d.day===day.day+1);
  const opt = day.events.filter(isOptional).length, date = dateOf(day.day), sun = lightOf(day);
  // Order: title, a three-line summary, the facts box (sunrise/sunset included), then the timetable; the photo plan and rain plan follow it.
  $('#day-detail').innerHTML=`<div class="day-head"><p class="day-kicker"><i class="region-dot ${regionOf(day.day)}" aria-hidden="true"></i>第${day.day}天 · ${shortDate(date)} ${weekday(date)}${date===localToday()?' · 今天':''}</p><div class="day-controls"><button id="prev-day" aria-label="前一天" type="button" ${day.day===1?'disabled':''}>‹</button><button id="next-day" aria-label="后一天" type="button" ${day.day===D.days.length?'disabled':''}>›</button></div></div><h3 class="day-title" id="day-title" tabindex="-1">${esc(day.title)}</h3><div class="day-sum"><div class="clamp" id="day-sum"><p class="day-summary">${esc(scheduleText(day.summary))}</p></div><button class="more" type="button" aria-expanded="false" aria-controls="day-sum">展开全文</button></div><dl class="day-facts"><dt>时区</dt><dd>${esc(day.timezone)}</dd><dt>交通</dt><dd>${esc(day.drive)}</dd><dt>安排</dt><dd>${day.events.length-opt}项安排${opt?` · ${opt}项可选`:''}</dd>${sun?`<dt>光线</dt><dd>日出约 ${esc(sun.sunrise)} · 日落约 ${esc(sun.sunset)}</dd>`:''}${h?`<dt>今晚住</dt><dd><a href="#stay-${day.day}">${esc(h.name)} ↓</a></dd>`:''}</dl>${timelineHtml(day)}${dayMoreHtml(day)}${hotelHtml(h, day)}<nav class="day-pager" aria-label="翻到前后一天">${prev?`<button class="pager prev" data-go="${prev.day}" type="button"><small>‹ 上一天</small><b>第${prev.day}天 · ${esc(prev.shortTitle||prev.area)}</b></button>`:'<span></span>'}${next?`<button class="pager next" data-go="${next.day}" type="button"><small>下一天 ›</small><b>第${next.day}天 · ${esc(next.shortTitle||next.area)}</b></button>`:'<span></span>'}</nav>`;
  $('#day-detail').setAttribute('aria-labelledby',`tab-${day.day}`);
  $('#prev-day').onclick=()=>chooseDay(selectedDay-1); $('#next-day').onclick=()=>chooseDay(selectedDay+1);
  $$('#day-detail .pager').forEach(b=>b.onclick=()=>{chooseDay(Number(b.dataset.go));revealDay();});
  $('#rain-plan').ontoggle=e=>{rainOpen=e.target.open;};$('#shoot-plan').ontoggle=e=>{shootOpen=e.target.open;};
  $$('#day-detail .locate-event').forEach(b=>b.onclick=()=>focusEvent(Number(b.dataset.index), b));
  if(focusKey){let f=$(focusKey);if(f?.disabled)f=$(focusKey==='#prev-day'?'#next-day':'#prev-day');f?.focus({preventScroll:true});}
  if(announce)$('#day-status').textContent=`第${day.day}天 · ${shortDate(dateOf(day.day))} · ${day.shortTitle || day.area}`;
  hideReturn(); updateAddress(); renderMap(); markCurrent(); fitClamps($('#day-detail'));
}
// Scroll only the strip horizontally so deep links and day changes never move the whole page.
function stripTo(smooth) { const s=$('#day-strip'),b=s.querySelector('.day-button.active'); if(!b||s.scrollWidth<=s.clientWidth)return; const sr=s.getBoundingClientRect(),br=b.getBoundingClientRect(); s.scrollTo({left:s.scrollLeft+br.left-sr.left-(sr.width-br.width)/2,behavior:smooth&&!reducedMotion?'smooth':'auto'}); }
function chooseDay(n) { selectedDay=Math.min(D.days.length,Math.max(1,n)); mapMode='day'; addressDirty=true; renderDay(); stripTo(true); }
// After paging from the bottom of a long day, bring the new day's heading back into view.
function revealDay() { const t=$('#day-title'); if(!t)return; const top=t.getBoundingClientRect().top; if(top<0||top>innerHeight*.6){t.scrollIntoView({behavior:behavior(),block:'start'});} t.focus({preventScroll:true}); }
// The route line follows the page palette (lake blue, lighter in dark mode).
const routeColor = () => getComputedStyle(document.documentElement).getPropertyValue('--route').trim() || '#2b74ab';
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
  $('#day-view').classList.toggle('active',mapMode==='day'); $('#day-view').setAttribute('aria-pressed',mapMode==='day');
  $('#all-view').classList.toggle('active',mapMode==='all'); $('#all-view').setAttribute('aria-pressed',mapMode==='all');
  // Overview = every day with a stop in New Zealand (days 3–10, 11/19–26), drawn without its Melbourne/Sydney ends or Australian stays.
  const all=mapMode==='all',nzDays=D.days.filter(d=>d.events.some(inNZ)),first=nzDays[0],last=nzDays[nzDays.length-1];
  $('#map-mode-note').textContent=!all?'虚线只表示先后顺序，不是道路导航':first?`新西兰全程画第${first.day}–${last.day}天（${shortDate(dateOf(first.day))}–${shortDate(dateOf(last.day))}），只画新西兰境内；墨尔本、悉尼和航班请切回“当天”。数字＝第几天`:'行程里没有新西兰的点。';
  if(!map)return;
  mapLayers.clearLayers();activeMarkers.clear();const bounds=[],flightBounds=[],labels=[],points=new Map(),color=routeColor();let n=0;
  const days=all?nzDays:D.days.filter(d=>d.day===selectedDay);
  // Hotels shown as H absorb their own stay events (same placeId), so no numbered marker hides under the H.
  const stays=new Map(($('#hotels-toggle').checked?D.hotels.filter(h=>geo(h)&&days.some(d=>d.hotelId===h.id)&&(!all||inNZ(h))):[]).map(h=>[h.id,{p:h,label:'H',evs:[]}]));
  days.forEach(day=>{
    // A flight splits the day into legs. The departure airport's transfer and check-in points share the flight's coordinates, so leaving
    // out the flight point alone still framed both cities; the day view frames the leg with the most stops (ties: the later leg).
    const line=[],legs=[[]];
    day.events.forEach((e,i)=>{if(!geo(e)||(all&&!inNZ(e)))return; const key=`${e.lat},${e.lon}`;line.push([e.lat,e.lon]);
      if(e.kind==='flight'){flightBounds.push([e.lat,e.lon]);legs.push([]);}else legs[legs.length-1].push([e.lat,e.lon]);
      const pt=stays.get(e.placeId)||points.get(key)||points.set(key,{p:e,label:all?day.day:++n,evs:[]}).get(key);pt.evs.push([day,i,e]);
    });
    const stay=stays.get(day.hotelId);if(stay)legs[legs.length-1].push([stay.p.lat,stay.p.lon]);
    bounds.push(...(all?legs.flat():legs.reduce((a,b)=>b.length>=a.length?b:a)));
    if(line.length>1)L.polyline(line,{color,weight:3,opacity:.75,dashArray:'5,8',interactive:false}).addTo(mapLayers);
  });
  [...points.values(),...stays.values()].forEach(pt=>{const hotel=pt.label==='H',m=marker(pt.p,pt.label,hotel,all&&hotel?[]:pt.evs,!hotel&&pt.evs.every(([, ,e])=>isOptional(e)));pt.evs.forEach(([day,i])=>{activeMarkers.set(`${day.day}-${i}`,m);if(!all)labels[i]=pt.label;});});
  $$('#day-detail .pin').forEach(s=>{const l=labels[s.dataset.index];s.hidden=l==null;s.textContent=l??'';s.classList.toggle('hotel',l==='H');});
  // A day that is only a flight still gets framed on its airport.
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
function showPhoto(id) {const p=D.photos.find(p=>p.id===id);if(!p)return;$('#dialog-content').innerHTML=`<img src="${esc(url(p.imageUrl))}" alt="${esc(p.alt)}" width="1280" height="853"><div class="dialog-copy"><p class="kicker">${esc(p.place)}</p><h3 id="dialog-title">${esc(p.title)}</h3><p>${esc(p.shootingTip)}</p><p>${esc(p.seasonNote)}</p><p class="dialog-credit">真实摄影作品${workTitle(p)?` · 原题“${esc(workTitle(p))}”`:''} · ${esc(byline(p))} · <a href="${esc(url(p.licenseUrl))}" target="_blank" rel="noopener">${esc(licenseLabel(p))}</a> · <a href="${esc(url(p.sourceUrl))}" target="_blank" rel="noopener">查看原作品与大图 ↗</a></p>${p.day?`<button class="btn small" id="dialog-day" data-day="${p.day}" type="button">在第${p.day}天行程中查看</button>`:''}</div>`;const go=$('#dialog-day');if(go)go.onclick=()=>{$('#photo-dialog').close();openDayFromElsewhere(Number(go.dataset.day));};$('#photo-dialog').showModal();}
function openDayFromElsewhere(day){chooseDay(day);$('#planner').scrollIntoView({behavior:behavior()});setTimeout(()=>$('#day-title')?.focus({preventScroll:true}),reducedMotion?0:450);}
function renderPhotos() {
  $('#photo-grid').innerHTML=D.photos.map(p=>{const set=srcset(url(p.imageUrl));return `<article class="photo-card"><button class="photo-button" data-photo="${esc(p.id)}" aria-label="放大查看${p.day?`第${p.day}天 · `:''}${esc(p.title)}：拍摄建议与出处" type="button"><img src="${esc(url(p.imageUrl))}"${set?` srcset="${set}" sizes="(max-width: 699px) calc(50vw - 22px), (max-width: 1099px) calc(33vw - 28px), 300px"`:''} alt="${esc(p.alt)}" loading="lazy" decoding="async" width="720" height="540">${p.day?`<span class="photo-day-tag" aria-hidden="true">第${p.day}天</span>`:''}</button><div class="photo-copy"><p class="place">${esc(p.place)}</p><h3>${esc(p.title)}</h3><p class="tip">${esc(p.shootingTip)}</p><p class="season">${esc(p.seasonNote)}</p><a class="credit" href="${esc(url(p.sourceUrl))}" target="_blank" rel="noopener">${esc(byline(p))}<span class="lic"> · ${esc(licenseLabel(p))}</span> ↗</a></div></article>`;}).join('');
  $$('#photo-grid [data-photo]').forEach(b=>b.onclick=()=>showPhoto(b.dataset.photo));
  $$('#photo-grid img').forEach(img=>img.onerror=()=>imageFailure(img));
  const hero=D.photos.find(p=>p.hero)||D.photos[0];if(hero){const img=$('#hero-image'),credit=$('#hero-credit');if(img.getAttribute('src')!==url(hero.imageUrl))img.src=url(hero.imageUrl);img.onerror=()=>{img.hidden=true;};credit.href=url(hero.sourceUrl);credit.innerHTML=`封面照片 ${esc(byline(hero))} · <span class="nw">${esc(licenseLabel(hero))} ↗</span>`;credit.title=`${hero.place} · ${hero.author}`;}
}
// Long card bodies show three lines; 展开全文 reveals the rest and the sources. fitClamps() hides the button when nothing is cut off.
let clampSeq=0;
// Card titles in the data keep an editorial "01 / " numbering; the page shows the titles without it.
const cardTitle = t => String(t || '').replace(/^\d{1,2}\s*\/\s*/, '');
function cards(items,className,clamp=true) {return (items||[]).map(c=>{const id=`clamp-${++clampSeq}`,body=`<p>${esc(c.body).replace(/\n/g,'<br>')}</p>${srcBlock(c.sourceIds)}`;return clamp?`<article class="note-card ${className}"><h3>${esc(cardTitle(c.title))}</h3><div class="clamp" id="${id}">${body}</div><button class="more" type="button" aria-expanded="false" aria-controls="${id}">展开全文</button></article>`:`<article class="note-card ${className}"><h3>${esc(cardTitle(c.title))}</h3><div class="clamp open">${body}</div></article>`;}).join('');}
// Reference notes (行前须知) as a list of titles; a tap opens the full text and its sources.
function accordion(items) {return `<ul class="acc">${(items||[]).map(c=>`<li><details class="acc-item"><summary>${esc(cardTitle(c.title))}</summary><div class="acc-body"><p>${esc(c.body).replace(/\n/g,'<br>')}</p>${srcBlock(c.sourceIds)}</div></details></li>`).join('')}</ul>`;}
// A clamp's 展开 button sits beside it in the same parent and shows only when text is cut off or something (sources, a photo note) is hidden.
function fitClamps(root=document){root.querySelectorAll('.clamp:not(.open)').forEach(c=>{const p=c.firstElementChild,box=c.parentElement,btn=box.querySelector(':scope>.more');if(!p||!btn||!p.clientHeight)return;const cut=p.scrollHeight>p.clientHeight+2;box.classList.toggle('has-more',cut||c.children.length>1);btn.textContent=cut?'展开全文':c.querySelector('.photo-tip')?'看拍摄笔记':'查看来源';});}
function toggleClamp(btn){const c=document.getElementById(btn.getAttribute('aria-controls'));if(!c)return;const open=!c.classList.contains('open');c.classList.toggle('open',open);btn.setAttribute('aria-expanded',open);if(open){btn.textContent='收起';return;}fitClamps(c.parentElement);const card=btn.closest('.note-card,.event,.day-sum');if(card&&card.getBoundingClientRect().top<0)card.scrollIntoView({block:'start',behavior:'auto'});}
const amount = n => n.toLocaleString('zh-CN',{maximumFractionDigits:2});
const range = r => r.min===r.max ? amount(r.min) : `${amount(r.min)}–${amount(r.max)}`;
const GROUPS=[['flight','机票'],['hotel','住宿'],['rental','租车'],['activity','峡湾游船'],['food','餐饮'],['ground','交通、油费和停车'],['other','入境、保险、通信、行李和机动金']];
const groupOf = r => GROUPS.some(([k])=>k===r.category) ? r.category : 'other';
function renderBudget(){
  const s=D.budget.summary, fx=D.budget.fx, rows=D.budget.rows, max=s.totalCNY.max, over=-s.headroomCNY;
  const pick=id=>rows.find(r=>r.id===id)?.perPersonCnyUnrounded.max||0, lean=max-pick('bag-oversize');
  const sums=GROUPS.map(([k,label])=>({k,label,min:rows.filter(r=>groupOf(r)===k).reduce((a,r)=>a+r.perPersonCnyUnrounded.min,0),max:rows.filter(r=>groupOf(r)===k).reduce((a,r)=>a+r.perPersonCnyUnrounded.max,0)}));
  // Bars are scaled to the largest category so the chart uses its width; each value also shows its share of the upper total.
  const top=Math.max(...sums.map(g=>g.max))||1;
  $('#budget-hero').innerHTML=`<div class="budget-total"><p class="kicker">你的全程预算（上海出发，含¥1,000机动金）</p><p class="big-number">${yuan(s.totalCNY.min)}<span>–</span>${yuan(max)}</p><p class="verdict ${over>0?'over':'ok'}">${over>0?`按上限超出3万约 ${yuan(over)}`:`按上限距3万还剩 ${yuan(-over)}`}</p><p class="budget-tip">换三边和≤158cm的托运箱，上限约 ${yuan(lean)}；大额外币走银联通道或用免货币兑换费的卡，还能再省约 ${yuan(pick('card-fx-fee'))}。悉尼两卧公寓和多打车是选定的舒适度取舍。</p></div><div class="budget-bars" role="list">${sums.map(g=>`<div class="bar-row" role="listitem"><span class="bar-label">${g.label}</span><span class="bar"><i style="width:${(g.max/top*100).toFixed(1)}%"></i></span><span class="bar-value">${g.min===g.max?yuan(g.max):`${yuan(g.min)}–${yuan(g.max)}`}<small>${Math.round(g.max/max*100)}%</small></span></div>`).join('')}</div>`;
  const hotelPer=h=>h.nativeTotal*fx[h.currency]/3;
  $('#stay-table').innerHTML=`<ul class="rows">${D.hotels.map(h=>`<li><details class="stay"><summary class="row"><span class="row-main"><b>${esc(h.name)}</b><small>${h.booked?'<span class="ok">已预订</span> · ':''}${shortDate(h.checkin)}–${shortDate(h.checkout)} · ${h.nights}晚</small></span><span class="num">${yuan(hotelPer(h))}<small>每人</small></span></summary><p class="row-more">${esc(h.beds)}${h.reviews?`<br>${esc(h.reviews.split('；')[0])}`:''}</p></details></li>`).join('')}</ul>`;
  // One row per flight with its date and local times; the price comes from its budget row (a two-flight ticket is priced once).
  const legs=D.days.flatMap(d=>d.events.filter(e=>e.kind==='flight').map(e=>({d,e,code:(/^[A-Z0-9]{2}\d{2,4}/.exec(e.place)||[''])[0]})));
  const rowOf=code=>code?rows.find(r=>r.category==='flight'&&r.title.includes(code)):null, priced=new Set();
  $('#flight-table').innerHTML=`<ul class="rows">${legs.map(({d,e,code})=>{const r=rowOf(code),date=dateOf(d.day),[name,route='']=e.place.split(' · '),[from='',to='']=route.split('→'),first=r&&!priced.has(r.id),pair=r&&legs.filter(x=>rowOf(x.code)===r).length>1;if(r)priced.add(r.id);
    return `<li class="row flight"><span class="row-main"><span class="when">${shortDate(date)} ${weekday(date)}</span><b>${esc(name)}</b><span class="leg"><span>${esc(e.time)} ${esc(from.trim())}</span><span>→ ${esc(e.endTime||'')} ${esc(to.trim())}</span></span>${first?`<small>${esc(r.status)}</small>`:''}</span><span class="num">${!r?'':first?`${yuan(r.perPersonCny.min)}<small>${pair?'往返联票 · 每人':'每人'}</small>`:'<small>已含在往返联票</small>'}</span></li>`;}).join('')}</ul><p class="note">起降时间都是当地时间。</p>`;
  const CUR={CNY:'人民币',AUD:'澳元',NZD:'新西兰元'};
  const groupRows=GROUPS.map(([k,label])=>{const list=rows.filter(r=>groupOf(r)===k);if(!list.length)return '';const g=sums.find(x=>x.k===k);return `<tr class="group-row"><th scope="rowgroup" colspan="2">${label}</th><td>${g.min===g.max?yuan(g.max):`${yuan(g.min)}–${yuan(g.max)}`}</td></tr>${list.map(r=>`<tr><td data-label="项目"><strong>${esc(r.title)}</strong><small>${esc(r.status)}</small><details class="row-note"><summary>说明与来源</summary><small>${esc(r.note)}</small>${sourcesOf(r.sourceIds).map(x=>`<a href="${esc(url(x.url))}" target="_blank" rel="noopener">${esc(x.shortTitle || x.title)} ↗</a>`).join('')}</details></td><td data-label="每人原币"${r.currency==='CNY'?' class="same-cny"':''}>${esc(CUR[r.currency]||r.currency)} ${range(r.perPersonNative)}</td><td data-label="约合人民币">${r.perPersonCny.min===r.perPersonCny.max?yuan(r.perPersonCny.min):`${yuan(r.perPersonCny.min)}–${yuan(r.perPersonCny.max)}`}</td></tr>`).join('')}`;}).join('');
  $('#budget-table').innerHTML=`<div class="table-scroll"><table class="budget"><caption>${shortDate(dateOf(1))}–${shortDate(dateOf(D.days.length))}主方案 · 上海出发者本人费用 · 报价快照，${D.hotels.some(h=>h.booked)?'除已订的住处外未预订':'未预订'}</caption><thead><tr><th>项目</th><th>每人原币</th><th>约合人民币</th></tr></thead><tbody>${groupRows}</tbody><tfoot><tr><th colspan="2">合计（每人）</th><td>${yuan(s.totalCNY.min)}–${yuan(s.totalCNY.max)}</td></tr></tfoot></table></div><p class="note">${esc(s.narrative)}</p><p class="note">折算：1澳元（AUD）≈¥${esc(fx.AUD)}；1新西兰元（NZD）≈¥${esc(fx.NZD)}（${esc(fx.note)}）。${esc(D.budget.summary.comparisonNote)} 现金是上述消费的支付方式，不再次加进总额。可退押金或信用卡预授权需另留额度。</p>`;
  const native=s.nativeTotals;
  $('#budget-table').insertAdjacentHTML('beforeend',`<p class="note">个人原币支出合计：人民币 ¥${range(native.CNY)} ＋ 澳元 AUD ${range(native.AUD)} ＋ 新西兰元 NZD ${range(native.NZD)}；折合人民币的总额见上。三种货币分别列示，包含预算及机动金，不是三人的总花费。</p>`);
  $('#licence-detail').innerHTML=cards(D.budget.licences.map(l=>({title:l.driver,body:l.advice,sourceIds:l.sourceIds})),'licence');
}
const WHO={user:'你',tokyo:'东京同学',melbourne:'墨尔本同学',all:'全员'};
const todoKey=id=>`trip-todo:${id}`;
// Session copy keeps ticks working when storage is blocked; storage only makes them survive a reload.
const todoMemory=new Map();let storageWarned=false;
// done:true in data.json marks a task finished for everyone (friends never tick the organiser's own tasks on their phones).
const todoDone=id=>{if((D?.todos||[]).some(t=>t.id===id&&t.done))return true;if(todoMemory.has(id))return todoMemory.get(id);try{return localStorage.getItem(todoKey(id))==='1';}catch{return false;}};
function setTodo(id,done){todoMemory.set(id,done);try{done?localStorage.setItem(todoKey(id),'1'):localStorage.removeItem(todoKey(id));}catch{if(!storageWarned){storageWarned=true;toast('这台设备不能保存勾选，刷新后会丢失。');}}}
const localToday=(plusDays=0)=>{const n=new Date();n.setDate(n.getDate()+plusDays);return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}-${String(n.getDate()).padStart(2,'0')}`;};
const overdue=t=>t.due!=='asap'&&t.due<localToday()&&!todoDone(t.id);
const dueLabel=t=>t.done?'已办完':t.due==='asap'?'尽快':`${overdue(t)?'已过期 · ':''}${shortDate(t.due)} ${weekday(t.due)}`;
const onTrip=()=>localToday()>=dateOf(1);
const byDue=(a,b)=>a.due<b.due?-1:a.due>b.due?1:0;
// Before the trip: anything that fell due yesterday or today first (older overdue items stay red in the list but no longer lead),
// then anything dated in the next 3 days (ahead of the undated "asap" items), then the rest. Follows the 按人查看 choice.
// From the first travel day on, unticked pre-trip items no longer lead: the next item dated today or later does.
function nextTodo(){const list=(D.todos||[]).filter(t=>!todoDone(t.id)&&forWho(t)),today=localToday(),soon=localToday(3);
  if(onTrip())return list.filter(t=>t.due!=='asap'&&t.due>=today).sort(byDue)[0];
  return list.find(t=>overdue(t)&&t.due>=localToday(-1))||list.find(t=>t.due!=='asap'&&t.due>=today&&t.due<=soon)||list.find(t=>t.due==='asap'||t.due>=today);}
const forWho=t=>todoWho==='all'||t.who.includes(todoWho)||t.who.includes('all');
// Groups follow the viewer's own date; "asap" counts as now. A tick only restyles its row (focus stays put); the row changes group on the next render.
// During the trip, unticked pre-trip and "asap" items fold into 出发前没勾的; items missed during the trip stay 已过期.
const TODO_LABEL={overdue:'已过期',now:'今天和接下来7天',later:'之后',pretrip:'出发前没勾的',done:'已完成'};
const todoGroup=t=>{if(todoDone(t.id))return 'done';if(onTrip()&&(t.due==='asap'||t.due<dateOf(1)))return 'pretrip';return t.due==='asap'?'now':t.due<localToday()?'overdue':t.due<=localToday(7)?'now':'later';};
function todoRow(t){
  const done=todoDone(t.id),late=overdue(t);
  return `<li class="todo${done?' done':''}${late?' overdue':''}"><label class="todo-check"><input type="checkbox" data-todo="${esc(t.id)}" aria-labelledby="todo-${esc(t.id)}-t todo-${esc(t.id)}-d" ${done?'checked':''}${t.done?' disabled':''}></label><details class="todo-item"><summary><span class="todo-tags"><span class="due${t.due==='asap'||late?' warn':''}" id="todo-${esc(t.id)}-d">${dueLabel(t)}</span><span class="who">${t.who.map(w=>WHO[w]).join('、')}</span></span><span class="todo-title" id="todo-${esc(t.id)}-t">${esc(t.title)}</span></summary><div class="todo-detail"><p>${esc(t.detail)}</p>${srcBlock(t.sourceIds)}</div></details></li>`;
}
// Open: what is due now (and what is overdue). Folded: 之后, 出发前没勾的 and 已完成, each showing its count.
function renderTodos(){
  const list=(D.todos||[]).filter(forWho), by={}, trip=onTrip();
  Object.keys(TODO_LABEL).forEach(k=>by[k]=[]); list.forEach(t=>by[todoGroup(t)].push(t));
  const count=()=>{$('#todo-count').textContent=`已完成 ${list.filter(t=>todoDone(t.id)).length} / ${list.length}`;};count();
  const group=(k,open)=>{const items=by[k];if(!items.length)return '';const rows=`<ol class="todo-rows">${items.map(todoRow).join('')}</ol>`,label=TODO_LABEL[k];
    if(open)return `<section class="todo-group ${k}" aria-labelledby="todo-group-${k}"><h3 class="todo-group-head" id="todo-group-${k}">${label}<span class="n">${items.length}</span></h3>${rows}</section>`;
    const from=k==='later'&&items.filter(t=>t.due!=='asap').sort(byDue)[0];
    return `<details class="todo-group ${k}"><summary class="todo-group-head"><h3>${label}</h3><span class="n">${items.length}</span>${from?`<span class="hint">最早 ${shortDate(from.due)}</span>`:''}</summary>${rows}</details>`;};
  const html=[...(trip?['now','overdue']:['overdue','now']).map(k=>group(k,true)),...['later','pretrip','done'].map(k=>group(k,false))].join('');
  $('#todo-list').innerHTML=list.length?html:'<p class="empty">这个人没有要办的事。</p>';
  // Update the ticked row in place so keyboard and screen-reader focus stays on the checkbox.
  $$('#todo-list input').forEach(i=>i.onchange=()=>{const t=list.find(x=>x.id===i.dataset.todo);setTodo(t.id,i.checked);const li=i.closest('li');li.classList.toggle('done',i.checked);li.classList.toggle('overdue',overdue(t));const due=li.querySelector('.due');due.textContent=dueLabel(t);due.classList.toggle('warn',t.due==='asap'||overdue(t));count();renderFacts();});
}
function renderFacts(){
  const s=D.budget.summary, over=-s.headroomCNY, t=nextTodo(), now=D.days.find(d=>dateOf(d.day)===localToday());
  // During the trip the first fact becomes "today" and opens that day; before and after it shows the dates.
  const first=now?`<div class="fact link today"><dt>今天</dt><dd><a href="#planner" data-today="${now.day}">第${now.day}天 · ${esc(now.shortTitle||now.area)}</a><small>${shortDate(dateOf(now.day))} ${weekday(dateOf(now.day))} · 看今天的时间表 →</small></dd></div>`:`<div class="fact"><dt>日期</dt><dd><span id="hero-dates">${dotDate(dateOf(1))} — ${dotDate(dateOf(D.days.length))}</span><small>11/17周二傍晚从浦东出发</small></dd></div>`;
  // Nights and stays come from the data (Melbourne is west of 150°E, Sydney east of it; every New Zealand stay is on the South Island).
  const nights=f=>D.hotels.filter(f).reduce((a,x)=>a+(Number(x.nights)||0),0);
  const stays=`墨尔本${nights(x=>geo(x)&&!inNZ(x)&&x.lon<150)}晚 · 南岛${nights(inNZ)}晚 · 悉尼${nights(x=>geo(x)&&!inNZ(x)&&x.lon>=150)}晚`;
  $('#fact-grid').innerHTML=`${first}<div class="fact"><dt>住宿</dt><dd>${stays}<small>${D.hotels.length}处；墨尔本那晚三人都住就有两人合睡</small></dd></div><div class="fact link"><dt>你的预算</dt><dd><a href="#budget">${yuan(s.totalCNY.min)}–${yuan(s.totalCNY.max)}</a><small>上海出发 · ${over>0?`按上限超3万约${yuan(over)} →`:'在3万以内 →'}</small></dd></div><div class="fact link"><dt>最近要办</dt><dd><a href="#before"><span class="clamp2">${t?esc(t.title):'行前事项都已勾完'}</span></a><small>${t?`${dueLabel(t)} · ${t.who.map(w=>WHO[w]).join('、')} →`:'看全部待办 →'}</small></dd></div>`;
  const today=$('#fact-grid [data-today]');if(today)today.onclick=e=>{e.preventDefault();openDayFromElsewhere(Number(today.dataset.today));};
}
// The overview marks the open day only once someone picked one (or arrived with ?day=), or during the trip; never by default before it.
function markCurrent(){const show=addressDirty||D.days.some(d=>dateOf(d.day)===localToday());$$('#glance-days .glance-day').forEach(b=>b.classList.toggle('current',show&&Number(b.dataset.day)===selectedDay));}
function renderRental(){
  // Line breaks in feature titles are the data's; a balanced wrap reads better in a narrow column than a forced break.
  $('#rental-highlight').innerHTML=`<h3>${esc(D.rental.title).replace(/\s*\n\s*/g,'')}</h3><div><p>${esc(D.rental.body)}</p>${srcFold(D.rental.sourceIds)}</div>`;
  $('#rental-cards').innerHTML=cards(D.rental.cards,'rental-card');
  const quote=D.rental.quote, status=quote.booked?'已预订':'未预订';
  const head=$('#rental-status');if(head)head.textContent=quote.booked?'已预订':'已核实报价，未预订';
  {const proof=$('#rental-proof');if(quote.proofImage){proof.hidden=false;proof.innerHTML=`<summary>查看${esc(quote.provider)}实际报价截图 <span>${status}</span></summary><p class="note">${esc(quote.proofCaption)}</p><img src="${esc(quote.proofImage)}" alt="${esc(quote.proofAlt || quote.proofCaption)}" loading="lazy" class="proof-image">`;}else{proof.hidden=true;proof.innerHTML='';}}
}
// Monochrome travel icons for the route ribbon (the data writes the legs with 🚗 and ✈).
const ICONS={car:'<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M5.6 16.5H3.5v-3.4l2.3-1.1 1.9-3.8h7.4l2.8 3.7 2.6.9v3.7h-2.1M9.4 16.5h5.2"/><circle cx="7.5" cy="16.5" r="1.9"/><circle cx="16.5" cy="16.5" r="1.9"/></svg>',
  plane:'<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 12H4.5M13.5 12 9.3 4.5H7.6l1.9 7.5M13.5 12l-4.2 7.5H7.6l1.9-7.5M6.4 12 4.9 8.8H3.6l.8 3.2M6.4 12l-1.5 3.2H3.6l.8-3.2"/></svg>'};
const legHtml=leg=>{const m=/^(🚗|✈️?)\s*(.*)$/u.exec(String(leg||''));if(!m)return esc(leg);const car=m[1]==='🚗';return `${car?ICONS.car:ICONS.plane}<span class="sr-only">${car?'开车':'坐飞机'}</span>${m[2]?`<span>${esc(m[2])}</span>`:''}`;};
function renderGlance(){
  const G=D.glance; if(!G)return;
  const today=localToday();
  $('#glance-route').innerHTML=G.route.map(r=>`<li><b>${esc(r.stop)}<small>${esc(r.date)}</small></b>${r.leg?`<span class="leg">${legHtml(r.leg)}</span>`:''}</li>`).join('');
  $('#glance-days').innerHTML=G.days.map(g=>`<li><button class="glance-day ${esc(g.region)}" data-day="${g.day}" type="button" aria-label="第${g.day}天，${shortDate(g.date)} ${weekday(g.date)}：${esc(g.title)}；住：${esc(g.stay)}。打开当天详细行程" aria-describedby="glance-points-${g.day}"><span class="g-badge" aria-hidden="true"><small>第</small>${g.day}<small>天</small></span><span class="g-body"><span class="g-top"><span class="gd-date">${shortDate(g.date)} ${weekday(g.date)}${g.date===today?'<span class="chip today">今天</span>':''}</span><span class="gd-stay">住：${esc(g.stay)}</span></span><span class="g-title">${esc(g.title)}</span><span class="g-points" id="glance-points-${g.day}">${g.points.map(x=>`<span>${esc(x)}</span>`).join('')}</span></span></button></li>`).join('');
  $$('#glance-days .glance-day').forEach(b=>b.onclick=()=>openDayFromElsewhere(Number(b.dataset.day)));
  // Phones get a cropped map with numbered stops and a key below it; the wide map's labels would shrink to 8px there.
  if(G.art)$('#glance-art').innerHTML=`<div class="art-wide">${glanceArt(G.art,D.photos)}</div><div class="art-compact">${glanceArt(G.art,D.photos,true)}<ol class="art-key">${G.art.stops.map(s=>`<li${s.side?' class="side"':''}><i aria-hidden="true">${s.n}</i><span><b>${esc(s.name)}</b><small>${esc(s.date)}</small></span></li>`).join('')}</ol>${G.art.flights?.length?`<p class="art-flights">${G.art.flights.map(fl=>esc(fl.label)).join('<span aria-hidden="true"> · </span>')}</p>`:''}</div>`;
  $('#glance-drives').innerHTML=G.drives.map(r=>`<li><span class="leg">${esc(r.leg)}</span><span class="dur">${esc(r.time)}</span></li>`).join('');
  $('#glance-tips').innerHTML=G.tips.map(t=>`<li>${esc(t)}</li>`).join('');
}
// Hand-drawn style South Island map for the one-page summary: tilted outline, lakes, mountain ticks, the drive (blue),
// day trips and the Milford coach (orange), flights in and out, and a photo label card beside each stop so nothing sits on the route.
// compact (phones): the same drawing cropped to the route, with a numbered badge on each stop instead of the label cards and no flight
// arcs (the page lists the stops and both flights under the map). Each variant has its own ids because both SVGs live in the page.
function glanceArt(A,photos,compact=false){
  const W=640,rot=A.rotate*Math.PI/180,xs=A.stretch||1,k=Math.cos(44*Math.PI/180),[mt,mr,mb,ml]=A.margins||[60,150,60,150];
  const pr=([lat,lon])=>{const x=(lon-170)*k,y=lat+44;return [(x*Math.cos(rot)-y*Math.sin(rot))*xs,x*Math.sin(rot)+y*Math.cos(rot)];};
  const key=[...A.routes.flatMap(r=>r.pts),...A.stops.map(s=>[s.lat,s.lon])].map(pr),kx=key.map(p=>p[0]),ky=key.map(p=>p[1]);
  const minX=Math.min(...kx),maxX=Math.max(...kx),minY=Math.min(...ky),maxY=Math.max(...ky);
  const sc=(W-ml-mr)/(maxX-minX),H=Math.round((maxY-minY)*sc+mt+mb);
  const P=ll=>{const [x,y]=pr(ll);return [ml+(x-minX)*sc,mt+(maxY-y)*sc];};
  const f=n=>n.toFixed(1);
  const smooth=(pts,closed)=>{const p=pts.map(P),n=p.length;if(n<2)return '';const at=i=>closed?p[(i+n)%n]:p[Math.max(0,Math.min(n-1,i))];let d=`M${f(p[0][0])},${f(p[0][1])}`;for(let i=0;i<(closed?n:n-1);i++){const p0=at(i-1),p1=at(i),p2=at(i+1),p3=at(i+2);d+=`C${f(p1[0]+(p2[0]-p0[0])/6)},${f(p1[1]+(p2[1]-p0[1])/6)} ${f(p2[0]-(p3[0]-p1[0])/6)},${f(p2[1]-(p3[1]-p1[1])/6)} ${f(p2[0])},${f(p2[1])}`;}return closed?d+'Z':d;};
  const tw=(s,fs)=>[...String(s)].reduce((w,c)=>w+(c.charCodeAt(0)<256?.58:1)*fs,0);
  const id=compact?'gc':'g',pad=36,[vx,vy,vw,vh]=compact?[ml-pad,mt-pad,W-ml-mr+2*pad,H-mt-mb+2*pad]:[0,0,W,H];
  let o=`<svg viewBox="${vx} ${vy} ${vw} ${vh}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="新西兰南岛手绘路线示意图：基督城、特卡波、库克山、特威泽尔、瓦纳卡、箭镇、皇后镇、米尔福德峡湾、格林诺奇"><defs><filter id="${id}-rough" x="-5%" y="-5%" width="110%" height="110%"><feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="7"/><feDisplacementMap in="SourceGraphic" scale="3.2"/></filter><clipPath id="${id}-frame"><rect x="${vx}" y="${vy}" width="${vw}" height="${vh}" rx="18"/></clipPath></defs><g clip-path="url(#${id}-frame)">`;
  o+=`<rect x="${vx}" y="${vy}" width="${vw}" height="${vh}" class="g-sea"/>`;
  for(let i=0;i<7;i++){const x=30+(i*197)%(W-90),y=30+(i*263)%(H-60);if(!compact||(x>vx&&x+48<vx+vw&&y-6>vy&&y<vy+vh))o+=`<path class="g-wave" d="M${x},${y}q8,-6 16,0t16,0t16,0"/>`;}
  o+=`<path class="g-land" filter="url(#${id}-rough)" d="${smooth(A.coast,true)}"/>`+A.islands.map(p=>`<path class="g-land" filter="url(#${id}-rough)" d="${smooth(p,true)}"/>`).join('');
  o+=A.lakes.map(p=>`<path class="g-lake" d="${smooth(p,true)}"/>`).join('');
  o+=A.alps.map(ll=>{const [x,y]=P(ll);return `<path class="g-mtn" d="M${f(x-11)},${f(y+7)}L${f(x)},${f(y-9)}L${f(x+11)},${f(y+7)}"/><path class="g-snow" d="M${f(x-4)},${f(y-3.5)}L${f(x)},${f(y-9)}L${f(x+4)},${f(y-3.5)}"/>`;}).join('');
  {const [x,y]=P([A.peak.lat,A.peak.lon]);o+=`<path class="g-mtn big" d="M${f(x-18)},${f(y+12)}L${f(x)},${f(y-15)}L${f(x+18)},${f(y+12)}"/><path class="g-snow" d="M${f(x-7)},${f(y-4.5)}L${f(x)},${f(y-15)}L${f(x+7)},${f(y-4.5)}"/>`;}
  if(!compact)o+=A.flights.map(fl=>{const x1=fl.from[0]*W,y1=fl.from[1]*H,[x2,y2]=P(fl.to),cx=(x1+x2)/2,cy=(y1+y2)/2-(y1<y2?40:-40);return `<path class="g-flight" d="M${f(x1)},${f(y1)}Q${f(cx)},${f(cy)} ${f(x2)},${f(y2)}"/><text class="g-flight-label" x="${f(x1)}" y="${f(y1<H/2?y1+20:y1-10)}" text-anchor="middle">${esc(fl.label)}</text>`;}).join('');
  o+=A.routes.map(r=>{const d=smooth(r.pts,false);return r.kind==='drive'?`<path class="g-route-case" d="${d}"/><path class="g-route" d="${d}"/>`:`<path class="g-route-side${r.kind==='coach'?' coach':''}" d="${d}"/>`;}).join('');
  if(compact){
    // Badges sit on their stops; any two closer than a badge width (Arrowtown and Queenstown) are nudged apart a few units.
    const pins=A.stops.map(s=>{const [x,y]=P([s.lat,s.lon]);return {s,x,y};});
    for(let it=0;it<24;it++){let moved=false;pins.forEach((a,i)=>pins.slice(i+1).forEach(b=>{const dx=b.x-a.x,dy=b.y-a.y,d=Math.hypot(dx,dy)||1,gap=31-d;if(gap>0){a.x-=dx/d*gap/2;a.y-=dy/d*gap/2;b.x+=dx/d*gap/2;b.y+=dy/d*gap/2;moved=true;}}));if(!moved)break;}
    o+=pins.map(({s,x,y})=>`<g class="g-pin${s.side?' side':''}"><circle cx="${f(x)}" cy="${f(y)}" r="14"/><text x="${f(x)}" y="${f(y+5.6)}" text-anchor="middle">${s.n}</text></g>`).join('');
  }else{
    const cards=A.stops.map(s=>{const [x,y]=P([s.lat,s.lon]),ph=s.photo&&photos.find(p=>p.id===s.photo),r=ph?26:0,h=64,w=Math.max(tw(s.name,24),tw(s.date,16))+(ph?r*2+26:48)+14,c=s.card;
      const bx=c.col==='left'?10:c.col==='right'?W-10-w:c.x-w/2,by=c.y-h/2,[ex,ey]=c.col==='left'?[bx+w,c.y]:c.col==='right'?[bx,c.y]:[c.x,by];return {s,x,y,ph,r,h,w,bx,by,ex,ey};});
    o+=cards.map(c=>`<path class="g-leader" d="M${f(c.x)},${f(c.y)}L${f(c.ex)},${f(c.ey)}"/>`).join('');
    o+=A.stops.map(s=>{const [x,y]=P([s.lat,s.lon]);return `<circle class="g-dot${s.side?' side':''}" cx="${f(x)}" cy="${f(y)}" r="7"/>`;}).join('');
    o+=cards.map(({s,ph,r,h,w,bx,by})=>{const nx=ph?bx+8+r*2-3:bx+24,ny=ph?by+13:by+h/2,tx=bx+(ph?r*2+20:44);
      return `<g class="g-label${s.side?' side':''}"><rect x="${f(bx)}" y="${f(by)}" width="${f(w)}" height="${h}" rx="16"/>`
        +(ph?`<clipPath id="${id}-clip-${s.n}"><circle cx="${f(bx+8+r)}" cy="${f(by+h/2)}" r="${r}"/></clipPath><image href="${esc(url(ph.imageUrl))}" x="${f(bx+8)}" y="${f(by+h/2-r)}" width="${r*2}" height="${r*2}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${id}-clip-${s.n})"/>`:'')
        +`<circle class="g-num" cx="${f(nx)}" cy="${f(ny)}" r="13"/><text class="g-num-t" x="${f(nx)}" y="${f(ny+5.3)}" text-anchor="middle">${s.n}</text>`
        +`<text class="g-name" x="${f(tx)}" y="${f(by+29)}">${esc(s.name)}</text><text class="g-date" x="${f(tx)}" y="${f(by+51)}">${esc(s.date)}</text></g>`;}).join('');
  }
  {const cx=compact?vx+vw-30:W-40,cy=compact?vy+vh-46:H-62,a=-A.rotate;o+=`<g class="g-north" transform="rotate(${a} ${cx} ${cy})"><path d="M${cx},${cy-24}L${cx+9},${cy+10}L${cx},${cy+4}L${cx-9},${cy+10}Z"/><text x="${cx}" y="${cy+30}" text-anchor="middle">N</text></g>`;}
  return o+'</g></svg>';
}
function renderStatic() {
  $('#route-review').innerHTML=cards(D.routeReview,'review',false);
  $('#gear-grid').innerHTML=cards(D.gear,'gear');
  $('#weather-highlight').innerHTML=`<h3>${esc(D.weather.highlight.title).replace(/\s*\n\s*/g,'')}</h3><div><p>${esc(D.weather.highlight.body)}</p>${srcFold(D.weather.highlight.sourceIds)}</div>`;
  $('#weather-grid').innerHTML=cards(D.weather.cards,'weather-card');$('#risk-grid').innerHTML=cards(D.weather.risks,'risk');
  $('#before-grid').innerHTML=accordion(D.before);
  renderBudget();renderRental();renderTodos();renderFacts();renderGlance();
  $('#drone-areas').innerHTML=cards(D.droneAreas.map(a=>({title:a.place,body:a.conclusion,sourceIds:a.sourceIds})),'risk',false);
  $('#sources').innerHTML=`<ul class="sources-list">${D.sources.map(s=>`<li><a href="${esc(url(s.url))}" target="_blank" rel="noopener">${esc(s.title)} ↗</a> <span class="source-date">${s.checked?`核查 ${esc(String(s.checked).replace(/-/g,'.'))}`:'未复核'}</span></li>`).join('')}</ul>`;
  $('#credits').innerHTML=`<h3>照片授权</h3><ul class="credits-list">${D.photos.map(p=>`<li>${esc(p.title)} — ${workTitle(p)?`原题“${esc(workTitle(p))}”，`:''}${esc(byline(p))}；<a href="${esc(url(p.sourceUrl))}" target="_blank" rel="noopener">原作品</a>；<a href="${esc(url(p.licenseUrl))}" target="_blank" rel="noopener">${esc(licenseLabel(p))}</a>。页面卡片按网页样式裁切显示，放大视图保留原比例；未将作品标记为本次旅行实拍。</li>`).join('')}</ul>`;
}
function buildPrint(){document.querySelector('#print-plan')?.remove();const section=document.createElement('section');section.id='print-plan';section.className='print-only wrap';section.innerHTML=`<h2>完整${D.days.length}日计划 · ${shortDate(dateOf(1))}–${shortDate(dateOf(D.days.length))}</h2><p>${start!==17?"顺延草案：仅日期顺延，全部报价、航班、库存、取消期限与日月时刻未复核。":`主方案；${D.hotels.some(h=>h.booked)?`已预订：${D.hotels.filter(h=>h.booked).map(h=>esc(h.name)).join('、')}；其余尚未预订。`:'尚未预订。'}`}</p>`+D.days.map(day=>`<article class="print-day"><p class="kicker">第${day.day}天 · ${shortDate(dateOf(day.day))} ${weekday(dateOf(day.day))} · ${esc(day.timezone)}</p><h3>${esc(day.title)}</h3><p>${esc(scheduleText(day.summary))}</p><p>交通：${esc(day.drive)}</p>${timelineHtml(day,true)}<p>风雨替代：${esc(scheduleText(day.weatherPlan))}</p>${hotelHtml(D.hotels.find(h=>h.id===day.hotelId), day, true)}</article>`).join('');$('#glance').after(section);}
// Any print path (button, Ctrl+P, browser menu, mobile "save as PDF") rebuilds the plan for the current start date and opens every <details> until printing ends.
let printState=null;
function beforePrint(){if(!D?.days||!$('.day-button'))return;buildPrint();if(!printState){printState=[...document.querySelectorAll('details:not(.row-note):not([data-print="closed"])')].map(d=>[d,d.open]);printState.forEach(([d])=>d.open=true);}}
function afterPrint(){printState?.forEach(([d,open])=>d.open=open);printState=null;$('#print-plan')?.remove();}
addEventListener('beforeprint',beforePrint);addEventListener('afterprint',afterPrint);
async function share(){
  const link=location.href, what=addressDirty?`第${selectedDay}天`:'整份手册';
  if(navigator.share&&coarsePointer){try{await navigator.share({title:document.title,url:link});return;}catch(e){if(e.name==='AbortError')return;}}
  try{await navigator.clipboard.writeText(link);toast(`已复制${what}链接，可以直接发给同行朋友。`);}catch{toast('请复制浏览器地址栏中的链接。');}
}
function initChrome(){
  // Tolerates an older cached index.html (no .hero-media, fewer sections) so a deploy-time mix of versions still renders.
  const bar=$('.topbar'),hero=$('.hero'),media=$('.hero-media')||hero;
  if(bar&&media&&'IntersectionObserver' in window){
    new IntersectionObserver(([e])=>{bar.dataset.state=e.isIntersecting?'over-media':'scrolled';document.documentElement.toggleAttribute('data-scrolled',!e.isIntersecting);},{rootMargin:'-80px 0px 0px 0px'}).observe(media);
    // One section is "current" at a time; the tab bar has no overview or rental tab, so the overview lights up 行程 and rental 预算.
    const tabFor={glance:'planner',planner:'planner',before:'before',budget:'budget',rental:'budget',weather:'weather',photography:'photography'};
    const spy=new IntersectionObserver(es=>es.forEach(e=>{if(!e.isIntersecting)return;const id=e.target.id;$$('.topnav a').forEach(a=>a.hash==='#'+id?a.setAttribute('aria-current','true'):a.removeAttribute('aria-current'));$$('.tabbar a').forEach(a=>a.hash==='#'+tabFor[id]?a.setAttribute('aria-current','true'):a.removeAttribute('aria-current'));}),{rootMargin:'-45% 0px -50% 0px'});
    Object.keys(tabFor).forEach(id=>{const el=document.getElementById(id);if(el)spy.observe(el);});
    if(hero)new IntersectionObserver(([e])=>{if(e.isIntersecting)$$('.topnav a,.tabbar a').forEach(a=>a.removeAttribute('aria-current'));},{rootMargin:'-45% 0px -50% 0px'}).observe(hero);
  } else if(bar) bar.dataset.state='scrolled';
  // The phone day strip turns into a glass bar once it sticks under the top bar (scroll+rAF: observers miss deep-link jumps). While it is
  // pinned the top bar slides away and the strip moves up into its place. Pinning is read from #strip-mark (the strip's own place in the
  // page), not from the strip, so moving the strip cannot flip the state back.
  const strip=$('#day-strip'),mark=$('#strip-mark'),root=document.documentElement;let ticking=false,resizeTimer=0;
  const cssPx=name=>parseFloat(getComputedStyle(root).getPropertyValue(name))||0;
  // It stays pinned while the map and day are on screen; past the day (the notes at the end of the planner) it unpins and the top bar returns.
  const check=()=>{ticking=false;const line=cssPx('--nav-top')+cssPx('--nav-h')+6,r=strip.getBoundingClientRect(),at=mark?mark.getBoundingClientRect().top:r.top,sec=$('#planner').getBoundingClientRect(),shell=$('#planner .planner-shell')?.getBoundingClientRect();
    const pinned=narrow()&&at<=line+1&&sec.bottom>r.bottom&&(!shell||shell.bottom>line+48);strip.classList.toggle('is-pinned',pinned);if(mark)root.classList.toggle('strip-pinned',pinned);
    // 回到第N项 belongs to the planner: it goes away once the planner is off screen, or when the visitor scrolls back to that event.
    if(returnTo){if(sec.bottom<0||sec.top>innerHeight){hideReturn();return;}const li=$(`#evt-${returnTo.index}`)?.getBoundingClientRect();const seen=li&&li.bottom>0&&li.top<innerHeight;if(!seen)returnTo.left=true;else if(returnTo.left)hideReturn();}};
  addEventListener('scroll',()=>{if(!ticking){ticking=true;requestAnimationFrame(check);}},{passive:true});
  addEventListener('resize',()=>{check();clearTimeout(resizeTimer);resizeTimer=setTimeout(fitClamps,150);});check();
}
function bindControls(){
  $('#day-view').onclick=()=>{mapMode='day';renderMap();};$('#all-view').onclick=()=>{mapMode='all';renderMap();};$('#hotels-toggle').onchange=renderMap;
  $('#share').onclick=share;$('#print').onclick=()=>window.print();
  $('#return-pill').onclick=backToEvent;
  $$('.tabbar a,.topnav a').forEach(a=>a.addEventListener('click',hideReturn));
  $('#close-photo').onclick=()=>$('#photo-dialog').close();$('#photo-dialog').onclick=e=>{if(e.target===$('#photo-dialog'))$('#photo-dialog').close();};
  // 按人查看 is remembered on this device, so each friend reopens the page on their own list.
  const pickWho=b=>{todoWho=b.dataset.who;$$('#todo-filter button').forEach(x=>{x.classList.toggle('active',x===b);x.setAttribute('aria-pressed',x===b);});};
  try{const saved=localStorage.getItem('trip-who'),b=saved&&$(`#todo-filter button[data-who="${CSS.escape(saved)}"]`);if(b)pickWho(b);}catch{}
  $$('#todo-filter button').forEach(b=>b.onclick=()=>{pickWho(b);try{localStorage.setItem('trip-who',todoWho);}catch{}renderTodos();renderFacts();});
  document.addEventListener('click',e=>{const b=e.target.closest?.('.more');if(b)toggleClamp(b);});
  // Roving tabindex: the strip is one Tab stop; arrows/Home/End move between days.
  $('#day-strip').addEventListener('keydown',e=>{const keys={ArrowRight:1,ArrowLeft:-1};if(!(e.key in keys)&&e.key!=='Home'&&e.key!=='End')return;e.preventDefault();const n=e.key==='Home'?1:e.key==='End'?D.days.length:selectedDay+keys[e.key];chooseDay(n);$(`.day-button[data-day="${selectedDay}"]`)?.focus();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&map&&!document.querySelector('dialog[open]')&&document.querySelector('.leaflet-popup')){const from=document.activeElement;map.closePopup();if(from?.closest?.('.leaflet-popup'))$('#map').focus();}});
}
async function main(){
  try{const r=await dataRequest;if(!r.ok)throw new Error('行程数据未能载入');D=await r.json();if(!Array.isArray(D.days)||D.days.length!==D.meta?.totalDays||D.days.some((day,index)=>day.day!==index+1))throw new Error('行程数据不完整');
    // During the trip, open on the viewer's own date unless the link names a day.
    if(!hadDayParam){const today=D.days.find(d=>dateOf(d.day)===localToday());if(today)selectedDay=today.day;}
    selectedDay=Math.min(D.days.length,selectedDay);
    bindControls();renderStatic();renderPhotos();renderDay(false);stripTo(false);initChrome();fitClamps();
    if(hadDayParam)$('#planner').scrollIntoView({behavior:'auto'});
    if(await leafletReady()){initMap();renderMap();}else mapUnavailable();
  }catch(e){$('#loading-note').hidden=false;$('#loading-note').className='fatal-error';$('#loading-note').textContent=`${e.message}。请刷新页面；若仍失败，可从页脚打开行程仓库。`;console.error(e);}
}
main();

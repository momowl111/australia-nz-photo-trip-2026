'use strict';
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const url = s => /^https:\/\//.test(s || '') ? s : '#';
const params = new URLSearchParams(location.search);
let selectedDay = Math.max(1, Math.floor(Number(params.get('day')) || 6));
let start = params.get('start') === '17' ? 17 : 16;
let D, map, mapLayers, activeMarkers = new Map(), mapMode = 'day', rainMode = false;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const dateOf = day => `2026-11-${String(start + day - 1).padStart(2, '0')}`;
const shortDate = date => `${Number(date.slice(5,7))}/${Number(date.slice(8))}`;
const shiftDate = date => {
  const value = new Date(`${date}T12:00:00Z`); value.setUTCDate(value.getUTCDate() + start - 16);
  return value.toISOString().slice(0,10);
};
const scheduleText = text => start===16 ? text : String(text || '').replace(/11\/(1[6-9]|2[0-7])(?!\d)/g, (_,day)=>`11/${Number(day)+1}`);
const geo = p => Number.isFinite(p.lat) && Number.isFinite(p.lon) && Math.abs(p.lat)<=90 && Math.abs(p.lon)<=180;
const nav = p => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${p.lat},${p.lon}`)}`;
const refLinks = ids => (ids || []).map(id => D.sources.find(s => s.id === id)).filter(Boolean).map(s => `<a href="${esc(url(s.url))}" target="_blank" rel="noopener">${esc(s.shortTitle || s.title)} ↗</a>`).join('');
const ho1669Note = '（HO1669仅周一、三、五、日执飞，11/17周二无此班；顺延需另选航班并重排到达与会合）';
const eventText = e => scheduleText(e.detail || '') + (start===17 && /HO1669/.test(`${e.place||''}${e.detail||''}`) ? ho1669Note : '');
const workTitle = p => String(p.sourceTitle || '').replace(/^File:\s*/i,'').replace(/\.[a-z0-9]{2,5}$/i,'').trim();
const cc0 = p => /^CC0\b/i.test(p.license || '');
const licenseLabel = p => cc0(p) ? 'CC0（公有领域贡献）' : p.license;
const byline = p => `${cc0(p)?'':'© '}${p.author}`;
function toast(text) { $('#toast').textContent=text; $('#toast').classList.add('show'); setTimeout(()=>$('#toast').classList.remove('show'),3500); }
function updateAddress() { const next=new URL(location.href); next.searchParams.set('day',selectedDay); next.searchParams.set('start',start); history.replaceState(null,'',next); }
function hotelUrl(h) {
  const raw=url(h.sourceUrl); if(start!==17) return raw;
  // Only rewrite date params that already exist (booking.com: checkin/checkout; book-directonline: checkInDate/checkOutDate); keep other params byte-for-byte.
  const dates={checkin:h.checkin,checkInDate:h.checkin,checkout:h.checkout,checkOutDate:h.checkout};
  try{const u=new URL(raw);u.search=u.search.replace(/([?&])(checkin|checkout|checkInDate|checkOutDate)=[^&#]*/g,(_,sep,k)=>`${sep}${k}=${shiftDate(dates[k])}`);return u.href;}catch{return raw;}
}
function hotelHtml(h) {
  if(!h) return '<div class="hotel-card"><span class="eyebrow">OVERNIGHT</span><p>国际飞行夜 / 当日抵达，不计酒店住宿。</p></div>';
  return `<div class="hotel-card"><span class="eyebrow">STAY / 候选住宿 · 未预订</span><h4>${esc(h.name)}</h4><p>${esc(h.beds)}<br>${esc(h.address)}</p><p>${shortDate(shiftDate(h.checkin))}–${shortDate(shiftDate(h.checkout))} · ${esc(h.nights)}晚${start===16?` · ${esc(h.price)}`:' · 库存与价格需重新核查'}</p><p>${start===16?esc(h.cancel):'顺延后取消期限需按新订单核实。'}</p><a href="${esc(hotelUrl(h))}" target="_blank" rel="noopener">查看房型与日期 ↗</a>${geo(h)?` · <a href="${esc(nav(h))}" target="_blank" rel="noopener">地图位置 ↗</a>`:''}</div>`;
}
function timelineHtml(day, print=false) {
  return `<ol class="timeline">${day.events.map((e,i)=>`<li><div class="time">${esc(e.time)}${e.endTime?`<small>— ${esc(e.endTime)}</small>`:''}</div><div class="event"><h4>${print?'':`<span class="pin" data-index="${i}" aria-hidden="true" hidden></span>`}${esc(e.place)}</h4><p>${esc(eventText(e))}</p>${e.photoTip?`<div class="photo-tip">拍摄笔记 · ${esc(e.photoTip)}</div>`:''}${!print&&geo(e)?`<div class="event-actions"><button class="text-button locate-event" data-index="${i}">在地图上看</button><a class="text-button" href="${esc(nav(e))}" target="_blank" rel="noopener">打开导航 ↗</a></div>`:''}</div></li>`).join('')}</ol>`;
}
function renderDay(announce=true) {
  const day = D.days.find(d=>d.day===selectedDay), a=document.activeElement;
  const focusKey = a?.closest?.('#day-strip,#day-detail') ? (a.matches('.day-button') ? `.day-button[data-day="${a.dataset.day}"]` : a.id ? `#${a.id}` : null) : null;
  $('#day-strip').innerHTML=D.days.map(d=>`<button class="day-button${d.day===selectedDay?' active':''}" data-day="${d.day}" aria-pressed="${d.day===selectedDay}"><small>DAY ${String(d.day).padStart(2,'0')} · ${shortDate(dateOf(d.day))}</small><b>${esc(d.shortTitle || d.area)}</b></button>`).join('');
  $('#day-detail').innerHTML=`<div class="day-head"><p class="eyebrow">DAY ${String(day.day).padStart(2,'0')} / ${shortDate(dateOf(day.day))}</p><div class="day-controls"><button id="prev-day" aria-label="前一天" ${day.day===1?'disabled':''}>←</button><button id="next-day" aria-label="后一天" ${day.day===D.days.length?'disabled':''}>→</button></div></div>${start===17?'<p class="notice">顺延草案：仅日期顺延；全部报价、航班、酒店及活动库存、取消期限、日月时刻均未按新日期查询。</p>':''}<h3 class="day-title">${esc(day.title)}</h3><p class="day-summary">${esc(scheduleText(day.summary))}</p><div class="day-meta"><span class="tag">${esc(day.timezone)}</span><span class="tag">${esc(day.drive)}</span></div><label class="weather-switch"><input type="checkbox" id="rain-mode" ${rainMode?'checked':''}> 看风雨天替代安排</label><div class="weather-plan" ${rainMode?'':'hidden'}><strong>天气不好时：</strong>${esc(scheduleText(day.weatherPlan))}</div>${timelineHtml(day)}${hotelHtml(D.hotels.find(h=>h.id===day.hotelId))}`;
  $('#day-strip').querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>chooseDay(Number(b.dataset.day))));
  $('#prev-day').onclick=()=>chooseDay(selectedDay-1); $('#next-day').onclick=()=>chooseDay(selectedDay+1);
  $('#rain-mode').onchange=e=>{rainMode=e.target.checked; $('.weather-plan').hidden=!rainMode;};
  $('#day-detail').querySelectorAll('.locate-event').forEach(b=>b.onclick=()=>focusEvent(Number(b.dataset.index)));
  const sun = D.light.find(s=>s.date===day.date && s.area===day.area);
  $('#map-story').innerHTML=`<p class="eyebrow">TODAY'S FRAME</p><h3>${esc(day.photoGoal || '让旅途有呼吸的空间')}</h3><p>${esc(day.lightNote || '相机设置是拍摄起点；云量、风和山体遮挡决定现场光线。')}</p>${sun?`<div class="light-times"><span>日出约 ${esc(sun.sunrise)}</span><span>日落约 ${esc(sun.sunset)}</span></div><p class="light-note">${start===17?'顺延日期未重算；此处仍为原计划日期参考。':esc(sun.note || '平地天文时刻；山体会改变实际见光时间。')}</p>`:''}`;
  $('#day-detail').scrollTop=0;
  $('#hero-dates').textContent=`11.${start} — 11.${start+D.days.length-1}`;
  $('#shift-notice').hidden=start!==17;
  if(focusKey){let f=$(focusKey);if(f?.disabled)f=$(focusKey==='#prev-day'?'#next-day':'#prev-day');f?.focus({preventScroll:true});}
  if(announce)$('#day-status').textContent=`第${day.day}天 · ${shortDate(dateOf(day.day))} · ${day.shortTitle || day.area}`;
  updateAddress(); renderMap();
}
// Scroll only the strip horizontally so deep links and day changes never move the whole page.
function stripTo(smooth) { const s=$('#day-strip'),b=s.querySelector('.day-button.active'); if(!b)return; const sr=s.getBoundingClientRect(),br=b.getBoundingClientRect(); s.scrollTo({left:s.scrollLeft+br.left-sr.left-(sr.width-br.width)/2,behavior:smooth&&!reducedMotion?'smooth':'auto'}); }
function chooseDay(n) { selectedDay=Math.min(D.days.length,Math.max(1,n)); mapMode='day'; renderDay(); stripTo(true); }
function initMap() {
  if(!window.L) { $('#map-fallback').hidden=false; $('#map').textContent='地图组件无法载入，请使用每条行程下的导航链接。'; return; }
  map=L.map('map',{scrollWheelZoom:false,keyboard:true,zoomControl:true,dragging:!L.Browser.mobile}).setView([-43.9,170.1],7);
  if(L.Browser.mobile)$('#map-hint').hidden=false;
  let errors=0;
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:18,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',crossOrigin:true}).on('tileerror',()=>{if(++errors>3)$('#map-fallback').hidden=false;}).addTo(map);
  mapLayers=L.layerGroup().addTo(map);
}
// evs: [day,index,event] triples drawn at this point; several events (or a hotel's own stay events) are listed in one popup.
function marker(p,label,hotel=false,evs=[]) {
  const icon=L.divIcon({className:'',html:`<div class="map-marker${hotel?' hotel':''}">${esc(label)}</div>`,iconSize:[30,30],iconAnchor:[15,15]});
  const m=L.marker([p.lat,p.lon],{icon,title:p.place||p.name,alt:p.place||p.name,keyboard:true}).addTo(mapLayers);
  const list=evs.length>1||(hotel&&evs.length)?`<ul>${evs.map(([day,,e])=>`<li><b>${mapMode==='all'?`第${day.day}天 `:''}${esc(e.time)}</b> ${!hotel&&e.place!==p.place?`${esc(e.place)}：`:''}${esc(eventText(e))}${e.photoTip?`<br><small>${esc(e.photoTip)}</small>`:''}</li>`).join('')}</ul>`:'';
  m.bindPopup(`<h4>${esc(p.place||p.name)}</h4>${hotel?`<p>${esc(p.beds||'')}</p>${list}`:list||`<p>${esc(eventText(p))}</p>${p.photoTip?`<p>${esc(p.photoTip)}</p>`:''}`}<p style="font-size:11px">规划定位；以现场入口、标识为准。</p><a href="${esc(nav(p))}" target="_blank" rel="noopener">打开地图导航 ↗</a>`,{maxHeight:280});
  return m;
}
function renderMap() {
  $('#day-view').classList.toggle('active',mapMode==='day'); $('#day-view').setAttribute('aria-pressed',mapMode==='day');
  $('#all-view').classList.toggle('active',mapMode==='all'); $('#all-view').setAttribute('aria-pressed',mapMode==='all');
  if(!map)return;
  mapLayers.clearLayers();activeMarkers.clear();const bounds=[],all=mapMode==='all',labels=[],points=new Map();let n=0;
  const days=all?D.days.filter(d=>d.day>=2&&d.day<=D.days.length-2):D.days.filter(d=>d.day===selectedDay);
  // Hotels shown as H absorb their own stay events (same placeId), so no numbered marker hides under the H.
  const stays=new Map(($('#hotels-toggle').checked?D.hotels.filter(h=>geo(h)&&(all||days.some(d=>d.hotelId===h.id))):[]).map(h=>[h.id,{p:h,label:'H',evs:[]}]));
  days.forEach(day=>{
    const line=[];
    day.events.forEach((e,i)=>{if(!geo(e))return; const key=`${e.lat},${e.lon}`;line.push([e.lat,e.lon]);bounds.push([e.lat,e.lon]);
      const pt=stays.get(e.placeId)||points.get(key)||points.set(key,{p:e,label:all?day.day:++n,evs:[]}).get(key);pt.evs.push([day,i,e]);
    });
    if(line.length>1)L.polyline(line,{color:day.day<=3?'#9b4b20':'#1c6c63',weight:2.5,opacity:.65,dashArray:'5,8',interactive:false}).addTo(mapLayers);
  });
  [...points.values(),...stays.values()].forEach(pt=>{const hotel=pt.label==='H',m=marker(pt.p,pt.label,hotel,all&&hotel?[]:pt.evs);if(hotel)bounds.push([pt.p.lat,pt.p.lon]);pt.evs.forEach(([day,i])=>{activeMarkers.set(`${day.day}-${i}`,m);if(!all)labels[i]=pt.label;});});
  document.querySelectorAll('#day-detail .pin').forEach(s=>{const l=labels[s.dataset.index];s.hidden=l==null;s.textContent=l??'';s.classList.toggle('hotel',l==='H');});
  if(bounds.length)map.fitBounds(bounds,{padding:[28,28],maxZoom:13,animate:!reducedMotion});
}
function focusEvent(index) {if(!map){toast('地图未载入，请使用每条行程下的导航链接。');return;}let m=activeMarkers.get(`${selectedDay}-${index}`);if(!m&&mapMode!=='day'){mapMode='day';renderMap();m=activeMarkers.get(`${selectedDay}-${index}`);}if(!m){toast('此地点暂未标注精确坐标，请使用导航链接。');return;}map.setView(m.getLatLng(),14,{animate:!reducedMotion});m.openPopup();if(innerWidth<800)$('#map').scrollIntoView({behavior:reducedMotion?'auto':'smooth',block:'center'});}
function imageFailure(img){const parent=img.parentElement;img.hidden=true;parent.classList.add('image-error');const note=document.createElement('p');note.textContent='照片暂时无法加载 · 可查看原出处';parent.append(note);}
function showPhoto(id) {const p=D.photos.find(p=>p.id===id);if(!p)return;$('#dialog-content').innerHTML=`<img src="${esc(url(p.imageUrl))}" alt="${esc(p.alt)}"><div class="dialog-copy"><h3>${esc(p.title)}</h3><p>${esc(p.shootingTip)}</p><p>${esc(p.seasonNote)}</p><p>真实摄影作品${workTitle(p)?` · 原题“${esc(workTitle(p))}”`:''} · ${esc(byline(p))} · <a href="${esc(url(p.licenseUrl))}" target="_blank" rel="noopener">${esc(licenseLabel(p))}</a> ·<a href="${esc(url(p.sourceUrl))}" target="_blank" rel="noopener">查看原作品与大图 ↗</a></p></div>`;$('#photo-dialog').showModal();}
function renderPhotos() {
  $('#photo-grid').innerHTML=D.photos.map(p=>`<article class="photo-card"><button class="photo-button" data-photo="${esc(p.id)}" aria-label="放大查看${esc(p.title)}"><img src="${esc(url(p.imageUrl))}" alt="${esc(p.alt)}" loading="lazy" decoding="async" width="720" height="500"><span>真实摄影 ↗</span></button><div class="photo-copy"><p class="eyebrow">${esc(p.place)}</p><h3>${esc(p.title)}</h3><p>${esc(p.shootingTip)}</p><p class="season-note">${esc(p.seasonNote)}</p><a class="credit" href="${esc(url(p.sourceUrl))}" target="_blank" rel="noopener">${esc(byline(p))} · ${esc(licenseLabel(p))} · 原作品 ↗</a>${p.day?`<button class="text-button photo-day" data-day="${p.day}">在第${p.day}天行程中查看 ↗</button>`:''}</div></article>`).join('');
  $('#photo-grid').querySelectorAll('[data-photo]').forEach(b=>b.onclick=()=>showPhoto(b.dataset.photo));
  $('#photo-grid').querySelectorAll('.photo-day').forEach(b=>b.onclick=()=>{chooseDay(Number(b.dataset.day));$('#planner').scrollIntoView({behavior:reducedMotion?'auto':'smooth'});});
  document.querySelectorAll('#photo-grid img').forEach(img=>img.onerror=()=>imageFailure(img));
  const hero=D.photos.find(p=>p.hero)||D.photos[0];if(hero){$('#hero-image').style.backgroundImage=`url("${url(hero.imageUrl)}")`;$('#hero-credit').href=url(hero.sourceUrl);$('#hero-credit').textContent=`${hero.place} · ${hero.author} · ${licenseLabel(hero)} ↗`;}
}
function cards(items,className) {return (items||[]).map(c=>`<article class="${className}"><h3>${esc(c.title)}</h3><p>${esc(c.body).replace(/\n/g,'<br>')}</p><div class="source-links">${refLinks(c.sourceIds)}</div></article>`).join('');}
const amount = n => n.toLocaleString('zh-CN',{maximumFractionDigits:2});
const range = r => r.min===r.max ? amount(r.min) : `${amount(r.min)}–${amount(r.max)}`;
function renderBudget(){
  const fx=D.budget.fx;
  $('#budget-table').innerHTML=`<div class="table-scroll"><table><caption>11月16日主方案 · 上海出发者本人费用 · 10月21日报价快照</caption><thead><tr><th>项目</th><th>每人原币</th><th>约合人民币</th></tr></thead><tbody>${D.budget.rows.map(r=>`<tr><td><strong>${esc(r.title)}</strong><small>${esc(r.status)}</small><small>${esc(r.note)}</small>${refLinks(r.sourceIds)}</td><td>${esc(r.currency)} ${range(r.perPersonNative)}</td><td>¥${range(r.perPersonCny)}</td></tr>`).join('')}</tbody></table></div><p class="planner-note">${esc(D.budget.summary.narrative)}</p><p class="planner-note">折算：AUD1≈¥${esc(fx.AUD)}；NZD1≈¥${esc(fx.NZD)}（${esc(fx.note)}）。${esc(D.budget.summary.comparisonNote)} 现金是上述消费的支付方式，不再次加进总额。可退押金或信用卡预授权需另留额度。</p>`;
  const native=D.budget.summary.nativeTotals;
  $('#budget-table').insertAdjacentHTML('beforeend',`<p class="planner-note">个人原币支出合计：人民币 ¥${range(native.CNY)} ＋ 澳元 AUD ${range(native.AUD)} ＋ 新西兰元 NZD ${range(native.NZD)}；折合人民币的总额见上。三种货币分别列示，包含预算及机动金，不是三人的总花费。</p>`);
  $('#licence-detail').innerHTML=cards(D.budget.licences.map(l=>({title:l.driver,body:l.advice,sourceIds:l.sourceIds})),'risk-card');
}
function renderRental(){
  $('#rental-highlight').innerHTML=`<h3>${esc(D.rental.title).replace(/\n/g,'<br>')}</h3><div><p>${esc(D.rental.body)}</p><div class="source-links">${refLinks(D.rental.sourceIds)}</div></div>`;
  $('#rental-cards').innerHTML=cards(D.rental.cards,'before-card');
  const quote=D.rental.quote;
  $('#rental-proof').innerHTML=`<summary>查看APEX实际报价截图 · 未预订</summary><p class="planner-note">${esc(quote.proofCaption)}</p><img src="${esc(quote.proofImage)}" alt="${esc(quote.proofAlt || quote.proofCaption)}" loading="lazy" style="width:100%;max-width:400px;height:auto">`;
}
function renderStatic() {
  $('#route-review').innerHTML=cards(D.routeReview,'before-card');
  $('#gear-grid').innerHTML=cards(D.gear,'gear-card');
  $('#weather-highlight').innerHTML=`<h3>${esc(D.weather.highlight.title)}</h3><div><p>${esc(D.weather.highlight.body)}</p><div class="source-links">${refLinks(D.weather.highlight.sourceIds)}</div></div>`;
  $('#weather-grid').innerHTML=cards(D.weather.cards,'weather-card');$('#risk-grid').innerHTML=cards(D.weather.risks,'risk-card');
  $('#before-grid').innerHTML=cards(D.before,'before-card');
  renderBudget();renderRental();
  $('#drone-areas').innerHTML=cards(D.droneAreas.map(a=>({title:a.place,body:a.conclusion,sourceIds:a.sourceIds})),'risk-card');
  $('#sources').innerHTML=`<ul class="sources-list">${D.sources.map(s=>`<li><a href="${esc(url(s.url))}" target="_blank" rel="noopener">${esc(s.title)} ↗</a> <span class="source-date">${s.checked?`核查 ${esc(String(s.checked).replace(/-/g,'.'))}`:'未复核'}</span></li>`).join('')}</ul>`;
  $('#credits').innerHTML=`<h3>照片授权</h3><ul class="credits-list">${D.photos.map(p=>`<li>${esc(p.title)} — ${workTitle(p)?`原题“${esc(workTitle(p))}”，`:''}${esc(byline(p))}；<a href="${esc(url(p.sourceUrl))}" target="_blank" rel="noopener">原作品</a>；<a href="${esc(url(p.licenseUrl))}" target="_blank" rel="noopener">${esc(licenseLabel(p))}</a>。页面卡片以CSS裁切显示，放大视图保留原比例；未将作品标记为本次旅行实拍。</li>`).join('')}</ul>`;
}
function buildPrint(){document.querySelector('#print-plan')?.remove();const section=document.createElement('section');section.id='print-plan';section.className='print-only wrap';section.innerHTML=`<h2>完整${D.days.length}日计划 · ${shortDate(dateOf(1))}–${shortDate(dateOf(D.days.length))}</h2><p>${start===17?"17日顺延草案：仅日期顺延，全部报价、航班、库存、取消期限与日月时刻未复核。":"主方案；全部尚未预订。"}</p>`+D.days.map(day=>`<article class="print-day"><p>DAY ${day.day} · ${shortDate(dateOf(day.day))} · ${esc(day.timezone)}</p><h2>${esc(day.title)}</h2><p>${esc(scheduleText(day.summary))}</p>${timelineHtml(day,true)}<p>风雨替代：${esc(scheduleText(day.weatherPlan))}</p>${hotelHtml(D.hotels.find(h=>h.id===day.hotelId))}</article>`).join('');document.querySelector('main').append(section);}
// Any print path (button, Ctrl+P, browser menu, mobile "save as PDF") rebuilds the plan for the current start date and opens every <details> until printing ends.
let printState=null;
function beforePrint(){if(!D?.days||!$('.day-button'))return;buildPrint();if(!printState){printState=[...document.querySelectorAll('details')].map(d=>[d,d.open]);printState.forEach(([d])=>d.open=true);}}
function afterPrint(){printState?.forEach(([d,open])=>d.open=open);printState=null;}
addEventListener('beforeprint',beforePrint);addEventListener('afterprint',afterPrint);
async function main(){
  try{const r=await fetch('data.json',{cache:'no-cache'});if(!r.ok)throw new Error('行程数据未能载入');D=await r.json();if(!Array.isArray(D.days)||D.days.length!==12||D.days.some((day,index)=>day.day!==index+1))throw new Error('行程数据不完整');selectedDay=Math.min(D.days.length,selectedDay);
    $('#start-date').value=String(start);$('#start-date').onchange=e=>{start=Number(e.target.value);renderDay();};
    $('#day-view').onclick=()=>{mapMode='day';renderMap();};$('#all-view').onclick=()=>{mapMode='all';renderMap();};$('#hotels-toggle').onchange=renderMap;
    $('#share').onclick=async()=>{try{await navigator.clipboard.writeText(location.href);toast('链接已复制，可直接分享给同行朋友。');}catch{toast('请复制浏览器地址栏中的链接。');}};
    $('#print').onclick=()=>window.print();$('#close-photo').onclick=()=>$('#photo-dialog').close();$('#photo-dialog').onclick=e=>{if(e.target===$('#photo-dialog'))$('#photo-dialog').close();};
    initMap();renderDay(false);stripTo(false);renderPhotos();renderStatic();
  }catch(e){$('#day-strip').innerHTML=`<p class="fatal-error">${esc(e.message)}。请刷新页面；若仍失败，可从页脚打开行程仓库。</p>`;console.error(e);}
}
main();

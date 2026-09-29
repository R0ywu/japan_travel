/* 花卷東北賞楓五日 — 互動行程地圖
 * 純前端：Leaflet + OpenStreetMap、OSRM（路線）、Open-Meteo（天氣）。無需 API key。
 */
(function () {
  'use strict';

  const DAY_COLORS = ['#b23a2b', '#d9742b', '#c98a2b', '#4f7d5a', '#3e6a8a'];
  const TYPE_ICON = { '餐廳': '🍴', '咖啡': '☕', '伴手禮': '🎁', '溫泉': '♨', '其他': '📍' };
  const OSRM = 'https://router.project-osrm.org/route/v1/driving/';
  const METEO = 'https://api.open-meteo.com/v1/forecast';
  const WMO = {
    0: ['☀️', '晴'], 1: ['🌤️', '大致晴朗'], 2: ['⛅', '多雲時晴'], 3: ['☁️', '陰'],
    45: ['🌫️', '霧'], 48: ['🌫️', '霧凇'], 51: ['🌦️', '毛毛雨'], 53: ['🌦️', '毛毛雨'], 55: ['🌧️', '毛毛雨'],
    61: ['🌧️', '小雨'], 63: ['🌧️', '雨'], 65: ['🌧️', '大雨'], 66: ['🌧️', '凍雨'], 67: ['🌧️', '凍雨'],
    71: ['🌨️', '小雪'], 73: ['🌨️', '雪'], 75: ['❄️', '大雪'], 77: ['🌨️', '雪粒'],
    80: ['🌦️', '陣雨'], 81: ['🌧️', '陣雨'], 82: ['⛈️', '強陣雨'], 85: ['🌨️', '陣雪'], 86: ['🌨️', '陣雪'],
    95: ['⛈️', '雷雨'], 96: ['⛈️', '雷雨冰雹'], 99: ['⛈️', '雷雨冰雹']
  };

  const state = {
    data: null,
    mode: 'all',      // 'all' | 'day'
    day: 1,
    showNearby: true,
    layers: {},       // day -> { spots, route, nearby, bounds }
    markers: {},      // `${day}:${idx}` -> marker
    shopMarkers: {},  // shopKey -> marker
    activeStop: null,
    weatherCache: {}
  };
  let map;

  /* ---------- helpers ---------- */
  const $ = (s, el = document) => el.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const color = d => DAY_COLORS[(d - 1) % DAY_COLORS.length];
  const fmtKm = m => m >= 1000 ? (m / 1000).toFixed(m >= 10000 ? 0 : 1) + ' km' : Math.round(m) + ' m';
  const fmtMin = s => { const m = Math.round(s / 60); return m >= 60 ? `${Math.floor(m / 60)} 小時 ${m % 60 ? m % 60 + ' 分' : ''}`.trim() : `${m} 分`; };
  function haversine(a, b) {
    const R = 6371000, toR = x => x * Math.PI / 180;
    const dLat = toR(b.lat - a.lat), dLng = toR(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  function storage(get, key, val) {
    try { return get ? JSON.parse(localStorage.getItem(key)) : localStorage.setItem(key, JSON.stringify(val)); } catch { return null; }
  }
  const shopKey = s => `${s.name_ja}|${s.lat}|${s.lng}`;

  /* ---------- icons ---------- */
  function pinIcon(place, n, day) {
    let cls = 'pin', inner = n;
    if (place.kind === 'hotel') { cls += ' pin-hotel'; inner = '🛏'; }
    else if (place.kind === 'airport') { cls += ' pin-airport'; inner = '✈'; }
    return L.divIcon({
      className: 'marker-pin',
      html: `<div class="${cls}" style="--c:${color(day)}"><span>${inner}</span></div>`,
      iconSize: [0, 0], iconAnchor: [0, 0], popupAnchor: [0, -28]
    });
  }
  function dotIcon(type) {
    return L.divIcon({
      className: 'marker-dot',
      html: `<div class="dot dot-${esc(type)}">${TYPE_ICON[type] || '📍'}</div>`,
      iconSize: [0, 0], iconAnchor: [0, 0], popupAnchor: [0, -14]
    });
  }

  /* ---------- init ---------- */
  async function init() {
    const res = await fetch('data/itinerary.json', { cache: 'no-cache' }); // 每次重新驗證，部署後不必等 CDN 快取過期
    state.data = await res.json();
    const { meta } = state.data;
    $('#trip-title').textContent = meta.title;
    $('#source-link').href = meta.source_url;
    document.title = `${meta.title}｜互動行程地圖`;

    initMap();
    buildDayTabs();
    buildInfoDrawer();
    buildLayers();
    renderItinerary();
    applyView(true);
    bindUI();
    registerSW();
    fetchRoutes(); // async；完成後更新路程文字與路線
  }

  function initMap() {
    map = L.map('map', { zoomControl: true, scrollWheelZoom: true }).setView([38.2, 140.6], 8);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);
    map.zoomControl.setPosition('topright');
  }

  /* ---------- layers ---------- */
  function buildLayers() {
    const { days, places } = state.data;
    days.forEach(d => {
      const spots = L.layerGroup(), route = L.layerGroup(), nearby = L.layerGroup();
      const pts = [];
      let n = 0;
      d.stops.forEach((s, i) => {
        const p = places[s.place];
        if (p.kind === 'spot') n++;
        const m = L.marker([p.lat, p.lng], { icon: pinIcon(p, n, d.day), zIndexOffset: 500, title: p.name_zh });
        m.bindPopup(popupPlace(p, d.day, i));
        m.on('click', () => selectStop(d.day, i, false));
        m.addTo(spots);
        state.markers[`${d.day}:${i}`] = m;
        if (p.id !== 'taoyuan-t1') pts.push([p.lat, p.lng]);

        // 推薦店家（同一家店在多個景點出現時只放一次）
        p.nearby.forEach(sh => {
          if (sh.lat == null || sh.lng == null) return;
          const key = shopKey(sh);
          if (state.shopMarkers[key] && state.shopMarkers[key].day === d.day) return;
          const sm = L.marker([sh.lat, sh.lng], { icon: dotIcon(sh.type), title: sh.name_zh });
          sm.bindPopup(popupShop(sh, p));
          sm.addTo(nearby);
          if (!state.shopMarkers[key]) state.shopMarkers[key] = { marker: sm, day: d.day };
        });
      });
      // 先畫直線（OSRM 回來後替換成真實路線）
      const straight = busSegments(d).map(seg => L.polyline(seg.latlngs, { color: color(d.day), weight: 4, opacity: .55, dashArray: '6 8' }));
      straight.forEach(l => l.addTo(route));
      state.layers[d.day] = { spots, route, nearby, bounds: pts.length ? L.latLngBounds(pts) : null, straight };
    });
  }

  // 只回傳遊覽車段（排除飛機段）
  function busSegments(d) {
    const { places } = state.data;
    const out = [];
    for (let i = 0; i < d.stops.length - 1; i++) {
      const s = d.stops[i];
      if (s.travel !== 'bus') continue;
      const a = places[s.place], b = places[d.stops[i + 1].place];
      out.push({ i, a, b, latlngs: [[a.lat, a.lng], [b.lat, b.lng]] });
    }
    return out;
  }

  function popupPlace(p, day, idx) {
    return `<b>${esc(p.name_zh)}</b><span class="muted">${esc(p.name_ja)}</span>
      <div class="pop-actions">
        <button type="button" onclick="TripApp.openDetail(${day},${idx})">看介紹・周邊店家</button>
        <a href="${esc(p.google_maps_url)}" target="_blank" rel="noopener">Google Maps</a>
        ${p.nav_url ? `<a href="${esc(p.nav_url)}" target="_blank" rel="noopener">導航</a>` : ''}
      </div>`;
  }
  function popupShop(sh, near) {
    const rate = sh.rating ? `<span class="rate">★ ${sh.rating}</span> <small class="muted">${esc(sh.rating_source || '')}</small>` : '<small class="muted">未查到評分</small>';
    return `<b>${TYPE_ICON[sh.type] || ''} ${esc(sh.name_zh)}</b><span class="muted">${esc(sh.name_ja)}</span>
      <div>${rate}</div>
      <div style="margin-top:4px">${esc(sh.note)}</div>
      <div class="muted" style="margin-top:4px;font-size:11px">鄰近：${esc(near.name_zh)}</div>
      <div class="pop-actions"><a href="${esc(sh.google_maps_url)}" target="_blank" rel="noopener">Google Maps</a>${sh.nav_url ? `<a href="${esc(sh.nav_url)}" target="_blank" rel="noopener">導航</a>` : ''}</div>`;
  }

  /* ---------- view switching ---------- */
  function applyView(fit) {
    const { days } = state.data;
    days.forEach(d => {
      const L_ = state.layers[d.day];
      const on = state.mode === 'all' || state.day === d.day;
      toggle(L_.spots, on); toggle(L_.route, on); toggle(L_.nearby, on && state.showNearby);
    });
    // UI
    $('#mode-all').classList.toggle('active', state.mode === 'all');
    $('#mode-day').classList.toggle('active', state.mode === 'day');
    $('#mode-all').setAttribute('aria-pressed', state.mode === 'all');
    $('#mode-day').setAttribute('aria-pressed', state.mode === 'day');
    document.querySelectorAll('.day-tab').forEach(t => {
      const d = +t.dataset.day;
      t.classList.toggle('active', state.mode === 'day' && d === state.day);
      t.classList.toggle('dimmed', state.mode === 'day' && d !== state.day);
    });
    document.querySelectorAll('.day-card').forEach(c => {
      const d = +c.dataset.day;
      c.hidden = state.mode === 'day' && d !== state.day;
      if (state.mode === 'day') c.classList.remove('collapsed');
    });
    if (fit) fitView();
  }
  function toggle(layer, on) { if (on) { if (!map.hasLayer(layer)) layer.addTo(map); } else if (map.hasLayer(layer)) map.removeLayer(layer); }
  function fitView() {
    let b = null;
    state.data.days.forEach(d => {
      if (state.mode === 'day' && d.day !== state.day) return;
      const lb = state.layers[d.day].bounds;
      if (lb) b = b ? b.extend(lb) : L.latLngBounds(lb.getSouthWest(), lb.getNorthEast());
    });
    if (b) map.fitBounds(b, { padding: [40, 40], maxZoom: 12 });
  }

  /* ---------- day tabs / itinerary ---------- */
  function buildDayTabs() {
    const el = $('#day-tabs');
    el.innerHTML = state.data.days.map(d => {
      const md = d.date.slice(5).replace('-', '/');
      return `<button class="day-tab" type="button" role="tab" data-day="${d.day}" style="--c:${color(d.day)}">Day ${d.day}<small>${md}（${d.weekday}）</small></button>`;
    }).join('');
    el.addEventListener('click', e => {
      const t = e.target.closest('.day-tab'); if (!t) return;
      state.day = +t.dataset.day; state.mode = 'day';
      closeDetail();
      applyView(true);
      $('#panel').scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  function renderItinerary() {
    const { days, places } = state.data;
    const el = $('#itinerary');
    el.innerHTML = days.map(d => {
      let n = 0;
      const rows = d.stops.map((s, i) => {
        const p = places[s.place];
        if (p.kind === 'spot') n++;
        const pin = p.kind === 'hotel' ? '<span class="pin pin-hotel"><span>🛏</span></span>'
          : p.kind === 'airport' ? '<span class="pin pin-airport"><span>✈</span></span>'
            : `<span class="pin" style="--c:${color(d.day)}"><span>${n}</span></span>`;
        let seg = '';
        if (i < d.stops.length - 1) {
          const cls = s.travel === 'flight' ? 'flight' : '';
          const txt = s.travel === 'flight' ? `✈ ${esc(s.travel_note || '飛行')}` : `🚌 <span id="seg-${d.day}-${i}">路程計算中…</span>`;
          seg = `<div class="seg"><div class="ln ${cls}"></div><div class="txt">${txt}</div></div>`;
        }
        return `<div class="stop" data-day="${d.day}" data-idx="${i}" style="--c:${color(d.day)}">
            <div class="pin-col">${pin}</div>
            <div>
              <div class="name">${esc(p.name_zh)}${p.inferred ? ' <span class="muted" style="font-weight:400;font-size:11px">（推測）</span>' : ''}</div>
              ${s.time ? `<div class="time">${esc(s.time)}</div>` : ''}
              ${s.note ? `<div class="sub">${esc(s.note)}</div>` : ''}
            </div>
          </div>${seg}`;
      }).join('');
      const hotel = d.hotel ? places[d.hotel] : null;
      const meals = d.meals;
      const md = d.date.slice(5).replace('-', '/');
      return `<article class="day-card" data-day="${d.day}" style="--c:${color(d.day)}">
        <div class="day-head" data-day="${d.day}">
          <span class="n">Day ${d.day}</span>
          <div class="t"><b>${esc(d.title)}</b><span>${md}（${d.weekday}）${hotel ? '・宿 ' + esc(hotel.name_zh) : '・返台'}</span></div>
          <span class="chev">▾</span>
        </div>
        <div class="day-body">
          <div class="meals"><span>早：${esc(meals.breakfast)}</span><span>午：${esc(meals.lunch)}</span><span>晚：${esc(meals.dinner)}</span></div>
          ${rows}
        </div>
      </article>`;
    }).join('');

    el.addEventListener('click', e => {
      const head = e.target.closest('.day-head');
      if (head) { head.closest('.day-card').classList.toggle('collapsed'); return; }
      const st = e.target.closest('.stop');
      if (st) selectStop(+st.dataset.day, +st.dataset.idx, true);
    });
  }

  function selectStop(day, idx, fly) {
    if (state.mode === 'day' && state.day !== day) { state.day = day; applyView(false); }
    document.querySelectorAll('.stop.active').forEach(x => x.classList.remove('active'));
    const row = document.querySelector(`.stop[data-day="${day}"][data-idx="${idx}"]`);
    if (row) { row.classList.add('active'); if (!fly) row.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
    const m = state.markers[`${day}:${idx}`];
    const p = state.data.places[state.data.days[day - 1].stops[idx].place];
    focusMarker(m);
    if (fly && m) {
      map.flyTo(m.getLatLng(), Math.max(map.getZoom(), p.kind === 'airport' ? 11 : 14), { duration: .8 });
      setTimeout(() => m.openPopup(), 850);
    } else if (m) {
      map.panTo(m.getLatLng(), { animate: true, duration: .5 });
    }
    openDetail(day, idx);
  }

  // 讓被選中的標記明顯：放大 + 跳動一次；其餘恢復
  function focusMarker(m) {
    document.querySelectorAll('.marker-pin.focus, .marker-dot.focus').forEach(el => el.classList.remove('focus'));
    if (!m) return;
    const el = m.getElement();
    if (el) { el.classList.add('focus'); m.setZIndexOffset(1000); }
  }

  /* ---------- detail panel ---------- */
  function openDetail(day, idx) {
    const d = state.data.days[day - 1];
    const s = d.stops[idx];
    const p = state.data.places[s.place];
    const body = $('#detail-body');
    const kindLabel = { spot: '景點', hotel: '住宿', airport: '機場' }[p.kind];
    const shops = p.nearby.map((sh, i) => {
      const rate = sh.rating ? `<span class="rate">★ ${sh.rating}<small class="muted"> ${esc(sh.rating_source || '')}</small></span>` : '';
      const hasPos = sh.lat != null && sh.lng != null;
      return `<div class="shop" data-shop="${i}" title="${hasPos ? '在地圖上顯示' : '未查到座標'}">
        <span class="dot dot-${esc(sh.type)}">${TYPE_ICON[sh.type] || '📍'}</span>
        <div>
          <div class="nm">${esc(sh.name_zh)} ${rate}</div>
          <div class="nt">${esc(sh.note)}</div>
          <div class="lk"><a href="${esc(sh.google_maps_url)}" target="_blank" rel="noopener">Google Maps ↗</a>${sh.nav_url ? ` <a href="${esc(sh.nav_url)}" target="_blank" rel="noopener">導航 ↗</a>` : ''}${hasPos ? ' <span class="muted">・點此列在地圖定位</span>' : ' <span class="muted">（座標未查到，請用連結搜尋）</span>'}</div>
        </div>
      </div>`;
    }).join('');

    const photo = p.image ? `<figure class="photo"><img src="${esc(p.image.url)}" alt="${esc(p.name_zh)}" loading="lazy"
        onerror="this.closest('figure').style.display='none'">
        <figcaption>照片：<a href="${esc(p.image.page)}" target="_blank" rel="noopener">${esc(p.image.credit)}</a></figcaption></figure>` : '';
    body.innerHTML = `
      ${photo}
      <span class="badge">Day ${day}・${kindLabel}</span>${p.inferred ? '<span class="badge warn">推測地點，以旅行社為準</span>' : ''}
      <h2>${esc(p.name_zh)}</h2>
      <p class="ja">${esc(p.name_ja)}${p.name_en ? ' / ' + esc(p.name_en) : ''}</p>
      ${s.time ? `<p><b>${esc(s.time)}</b></p>` : ''}
      ${s.note ? `<p class="muted">${esc(s.note)}</p>` : ''}
      <div id="weather-box" class="weather"><span class="ico">⏳</span><div>天氣預報載入中…<small>${d.date}・Open-Meteo</small></div></div>
      <p>${esc(p.intro)}</p>
      <div class="actions">
        <a class="btn" href="${esc(p.google_maps_url)}" target="_blank" rel="noopener">📍 Google Maps</a>
        ${p.nav_url ? `<a class="btn" href="${esc(p.nav_url)}" target="_blank" rel="noopener">🧭 導航</a>` : ''}
        ${p.image && p.image.wiki ? `<a class="btn" href="${esc(p.image.wiki)}" target="_blank" rel="noopener">📖 Wikipedia</a>` : ''}
        ${p.website ? `<a class="btn" href="${esc(p.website)}" target="_blank" rel="noopener">🌐 官方網站</a>` : ''}
        ${p.phone ? `<a class="btn" href="tel:${esc(p.phone.replace(/[^+\d]/g, ''))}">📞 ${esc(p.phone)}</a>` : ''}
      </div>
      ${p.tips && p.tips.length ? `<h3>實用提醒</h3><ul>${p.tips.map(t => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
      ${p.nearby.length ? `<h3>周邊推薦餐飲・店家（${p.nearby.length}）</h3><div class="shops">${shops}</div>` : ''}
    `;
    body.querySelectorAll('.shop').forEach(el => el.addEventListener('click', e => {
      if (e.target.tagName === 'A') return;
      const sh = p.nearby[+el.dataset.shop];
      if (sh.lat == null) return;
      const rec = state.shopMarkers[shopKey(sh)];
      if (!rec) return;
      if (!state.showNearby) { $('#toggle-nearby').checked = true; state.showNearby = true; applyView(false); }
      if (state.mode === 'day' && state.day !== rec.day) { state.mode = 'all'; applyView(false); }
      body.querySelectorAll('.shop.active').forEach(x => x.classList.remove('active'));
      el.classList.add('active');
      focusMarker(rec.marker);
      map.flyTo([sh.lat, sh.lng], 16, { duration: .8 });
      setTimeout(() => rec.marker.openPopup(), 850);
      if (window.innerWidth <= 860) closeDetail();
    }));
    const panel = $('#detail');
    panel.hidden = false;
    panel.scrollTop = 0;
    panel.classList.remove('expanded');
    setSheetLabel(false);
    panel.classList.remove('in'); void panel.offsetWidth; panel.classList.add('in');
    loadWeather(p, d.date);
  }
  function setSheetLabel(expanded) {
    const b = $('#sheet-toggle');
    b.textContent = expanded ? '收合 ▾' : '展開 ▴';
    b.setAttribute('aria-expanded', expanded);
  }
  function closeDetail() {
    $('#detail').hidden = true;
    focusMarker(null);
    document.querySelectorAll('.stop.active').forEach(x => x.classList.remove('active'));
  }

  /* ---------- weather (Open-Meteo) ---------- */
  async function loadWeather(p, date) {
    const box = $('#weather-box');
    const key = `${p.id}|${date}`;
    const render = w => {
      if (!box.isConnected) return;
      if (!w) { box.innerHTML = `<span class="ico">📅</span><div>此日期尚未提供預報（Open-Meteo 僅提供未來 16 天）<small>${date}</small></div>`; return; }
      const [ico, txt] = WMO[w.code] || ['🌡️', '—'];
      box.innerHTML = `<span class="ico">${ico}</span><div><b>${txt}</b>　${Math.round(w.min)}°–${Math.round(w.max)}°C　降雨機率 ${w.pop ?? '–'}%<small>${date} 預報・Open-Meteo（每日更新）</small></div>`;
    };
    if (state.weatherCache[key] !== undefined) return render(state.weatherCache[key]);
    try {
      const u = `${METEO}?latitude=${p.lat}&longitude=${p.lng}&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=Asia%2FTokyo&start_date=${date}&end_date=${date}`;
      const r = await fetch(u);
      if (!r.ok) throw new Error(r.status);
      const j = await r.json();
      const w = j.daily && j.daily.time && j.daily.time.length ? {
        code: j.daily.weather_code[0], max: j.daily.temperature_2m_max[0], min: j.daily.temperature_2m_min[0], pop: j.daily.precipitation_probability_max[0]
      } : null;
      state.weatherCache[key] = (w && w.max != null) ? w : null;
    } catch { state.weatherCache[key] = null; }
    render(state.weatherCache[key]);
  }

  /* ---------- routes (OSRM) ---------- */
  async function fetchRoutes() {
    for (const d of state.data.days) {
      const segs = busSegments(d);
      if (!segs.length) continue;
      // 連續的巴士段合併成一次請求（含中間所有點）
      const coords = [segs[0].a, ...segs.map(s => s.b)];
      const key = 'osrm:' + coords.map(c => `${c.lat},${c.lng}`).join(';');
      let res = storage(true, key);
      if (!res) {
        try {
          const u = OSRM + coords.map(c => `${c.lng},${c.lat}`).join(';') + '?overview=full&geometries=geojson&steps=false';
          const r = await fetch(u);
          if (!r.ok) throw new Error(r.status);
          const j = await r.json();
          if (j.code !== 'Ok' || !j.routes.length) throw new Error(j.code);
          const rt = j.routes[0];
          res = { legs: rt.legs.map(l => ({ distance: l.distance, duration: l.duration })), geometry: rt.geometry.coordinates.map(c => [c[1], c[0]]) };
          storage(false, key, res);
        } catch (e) {
          console.warn('OSRM 失敗，改用直線估算', d.day, e);
          res = null;
        }
      }
      const Ld = state.layers[d.day];
      if (res) {
        Ld.route.clearLayers();
        L.polyline(res.geometry, { color: '#fff', weight: 7, opacity: .7 }).addTo(Ld.route);
        L.polyline(res.geometry, { color: color(d.day), weight: 4, opacity: .85 }).addTo(Ld.route);
        segs.forEach((s, k) => setSeg(d.day, s.i, res.legs[k].distance, res.legs[k].duration, false));
      } else {
        segs.forEach(s => {
          const dist = haversine(s.a, s.b) * 1.3;           // 道路係數
          setSeg(d.day, s.i, dist, dist / (50 * 1000 / 3600), true); // 平均 50 km/h
        });
      }
    }
  }
  function setSeg(day, i, dist, dur, est) {
    const el = document.getElementById(`seg-${day}-${i}`);
    if (el) el.innerHTML = `<b>${fmtKm(dist)}</b>・約 ${fmtMin(dur)}${est ? ' <span class="muted">(直線估算)</span>' : ''}`;
  }

  /* ---------- info drawer ---------- */
  function buildInfoDrawer() {
    const { meta, days, places } = state.data;
    const hotels = days.filter(d => d.hotel).map(d => {
      const h = places[d.hotel];
      return `<li><b>${d.date.slice(5).replace('-', '/')}</b> ${esc(h.name_zh)}<br><span class="muted">${h.phone ? `<a href="tel:${esc(h.phone.replace(/[^+\d]/g, ''))}">${esc(h.phone)}</a>・` : ''}<a href="${esc(h.google_maps_url)}" target="_blank" rel="noopener">地圖</a>${h.website ? `・<a href="${esc(h.website)}" target="_blank" rel="noopener">官網</a>` : ''}</span></li>`;
    }).join('');
    $('#info-body').innerHTML = `
      <p class="muted" style="margin:6px 0 0">行程代號 ${esc(meta.code)}・${esc(meta.subtitle)}</p>
      <div class="info-grid">
        ${meta.flights.map(f => `<div class="card"><h4>${esc(f.dir)}｜${esc(f.no)}</h4><div class="big">${esc(f.dep)} → ${esc(f.arr)}</div><div class="muted">${esc(f.date)}・飛行 ${esc(f.duration)}</div></div>`).join('')}
        <div class="card"><h4>集合</h4><div class="big">${esc(meta.meeting.time)}</div><div>${esc(meta.meeting.place)}</div></div>
        <div class="card"><h4>領隊</h4><div class="big">${esc(meta.leader.name)}</div>
          <div>台灣：<a href="tel:${esc(meta.leader.phone_tw.replace(/\s/g, ''))}">${esc(meta.leader.phone_tw)}</a></div>
          <div>日本：<a href="tel:${esc(meta.leader.phone_jp.replace(/\s/g, ''))}">${esc(meta.leader.phone_jp)}</a></div></div>
        <div class="card" style="grid-column:1/-1"><h4>住宿飯店</h4><ul>${hotels}</ul></div>
        <div class="card" style="grid-column:1/-1"><h4>注意事項</h4><ul>${meta.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul></div>
      </div>`;
  }

  /* ---------- UI binding ---------- */
  function bindUI() {
    $('#mode-all').addEventListener('click', () => { state.mode = 'all'; closeDetail(); applyView(true); });
    $('#mode-day').addEventListener('click', () => { state.mode = 'day'; closeDetail(); applyView(true); });
    $('#toggle-nearby').addEventListener('change', e => { state.showNearby = e.target.checked; applyView(false); });
    $('#detail-close').addEventListener('click', closeDetail);
    $('#sheet-toggle').addEventListener('click', () => {
      const on = $('#detail').classList.toggle('expanded');
      setSheetLabel(on);
    });
    const openInfo = () => { $('#info-drawer').hidden = false; $('#backdrop').hidden = false; $('#btn-info').setAttribute('aria-expanded', 'true'); };
    const closeInfo = () => { $('#info-drawer').hidden = true; $('#backdrop').hidden = true; $('#btn-info').setAttribute('aria-expanded', 'false'); };
    $('#btn-info').addEventListener('click', openInfo);
    $('#info-close').addEventListener('click', closeInfo);
    $('#backdrop').addEventListener('click', closeInfo);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeInfo(); closeDetail(); } });
    window.addEventListener('resize', () => map.invalidateSize());
    $('#legend-toggle').addEventListener('click', e => {
      const lg = e.target.closest('.legend'); const open = lg.classList.toggle('open');
      e.target.setAttribute('aria-expanded', open); e.target.textContent = open ? '圖例 ▴' : '圖例 ▾';
    });
  }

  function registerSW() {
    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      navigator.serviceWorker.register('sw.js').catch(e => console.warn('SW 註冊失敗', e));
    }
  }

  window.TripApp = { openDetail: (d, i) => selectStop(d, i, false) };
  document.addEventListener('DOMContentLoaded', init);
})();

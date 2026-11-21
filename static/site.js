// Land Scout, static edition: all searching happens in the browser from listings.json.
(() => {
  const ROOT = document.documentElement.dataset.root || '/';
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  const DISTRICTS = ['Kathmandu', 'Lalitpur', 'Bhaktapur'];
  const SOURCES = ['nepalhomes', 'gharghaderi'];
  const CITY = {near: [0, 5, 'near the city'], edge: [5, 10, 'at the edge of the city'], out: [10, 999, 'in the outskirts']};
  const PAGE = 40;

  /* ---------- money and units, same wording as the server ---------- */
  function npr(v) {
    if (v == null) return 'Price on call';
    v = Math.round(v / 1000) * 1000;
    const crore = Math.floor(v / 1e7), lakh = Math.floor((v % 1e7) / 1e5), th = Math.floor((v % 1e5) / 1e3);
    const parts = [];
    if (crore) parts.push(`${crore} Crore`);
    if (lakh) parts.push(`${lakh} Lakh`);
    if (th && !crore) parts.push(`${th} Thousand`);
    return 'रु. ' + (parts.join(' ') || '0');
  }
  const shortNpr = v => v == null ? '?' : v >= 9.95e6 ? (v / 1e7).toFixed(2).replace(/\.?0+$/, '') + 'Cr' : Math.round(v / 1e5) + 'L';
  function areaText(a) {
    if (!a) return 'Size not given';
    let d = Math.round(a * 16); const r = Math.floor(d / 256); d -= r * 256;
    const an = Math.floor(d / 16); d -= an * 16; const p = Math.floor(d / 4), dm = d - p * 4;
    return [r && `${r} ropani`, an && `${an} aana`, p && `${p} paisa`, dm && `${dm} dam`].filter(Boolean).join(' ') || 'under 1 dam';
  }
  const aboutAana = a => `${Math.max(0.5, Math.round(a * 2) / 2)} aana`;
  const dist = m => m == null ? '' : m < 1000 ? `${m} m` : `${(m / 1000).toFixed(1)} km`;
  const daysOld = x => { const d = x.pd || x.fs; if (!d) return 0; return Math.floor((Date.now() - Date.parse(d)) / 864e5); };
  const median = a => { const s = [...a].sort((p, q) => p - q), n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : 0; };

  /* ---------- saved plots ---------- */
  const KEY = 'landscout.saved';
  const saved = () => { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; } };
  const setSaved = ids => { try { localStorage.setItem(KEY, JSON.stringify(ids)); } catch {} };
  function paintSaved() {
    const ids = saved(), link = $('#saved-link');
    if (link) { link.hidden = !ids.length; $('span', link).textContent = ids.length; }
    $$('button.save').forEach(b => {
      const on = ids.includes(b.dataset.id);
      b.setAttribute('aria-pressed', on);
      if (b.hasAttribute('data-icon')) b.setAttribute('aria-label', on ? 'Remove from saved' : 'Save this plot');
      else b.textContent = on ? 'Saved' : 'Save';
    });
  }
  document.addEventListener('click', e => {
    const b = e.target.closest('button.save');
    if (!b) return;
    e.preventDefault(); e.stopPropagation();
    let ids = saved();
    ids = ids.includes(b.dataset.id) ? ids.filter(i => i !== b.dataset.id) : [...ids, b.dataset.id].slice(-12);
    setSaved(ids); paintSaved();
    if (b.closest('#saved-page')) renderSaved();
  });
  paintSaved();

  /* ---------- filters (same rules as the server version) ---------- */
  const DEFAULTS = {budget: 100, aana: 4, d: [...DISTRICTS], q: '', lane_min: null, paved: false, mainroad: 'off', green: 'any',
                    shops: 'any', age: 'any', photo: false, pin: false, src: [...SOURCES], city: 'any', school: false, health: false};
  function readFilters(p) {
    const f = {...DEFAULTS, d: [...DISTRICTS], src: [...SOURCES]};
    if (!p.has('set')) return f;
    const num = k => { const v = parseFloat(p.get(k)); return v > 0 ? v : null; };
    f.budget = num('budget'); f.aana = num('aana'); f.lane_min = num('lane_min');
    f.d = DISTRICTS.includes(p.get('area')) ? [p.get('area')] : [...DISTRICTS];
    f.q = (p.get('q') || '').trim().slice(0, 60);
    for (const [k, opts] of [['mainroad', ['any', 'off', 'walk', 'far']], ['green', ['any', 'some', 'lots']], ['shops', ['any', 'some', 'lots']],
                             ['age', ['any', '7', '30', '180']], ['city', ['any', 'near', 'edge', 'out']]])
      f[k] = opts.includes(p.get(k)) ? p.get(k) : 'any';
    for (const k of ['paved', 'photo', 'pin', 'school', 'health']) f[k] = p.get(k) === '1';
    return f;
  }
  function toParams(f, extra = {}) {
    const p = new URLSearchParams({set: '1'});
    if (f.budget) p.set('budget', f.budget);
    if (f.aana) p.set('aana', f.aana);
    if (f.d.length === 1) p.set('area', f.d[0]);
    for (const k of ['city', 'mainroad', 'green', 'shops', 'age']) if (f[k] !== 'any') p.set(k, f[k]);
    for (const k of ['school', 'health', 'paved', 'photo', 'pin']) if (f[k]) p.set(k, '1');
    if (f.lane_min) p.set('lane_min', f.lane_min);
    if (f.q) p.set('q', f.q);
    for (const [k, v] of Object.entries(extra)) if (v != null && v !== '') p.set(k, v);
    return p;
  }
  function summary(f) {
    const out = [];
    if (f.budget) out.push([`up to ${npr(f.budget * 1e5)}`, 'budget']);
    if (f.aana) out.push([`at least ${f.aana} aana`, 'aana']);
    if (f.d.length !== 3) out.push([`in ${f.d[0]}`, 'd']);
    if (f.q) out.push([`place name has “${f.q}”`, 'q']);
    if (f.city !== 'any') out.push([CITY[f.city][2], 'city']);
    if (f.mainroad !== 'any') out.push([{off: 'not on a main road', walk: 'main road within a walk', far: 'far from main roads'}[f.mainroad], 'mainroad']);
    if (f.school) out.push(['school nearby', 'school']);
    if (f.health) out.push(['hospital or clinic nearby', 'health']);
    if (f.shops !== 'any') out.push(['shops nearby', 'shops']);
    if (f.green !== 'any') out.push(['fields or trees nearby', 'green']);
    if (f.lane_min) out.push([`road ${f.lane_min} ft or wider`, 'lane_min']);
    if (f.paved) out.push(['black-topped road', 'paved']);
    if (f.age !== 'any') out.push([`listed in the last ${f.age} days`, 'age']);
    if (f.photo) out.push(['has a photo', 'photo']);
    if (f.pin) out.push(['exact map location', 'pin']);
    return out;
  }
  const drop = (f, key) => ({...f, [key]: key === 'd' ? [...DISTRICTS] : ['budget', 'aana', 'lane_min'].includes(key) ? null :
                                         ['mainroad', 'green', 'shops', 'age', 'city'].includes(key) ? 'any' : key === 'q' ? '' : false});

  function check(x, f) {
    if (x.cm || !f.d.includes(x.d) || !f.src.includes(x.s)) return null;
    if (f.q && !`${x.l} ${x.m} ${x.tl} ${x.t}`.toLowerCase().includes(f.q.toLowerCase())) return null;
    const age = daysOld(x);
    if (f.age !== 'any' && age > +f.age) return null;
    if ((f.photo && !x.im) || (f.pin && !x.x)) return null;
    const res = [], add = (st, kind, text) => res.push([st, kind, text]);
    const o = x.o, haveO = !!o && x.la != null, rough = !x.x;
    if (f.budget) {
      if (x.un) add('unknown', 'price', 'price to confirm');
      else if (x.p > f.budget * 1e5) add('no', 'budget', `${npr(x.p - f.budget * 1e5)} over your budget`);
      else add('ok', 'budget', 'within budget');
    }
    if (f.aana) {
      if (x.a == null) add('unknown', 'size', 'size not given');
      else if (x.a < f.aana) add('no', 'size', `${(f.aana - x.a).toFixed(2).replace(/\.00$/, '')} aana too small`);
      else add('ok', 'size', areaText(x.a));
    }
    if (f.lane_min) {
      if (x.r == null) add('unknown', 'road', 'road width not given');
      else if (x.r < f.lane_min) add('no', 'road', `road is ${x.r} ft`);
      else add('ok', 'road', `${x.r} ft road`);
    }
    if (f.paved) {
      if (!x.rt) add('unknown', 'paved', 'road surface not given');
      else if (/black|pitch|paved/.test(x.rt)) add('ok', 'paved', 'black-topped road');
      else add('no', 'paved', `${x.rt} road`);
    }
    if (f.mainroad !== 'any') {
      if (x.fr) add('no', 'mainroad', 'on or near a main road');
      else if (x.r && x.r >= 30) add('no', 'mainroad', 'on or near a main road');
      else if (!haveO) add('unknown', 'loc', 'location not given');
      else {
        const d = o[0] == null ? 99999 : o[0];
        const [lo, hi] = {off: [100, null], walk: [150, 1500], far: [1000, null]}[f.mainroad];
        const ok = d >= lo && (hi == null || d <= hi);
        const margin = Math.min(Math.abs(d - lo), hi ? Math.abs(d - hi) : 99999);
        if (rough && margin < 300) add('unknown', 'nearroad', 'may be near a main road');
        else add(ok ? 'ok' : 'no', 'mainroad', ok ? `${dist(d === 99999 ? null : d) || '2.5 km+'} to main road` : 'on or near a main road');
      }
    }
    for (const [key, idx, need, word] of [['green', 6, {some: 2, lots: 5}, 'fields or trees'], ['shops', 2, {some: 3, lots: 10}, 'shops']]) {
      if (f[key] === 'any') continue;
      if (!haveO) add('unknown', 'loc', 'location not given');
      else add(o[idx] >= need[f[key]] ? 'ok' : 'no', key, o[idx] >= need[f[key]] ? `${word} nearby` : `few ${word} nearby`);
    }
    if (f.city !== 'any') {
      if (!x.ck) add('unknown', 'loc', 'location not given');
      else {
        const [lo, hi] = CITY[f.city], km = x.ck[1];
        if (rough && Math.min(Math.abs(km - lo), Math.abs(km - hi)) < 1) add('unknown', 'cityedge', `about ${km} km from ${x.ck[0]}`);
        else add(km >= lo && km < hi ? 'ok' : 'no', 'city', `${km} km from ${x.ck[0]} centre`);
      }
    }
    for (const [key, idx, word] of [['school', 4, 'school'], ['health', 5, 'hospital or clinic']]) {
      if (!f[key]) continue;
      if (!haveO) add('unknown', 'loc', 'location not given');
      else add(o[idx] ? 'ok' : 'no', key, o[idx] ? `${word} within 1 km` : `no ${word} within 1 km`);
    }
    if (x.r != null && x.r < 8) add('no', 'access', 'no vehicle access');
    const fails = res.filter(r => r[0] === 'no').length, unk = res.filter(r => r[0] === 'unknown').length;
    const g = !fails && !unk ? 'all' : !fails ? 'maybe' : fails === 1 ? 'one' : null;
    if (!g) return null;
    let score = 50;
    if (haveO) {
      const m = o[0];
      score += m != null && m >= 150 && m <= 1200 ? 10 : m != null && m < 100 ? -6 : 0;
      score += Math.min(10, 2 * o[6]) + Math.min(8, o[2] / 2);
    }
    if (x.q && !x.un && f.budget && f.aana) { const ideal = f.budget * 1e5 / f.aana; score += Math.max(-5, Math.min(10, (ideal - x.q) / ideal * 20)); }
    score += age <= 30 ? 5 : age > 180 ? -6 : 0;
    score += (x.x ? 3 : 0) + (x.im ? 2 : 0) + (x.r && x.r >= 12 && x.r <= 20 ? 2 : 0) - (x.r && x.r > 25 ? 10 : 0);
    if (x.pc && x.pc[3]) score -= 4;
    return {g, res, score};
  }

  function tags(x, res) {
    const out = [];
    for (const [st, kind, text] of res) {
      if (st === 'no') out.push(['bad', text[0].toUpperCase() + text.slice(1)]);
      else if (st === 'unknown') out.push(['warn', {price: 'Price to confirm', loc: 'Location not given', size: 'Size not given', road: 'Road width not given',
                                                     nearroad: 'May be near a main road', cityedge: text, paved: 'Road surface not given'}[kind] || text]);
    }
    if (x.un && !out.some(t => t[1] === 'Price to confirm')) out.unshift(['warn', 'Price to confirm']);
    if (x.pc && x.pc[3] && !x.un) out.unshift(['warn', 'Much cheaper than nearby']);
    const o = x.o;
    if (out.length < 2 && o && x.la != null && o[0] != null && !out.some(t => /main road/i.test(t[1]))) out.push(['', `${dist(o[0])} to main road`]);
    if (out.length < 2 && o && o[6] >= 4) out.push(['', 'Green around']);
    if (out.length < 2 && o && o[2] >= 10) out.push(['', 'Shops nearby']);
    return [...new Map(out.map(t => [t[1], t])).values()].slice(0, 2);
  }

  let leafletP;
  const loadLeaflet = () => leafletP || (leafletP = new Promise(res => {
    const s = document.createElement('script');
    s.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'; s.integrity = 'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo='; s.crossOrigin = '';
    s.onload = res; document.body.appendChild(s);
  }));
  const plotUrl = x => `${ROOT}l/${x.i}/`;

  /* ---------- search page ---------- */
  const page = $('#search-page');
  if (!page) { initPlot(); return; }
  let L = [], built = '';
  const form = $('#ff');

  function countAll(f) { let n = 0; for (const x of L) { const c = check(x, f); if (c && c.g === 'all') n++; } return n; }
  function facets(f) {
    const c = {d: {}, city: {}, mainroad: {}};
    const fd = {...f, d: [...DISTRICTS]};
    for (const x of L) { const r = check(x, fd); if (r && r.g === 'all') c.d[x.d] = (c.d[x.d] || 0) + 1; }
    for (const k of ['near', 'edge', 'out']) c.city[k] = countAll({...f, city: k});
    for (const k of ['off', 'walk', 'far']) c.mainroad[k] = countAll({...f, mainroad: k});
    for (const k of ['school', 'health']) c[k] = countAll({...f, [k]: true});
    c.shops = countAll({...f, shops: 'some'}); c.green = countAll({...f, green: 'some'});
    return c;
  }
  function buys(f) {
    if (!f.budget) return null;
    const budget = f.budget * 1e5, want = f.aana || 4, pool = L.filter(x => x.q && !x.un && x.ck && x.q <= 3e7 && f.d.includes(x.d));
    if (pool.length < 20) return null;
    const bands = [];
    for (const [key, [lo, hi, label]] of Object.entries(CITY)) {
      const pers = pool.filter(x => x.ck[1] >= lo && x.ck[1] < hi).map(x => x.q);
      if (pers.length >= 5) { const m = median(pers); bands.push({key, label, per: m, aana: budget / m}); }
    }
    const places = new Map();
    for (const x of pool) {
      const loc = (x.l || '').trim(); if (!loc || loc.length > 28) continue;
      const k = loc.toLowerCase() + '|' + x.d;
      if (!places.has(k)) places.set(k, {place: loc, district: x.d, pers: [], kms: []});
      places.get(k).pers.push(x.q); places.get(k).kms.push(x.ck[1]);
    }
    const ps = [...places.values()].filter(p => p.pers.length >= 3).map(p => ({...p, per: median(p.pers), km: median(p.kms), aana: budget / median(p.pers)}));
    return {budget, want, bands, closest: ps.filter(p => p.aana >= want).sort((a, b) => a.km - b.km).slice(0, 3)};
  }
  function ideas(f, have) {
    const cand = [];
    if (f.budget) for (const m of [1.1, 1.25]) { const b = Math.round(f.budget * m / 5) * 5; cand.push([`raise your budget to ${npr(b * 1e5)}`, {...f, budget: b}]); }
    if (f.aana > 1) for (const less of [0.5, 1]) cand.push([`accept ${f.aana - less} aana`, {...f, aana: f.aana - less}]);
    if (f.mainroad !== 'any') cand.push(['allow any distance to the main road', {...f, mainroad: 'any'}]);
    if (f.city !== 'any') cand.push(['look anywhere in the valley', {...f, city: 'any'}]);
    if (f.d.length !== 3) cand.push(['search all three districts', {...f, d: [...DISTRICTS]}]);
    for (const k of ['school', 'health', 'paved', 'photo', 'pin']) if (f[k]) cand.push([`drop “${summary({...DEFAULTS, budget: null, aana: null, mainroad: 'any', [k]: true})[0][0]}”`, {...f, [k]: false}]);
    for (const k of ['green', 'shops']) if (f[k] !== 'any') cand.push([`drop “${k === 'green' ? 'fields or trees' : 'shops'} nearby”`, {...f, [k]: 'any'}]);
    const scored = cand.map(([t, g]) => [t, g, countAll(g) - have]).filter(c => c[2] > 0).sort((a, b) => b[2] - a[2]);
    const seen = new Set();
    return scored.filter(([t]) => { const k = t.split(' ')[0] + t.split(' ').slice(-1)[0]; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 3);
  }

  function setForm(f, sort) {
    form.elements.budget.value = f.budget || '';
    if (f.budget && ![...form.elements.budget.options].some(o => +o.value === f.budget)) {
      form.elements.budget.add(new Option(`Up to ${npr(f.budget * 1e5)}`, f.budget), 0); form.elements.budget.value = f.budget;
    }
    form.elements.aana.value = f.aana || '';
    if (f.aana && ![...form.elements.aana.options].some(o => +o.value === f.aana)) {
      form.elements.aana.add(new Option(`${areaText(f.aana)} or more`, f.aana), 0); form.elements.aana.value = f.aana;
    }
    form.elements.area.value = f.d.length === 1 ? f.d[0] : 'valley';
    for (const k of ['city', 'mainroad', 'age']) form.elements[k].value = f[k];
    form.elements.lane_min.value = f.lane_min || '';
    form.elements.q.value = f.q;
    for (const k of ['school', 'health', 'paved', 'photo', 'pin']) form.elements[k].checked = f[k];
    form.elements.shops.checked = f.shops !== 'any'; form.elements.green.checked = f.green !== 'any';
    $('#sort').value = sort;
  }
  function readForm() {
    const fd = new FormData(form), p = new URLSearchParams({set: '1'});
    for (const [k, v] of fd) if (v !== '' && v !== 'valley' && v !== 'any') p.set(k, v);
    p.set('sort', $('#sort').value);
    return p;
  }
  function paintCounts(c) {
    const lab = (sel, v, n) => { const o = [...form.elements[sel].options].find(o => o.value === v); if (o) o.textContent = o.dataset.label + (n != null ? ` (${n})` : ''); };
    for (const d of DISTRICTS) lab('area', d, c.d[d] || 0);
    for (const k of ['near', 'edge', 'out']) lab('city', k, c.city[k]);
    for (const k of ['off', 'walk', 'far']) lab('mainroad', k, c.mainroad[k]);
    for (const k of ['school', 'health', 'shops', 'green']) { const s = $(`small[data-c="${k}"]`); if (s) s.textContent = c[k]; }
  }

  const ago = x => { if (!x.pd) return ''; const d = daysOld(x); return d <= 0 ? 'listed today' : d === 1 ? 'listed yesterday' : d < 31 ? `listed ${d} days ago` : d < 365 ? `listed ${Math.floor(d / 30)} month${d >= 60 ? 's' : ''} ago` : 'listed over a year ago'; };
  function card(x, res) {
    const isNew = x.fs && (Date.parse(built) - Date.parse(x.fs)) / 864e5 <= 3 && x.fs > (L.firstSeenFloor || '');
    const tg = tags(x, res);
    return `<li class="card" id="p-${x.i}" data-id="${x.i}">
      <a class="cimg" href="${plotUrl(x)}" tabindex="-1" aria-hidden="true">${x.im ? `<img src="${ROOT}img/${x.i}.jpg" alt="" loading="lazy" onerror="this.remove()">` : '<span class="nophoto">No photo</span>'}${isNew ? '<span class="badge">New</span>' : ''}</a>
      <button type="button" class="heart save" data-id="${x.i}" data-icon aria-pressed="false" aria-label="Save this plot"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.5s-7.5-4.6-9.3-9.2C1.5 8 3.4 4.5 7 4.5c2 0 3.6 1.1 5 3 1.4-1.9 3-3 5-3 3.6 0 5.5 3.5 4.3 6.8-1.8 4.6-9.3 9.2-9.3 9.2z"/></svg></button>
      <a class="cbody" href="${plotUrl(x)}">
        <span class="cprice">${esc(x.pv[0])}</span>
        <span class="csize">${esc(x.as || 'Size not given')}${x.q && x.p && !x.un ? ` · ${esc(npr(x.q))}/aana` : ''}</span>
        <span class="caddr">${esc(x.ad)}</span>
        ${tg.length ? `<span class="ctags">${tg.map(([k, t]) => `<span class="tag ${k}">${esc(t)}</span>`).join('')}</span>` : ''}
      </a></li>`;
  }

  let map, layer, markers = {}, mapOpen = false;
  const phone = matchMedia('(max-width: 900px)');
  function highlight(id, on) {
    $(`#p-${id}`)?.classList.toggle('on', on);
    const m = markers[id], el = m && m.getElement();
    if (el) { el.firstChild.classList.toggle('on', on); m.setZIndexOffset(on ? 1000 : 0); }
  }
  async function drawMap(items) {
    if (phone.matches && !mapOpen) return;
    await loadLeaflet();
    if (!map) {
      map = L2();
    }
    layer.clearLayers(); markers = {};
    const pts = [];
    for (const x of items) {
      if (x.la == null || x.la < 27.55 || x.la > 27.83 || x.lo < 85.18 || x.lo > 85.56) continue;
      const icon = window.L.divIcon({className: '', iconSize: null, html: `<span class="ppin${x.x ? '' : ' rough'}">${x.un ? '?' : shortNpr(x.p)}</span>`});
      const m = window.L.marker([x.la, x.lo], {icon}).addTo(layer).bindTooltip(`${esc(x.ad)}: ${esc(x.as)}, ${esc(x.pv[0])}`, {direction: 'top', offset: [0, -14]});
      m.on('click', () => { if (phone.matches) { location.href = plotUrl(x); return; }
        const c = $(`#p-${x.i}`); if (c) { c.scrollIntoView({block: 'center', behavior: 'smooth'}); highlight(x.i, true); setTimeout(() => highlight(x.i, false), 1600); } });
      m.on('mouseover', () => highlight(x.i, true)); m.on('mouseout', () => highlight(x.i, false));
      markers[x.i] = m; pts.push([x.la, x.lo]);
    }
    map.invalidateSize();
    if (pts.length) map.fitBounds(pts, {padding: [40, 40], maxZoom: 14});
  }
  function L2() {
    const m = window.L.map('map', {scrollWheelZoom: true}).setView([27.68, 85.35], 11);
    window.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {maxZoom: 19, attribution: '&copy; OpenStreetMap contributors'}).addTo(m);
    layer = window.L.layerGroup().addTo(m);
    return m;
  }

  function render() {
    const p = new URLSearchParams(location.search);
    const f = readFilters(p), sort = ['best', 'new', 'cheap', 'big'].includes(p.get('sort')) ? p.get('sort') : 'best';
    const show = ['all', 'maybe', 'one'].includes(p.get('show')) ? p.get('show') : 'all';
    const n = Math.max(PAGE, Math.min(400, +p.get('n') || PAGE));
    setForm(f, sort);
    const groups = {all: [], maybe: [], one: []};
    for (const x of L) { const c = check(x, f); if (c) groups[c.g].push([x, c]); }
    const key = {best: ([, c]) => -c.score, new: ([x]) => daysOld(x), cheap: ([x]) => (x.un ? 9e12 : x.q || 9e12), big: ([x]) => -(x.a || 0)}[sort];
    for (const g of Object.values(groups)) g.sort((a, b) => key(a) - key(b));
    const c = facets(f); paintCounts(c);
    const chosen = summary(f);
    $('#filters-open').textContent = `Filters${chosen.length ? ` (${chosen.length})` : ''}`;
    $('#show-n').textContent = `Show ${groups.all.length} plots`;
    const q = s => `?${toParams(s, {sort}).toString()}`;
    const b = show === 'all' ? buys(f) : null;
    const list = groups[show], shown = list.slice(0, n);
    const id = show === 'all' && groups.all.length < 12 ? ideas(f, groups.all.length) : [];
    let html = '';
    if (chosen.length) html += `<div class="chosen"><span>Showing land:</span>${chosen.map(([t, k]) => `<a class="chip" href="${q(drop(f, k))}" data-nav>${esc(t)} <b aria-hidden="true">×</b></a>`).join('')}<a class="clearall" href="?set=1" data-nav>Clear all</a></div>`;
    if (b && b.bands.length) html += `<section class="buys"><h2>With ${esc(npr(b.budget))} you can get about</h2><ul>${b.bands.map(x => `<li><a href="${q({...f, city: x.key})}" data-nav class="${f.city === x.key ? 'on' : ''}"><b>${aboutAana(x.aana)}</b><span>${x.label}</span></a></li>`).join('')}</ul><p>Based on today's asking prices${b.closest.length ? `. Closest to the city with ${b.want}+ aana: ${b.closest.map(p => `<a href="${q({...f, q: p.place, city: 'any'})}" data-nav>${esc(p.place)}</a>`).join(', ')}` : ''}.</p></section>`;
    html += `<div class="split"><section class="listcol"><div class="rhead"><h2>${show === 'all' ? `${groups.all.length} plot${groups.all.length === 1 ? ' matches' : 's match'}` : show === 'maybe' ? `${groups.maybe.length} might match` : `${groups.one.length} miss one thing`}</h2></div>`;
    if (show !== 'all') html += `<p class="note"><a href="${q(f)}" data-nav>← Back to the ${groups.all.length} that match</a>. ${show === 'maybe' ? 'These listings leave something out, often the price or the location.' : 'Each one says what it misses.'}</p>`;
    if (id.length) html += `<p class="ideas">${groups.all.length ? 'Only a few match.' : 'Nothing matches yet.'} To see more, try: ${id.map(([t, g, gain]) => `<a href="${q(g)}" data-nav>${esc(t)}</a> (+${gain})`).join(', ')}.</p>`;
    if (shown.length) {
      html += `<ul class="cards">${shown.map(([x, c]) => card(x, c.res)).join('')}</ul>`;
      if (list.length > shown.length) html += `<a class="loadmore" href="?${toParams(f, {sort, show: show === 'all' ? '' : show, n: shown.length + 40})}" data-nav>Show more plots</a>`;
      if (show === 'all' && (groups.maybe.length || groups.one.length)) html += `<p class="others">Also: ${groups.maybe.length ? `<a href="?${toParams(f, {sort, show: 'maybe'})}" data-nav>${groups.maybe.length} might match</a> (listing leaves out a detail)` : ''}${groups.maybe.length && groups.one.length ? ' · ' : ''}${groups.one.length ? `<a href="?${toParams(f, {sort, show: 'one'})}" data-nav>${groups.one.length} miss one thing</a>` : ''}</p>`;
    } else {
      const bb = buys(f);
      html += `<div class="empty"><h3>No plots match all of this right now</h3>${bb && f.aana ? `<p>For reference, ${esc(areaText(f.aana))} usually costs about:</p><ul class="costs">${bb.bands.map(x => `<li><a href="${q({...f, budget: Math.ceil(x.per * f.aana / 1e5 / 5) * 5, city: x.key})}" data-nav><b>${esc(npr(x.per * f.aana))}</b> ${x.label}</a></li>`).join('')}</ul><p class="faint small">Tap one to search with that budget.</p>` : '<p>Try a bigger budget or fewer filters.</p>'}
        <p class="emptyacts">${groups.maybe.length ? `<a class="btn quiet" href="?${toParams(f, {sort, show: 'maybe'})}" data-nav>See ${groups.maybe.length} that might match</a>` : ''}${groups.one.length ? `<a class="btn quiet" href="?${toParams(f, {sort, show: 'one'})}" data-nav>See ${groups.one.length} that miss one thing</a>` : ''}</p></div>`;
    }
    html += `<p class="tip">Tip: bookmark this page to come back to the same search. New listings are added every few hours (last update ${esc(new Date(built).toLocaleString('en-GB', {day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'}))}).</p>`;
    html += `</section><aside class="mapcol${mapOpen ? ' open' : ''}" id="mapcol" aria-label="Map of these plots"><div id="map"></div></aside></div>`;
    const results = $('#results');
    const oldMap = map && map.getContainer();
    results.innerHTML = html;
    if (oldMap) $('#map').replaceWith(oldMap);
    $$('.card', results).forEach(cd => { cd.addEventListener('mouseenter', () => highlight(cd.dataset.id, true)); cd.addEventListener('mouseleave', () => highlight(cd.dataset.id, false)); });
    paintSaved();
    drawMap(shown.map(([x]) => x));
  }

  function go(params, push = true) {
    const url = `${location.pathname}?${params}`;
    if (push) history.pushState(null, '', url); else history.replaceState(null, '', url);
    render();
  }
  document.addEventListener('click', e => {
    const a = e.target.closest('a[data-nav]');
    if (!a || e.metaKey || e.ctrlKey) return;
    e.preventDefault();
    go(new URL(a.href, location.href).searchParams.toString());
    if (a.closest('.chosen, .buys, .ideas, .empty, .note, .others')) window.scrollTo({top: $('#results').offsetTop - 80, behavior: 'smooth'});
  });
  window.addEventListener('popstate', render);
  let timer;
  form.addEventListener('change', e => { if (e.target.name === 'q') return; if (phone.matches && form.classList.contains('open')) { previewCount(); return; } go(readForm()); });
  form.addEventListener('input', e => { if (e.target.name === 'q') { clearTimeout(timer); timer = setTimeout(() => go(readForm(), false), 500); } });
  form.addEventListener('submit', e => { e.preventDefault(); closeSheet(); go(readForm()); });
  $('#sort').addEventListener('change', () => go(readForm()));
  function previewCount() { const n = countAll(readFilters(readForm())); $('#show-n').textContent = `Show ${n} plot${n === 1 ? '' : 's'}`; }
  const openBtn = $('#filters-open');
  const closeSheet = () => { form.classList.remove('open'); openBtn.setAttribute('aria-expanded', 'false'); document.body.style.overflow = ''; };
  openBtn.addEventListener('click', () => { form.classList.add('open'); openBtn.setAttribute('aria-expanded', 'true'); document.body.style.overflow = 'hidden'; });
  $('#filters-close').addEventListener('click', closeSheet);
  $('#maptoggle').addEventListener('click', e => {
    mapOpen = !mapOpen; $('#mapcol')?.classList.toggle('open', mapOpen);
    e.currentTarget.textContent = mapOpen ? 'Show list' : 'Map';
    if (mapOpen) render();
  });

  fetch(`${ROOT}listings.json`).then(r => r.json()).then(data => {
    L = data.listings; built = data.built;
    const firsts = L.map(x => x.fs).filter(Boolean).sort();
    L.firstSeenFloor = firsts[Math.floor(firsts.length * 0.5)] || '';   // 'New' only for plots added after the initial import
    $('#results').classList.remove('loading');
    render();
  }).catch(() => { $('#results').innerHTML = '<p class="empty">The listings could not be loaded. Please refresh the page.</p>'; });

  /* ---------- plot page ---------- */
  function initPlot() {
    const el = $('#plot-map');
    if (el) loadLeaflet().then(() => {
      const ll = [+el.dataset.lat, +el.dataset.lon], exact = el.dataset.exact === '1';
      const m = window.L.map(el, {scrollWheelZoom: false}).setView(ll, exact ? 15 : 14);
      window.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {maxZoom: 19, attribution: '&copy; OpenStreetMap contributors'}).addTo(m);
      if (exact) window.L.marker(ll, {icon: window.L.divIcon({className: '', html: '<div class="pin"></div>', iconSize: [14, 14]})}).addTo(m);
      else window.L.circle(ll, {radius: 500, color: '#2f7d4f', weight: 1.5, dashArray: '4 4', fillOpacity: .06}).addTo(m);
    });
    const back = $('#back');
    if (back && document.referrer.startsWith(location.origin + ROOT) && history.length > 1) back.addEventListener('click', e => { e.preventDefault(); history.back(); });
    if ($('#saved-page')) renderSaved();
  }
  function renderSaved() {
    const box = $('#saved-page'), ids = saved();
    if (!ids.length) { box.innerHTML = '<p class="muted">Nothing saved yet. Tap the heart on any plot and it appears here, side by side.</p>'; return; }
    fetch(`${ROOT}listings.json`).then(r => r.json()).then(data => {
      const by = new Map(data.listings.map(x => [x.i, x])), rows = ids.map(i => by.get(i)).filter(Boolean);
      const o = (x, i) => x.o ? x.o[i] : '?';
      const row = (label, fn) => `<tr><th>${label}</th>${rows.map(x => `<td>${fn(x)}</td>`).join('')}</tr>`;
      box.innerHTML = `<div class="scroll"><table class="cmp"><thead><tr><th></th>${rows.map(x => `<th scope="col"><div class="cpic">${x.im ? `<img src="${ROOT}img/${x.i}.jpg" alt="">` : ''}</div><a href="${plotUrl(x)}">${esc(x.ad)}</a><button type="button" class="save" data-id="${x.i}">Remove</button></th>`).join('')}</tr></thead><tbody>
        ${row('Price', x => `<b>${esc(x.pv[0])}</b>`)}${row('Size', x => esc(x.as || '?'))}${row('Per aana', x => x.q && !x.un ? esc(npr(x.q)) : '?')}
        ${row('Road', x => x.r ? `${x.r} ft${x.rt ? ', ' + esc(x.rt) : ''}` : '?')}${row('To main road', x => x.o && x.o[0] != null ? dist(x.o[0]) : '?')}
        ${row('Shops within 1 km', x => o(x, 2))}${row('Schools within 1 km', x => o(x, 4))}${row('Hospitals or clinics', x => o(x, 5))}
        ${row('From city centre', x => x.ck ? `${x.ck[1]} km (${x.ck[0]})` : '?')}${row('Price check', x => x.pc ? esc(x.pc[2]) : '?')}
        ${row('Listing', x => `<a href="${esc(x.u)}" target="_blank" rel="noopener">${x.s}.com</a>`)}</tbody></table></div>`;
      paintSaved();
      $$('#saved-page button.save').forEach(b => { b.textContent = 'Remove'; });
    });
  }
})();

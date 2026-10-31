import { esc } from './api.js';
import { $, msg } from './app.js';
import * as C from './spherex-core.js';
const WISE = { ra: 133.79513, dec: -7.24514 }; // from the catalog designation WISE J085510.83-071442.5 (J2000); not a SPHEREx measurement
const S = { obs: [], p: null, updated: 0, fromCache: false, sel: new Set(), cur: null, pv: new Map(), band: 'all', shown: 24, busy: null };
let timer = null, blink = { i: 0, t: null, tok: 0 }, B = { picks: [] };
const when = o => (o.ms === null ? 'date not provided' : new Date(o.ms).toISOString().replace('T', ' ').slice(0, 16) + ' UTC');
const bandTxt = o => (o.band ? `Band ${o.band} · ` : '') + (o.emMin !== null ? `${(o.emMin * 1e6).toFixed(2)}–${(o.emMax * 1e6).toFixed(2)} µm` : 'wavelength not provided');
const byId = id => S.obs.find(o => o.id === id);
const vis = () => S.obs.filter(o => S.band === 'all' || String(o.band) === S.band);
const setErr = t => { const e = $('#sx-err'); e.hidden = !t; e.textContent = t || ''; };
const setStatus = (t, warn) => { const s = $('#sx-status'); s.textContent = t; s.classList.toggle('sx-warn', !!warn); };

function readForm() {
  const f = id => $('#' + id).value.trim(), n = id => (f(id) === '' ? NaN : Number(f(id)));
  const ra = n('sx-ra'), dec = n('sx-dec'), radius = n('sx-rad'), t1 = f('sx-t1'), t2 = f('sx-t2'), errs = [];
  if (!(ra >= 0 && ra <= 360)) errs.push('RA must be a number from 0 to 360.');
  if (!(dec >= -90 && dec <= 90)) errs.push('Dec must be a number from −90 to 90.');
  if (!(radius > 0 && radius <= 0.5)) errs.push('Radius must be greater than 0 and at most 0.5 degrees.');
  if ((t1 && !t2) || (!t1 && t2)) errs.push('Give both dates or neither.');
  if (t1 && t2 && t1 > t2) errs.push('“From” must not be after “To”.');
  if (errs.length) { setErr(errs.join(' ')); return null; }
  setErr('');
  const p = { collection: $('#sx-coll').value, ra, dec, radius };
  if (t1 && t2) { p.t1 = C.dateToMjd(t1); p.t2 = C.dateToMjd(t2) + 1; }
  return p;
}
async function search(force = false, auto = false) {
  const p = auto ? S.p : readForm(); if (!p) return;
  const k = C.keyOf(p); if (S.busy === k) return; S.busy = k;
  if (!auto) { setStatus('Searching IRSA…'); $('#sx-go').disabled = true; }
  try {
    const r = await C.searchSia(p, force);
    S.p = p; S.obs = p.t1 === undefined ? r.obs : r.obs.filter(o => o.ms !== null && o.ms >= C.mjdToMs(p.t1) && o.ms < C.mjdToMs(p.t2)); S.updated = r.updated; S.fromCache = r.fromCache;
    if (auto) S.sel = new Set([...S.sel].filter(id => byId(id))); else { S.sel.clear(); S.cur = null; S.shown = 24; S.band = 'all'; S.rand = C.randomPrevYearMonth(); stopBlink(); }
    if (!S.cur && S.obs.length) S.cur = S.obs[0].id;
    render();
  } catch (e) {
    if (auto) setStatus('Automatic refresh failed (' + e.message + '). Showing the earlier results.', true); else { setErr(e.message); setStatus(''); }
  } finally { S.busy = null; $('#sx-go').disabled = false; schedule(); }
}
function render() {
  $('#sx-body').hidden = false;
  $('#sx-band').value = S.band;
  const t = new Date(S.updated).toLocaleTimeString();
  setStatus(S.obs.length ? `${S.obs.length} observation(s) from ${S.p.collection}. Last updated ${t}${S.fromCache ? ' (from browser cache)' : ''}. Cached data can be up to 10 minutes old.` : `No SPHEREx observations were returned for this search (last checked ${t}). Try a larger radius or another collection.`);
  $('#sx-src').textContent = S.obs.length ? `Metadata source: IRSA SIA2, collection ${S.p.collection}. Previews: IRSA cutout service, IMAGE extension (MJy/sr), ${C.CUT}° cutouts shown in detector pixel orientation (not rotated to north-up), linear 1–99% scaling.` : '';
  renderGallery(); renderTimeline(); renderViewer(); renderCompare(); computeBlink();
}
function renderGallery() {
  const v = vis(), g = $('#sx-gallery');
  g.innerHTML = v.length ? v.slice(0, S.shown).map(o => { const pv = S.pv.get(o.id);
    return `<article class="sx-card" data-id="${esc(o.id)}"><time class="eyebrow">${esc(when(o))}</time><h3>${esc(o.id)}</h3><p class="sx-meta">${esc(o.coll)}${o.instr ? ' · ' + esc(o.instr) : ''}<br>${esc(bandTxt(o))}</p>
${pv && pv.img ? '<canvas data-draw="1"></canvas>' : pv && pv.err ? `<p class="state err">${esc(pv.err)}</p>` : pv ? '<p class="sx-meta">Loading preview…</p>' : ''}
<button class="btn" data-act="load" type="button">${pv && pv.img ? 'Reload view' : 'Load preview'}</button><label><input type="checkbox" data-act="sel"${S.sel.has(o.id) ? ' checked' : ''}> Compare</label></article>`; }).join('') : msg(S.obs.length ? 'No observations in this band.' : 'No observations to show.');
  $('#sx-ginfo').textContent = S.band === 'all' ? `Showing all bands: ${v.length} observation(s).` : `Showing Band ${S.band} (D${S.band}) only: ${v.length} of ${S.obs.length} observation(s). Observations without band metadata are not shown.`;
  $('#sx-more').hidden = v.length <= S.shown;
  g.querySelectorAll('canvas[data-draw]').forEach(c => { const o = byId(c.closest('.sx-card').dataset.id); C.draw(c, S.pv.get(o.id).img, C.range([S.pv.get(o.id).img])); });
}
function renderTimeline() {
  $('#sx-timeline').innerHTML = vis().map(o => `<li><button type="button" data-id="${esc(o.id)}" aria-current="${o.id === S.cur}">${esc(o.ms === null ? o.id : when(o).slice(0, 16))}</button></li>`).join('');
}
function renderViewer() {
  const o = byId(S.cur), v = $('#sx-viewer'); if (!o) { v.innerHTML = ''; return; }
  const pv = S.pv.get(o.id), h = pv && pv.img ? Object.entries(pv.img.hdr).map(([k, x]) => `${k}=${x}`).join(' · ') : '';
  v.innerHTML = `<p><strong>${esc(o.id)}</strong><br><span class="sx-meta">${esc(when(o))} · ${esc(bandTxt(o))} · ${esc(o.coll)}</span></p>${pv && pv.img ? '<canvas></canvas>' : pv && pv.err ? `<p class="state err">${esc(pv.err)}</p>` : pv ? '<p class="sx-meta">Loading preview…</p>' : '<button class="btn" data-act="load" type="button">Load preview</button>'}<p class="sx-meta">${esc(h)}</p>`;
  const c = v.querySelector('canvas'); if (c) C.draw(c, pv.img, C.range([pv.img]));
}
const chosen = () => [...S.sel].map(byId).filter(Boolean).sort((a, b) => (a.ms ?? Infinity) - (b.ms ?? Infinity));
function renderCompare() {
  const l = chosen(), box = $('#sx-compare'); $('#sx-selinfo').textContent = l.length < 2 ? 'Tick “Compare” on two or more observations.' : `${l.length} selected (oldest to newest).`;
  const ready = l.filter(o => S.pv.get(o.id)?.img), rg = C.range(ready.map(o => S.pv.get(o.id).img));
  box.innerHTML = l.length < 2 ? '' : l.map(o => { const pv = S.pv.get(o.id);
    return `<figure data-id="${esc(o.id)}">${pv && pv.img ? '<canvas></canvas>' : pv && pv.err ? `<p class="state err">${esc(pv.err)}</p>` : '<p class="sx-meta">Preview not loaded.</p>'}<figcaption>${esc(when(o))}<br>${esc(bandTxt(o))}</figcaption></figure>`; }).join('');
  if (l.length >= 2) {
    const c0 = l[0].center, diff = l.some(o => o.center === null || c0 === null || Math.abs(o.center - c0) > 0.01);
    box.insertAdjacentHTML('beforeend', `<p class="sx-meta sx-warn" style="grid-column:1/-1">${diff ? 'These observations have different wavelength coverage, so differences may reflect the band rather than the sky. ' : ''}${ready.length < l.length ? 'Load previews for all selected observations to compare them with a shared scale. ' : 'Shared 1–99% scale across all selected frames. '}Frames are shown in detector pixel orientation.</p>`);
    box.querySelectorAll('figure').forEach(f => { const pv = S.pv.get(f.dataset.id), c = f.querySelector('canvas'); if (c && pv.img) C.draw(c, pv.img, rg); });
  }
}
const bandName = o => (o.band ? `Band ${o.band} (D${o.band})` : 'band not provided');
const MON = (y, m) => new Date(Date.UTC(y, m, 1)).toLocaleString('en', { month: 'long', timeZone: 'UTC' }) + ' ' + y;
const dayIso = ms => new Date(ms).toISOString().slice(0, 10);
function blinkWindow() {
  const p = S.p;
  if (p.t1 !== undefined) { const a = C.mjdToMs(p.t1), b = C.mjdToMs(p.t2); return { a, b, auto: false, label: `Date range: ${dayIso(a)} to ${dayIso(b - 1)} (UTC)` }; }
  const r = S.rand || (S.rand = C.randomPrevYearMonth());
  return { a: Date.UTC(r.y, r.m, 1), b: Date.UTC(r.y, r.m + 1, 1), auto: true, label: `No dates entered: automatically using a random month of the previous year, ${MON(r.y, r.m)}` };
}
function computeBlink() {
  stopBlink(); blink.i = 0; blink.tok++;
  const info = $('#sx-binfo'), msgEl = $('#sx-bmsg');
  if (!S.p) { B = { picks: [] }; info.textContent = msgEl.textContent = ''; renderBlinkFrame(); return; }
  const w = blinkWindow(), band = $('#sx-bband').value, max = +$('#sx-bcount').value, bn = band === 'all' ? 'all bands' : `Band ${band} (D${band})`;
  const r = C.sampleFrames(S.obs, w.a, w.b, band, max); B = { picks: r.picks };
  $('#sx-bre').disabled = !w.auto;
  info.textContent = `${w.label}. Band: ${bn}. About one observation per 12 hours (up to ${max > 0 ? max : C.HARD_MAX}).`;
  const want = Math.min(r.slots, max > 0 ? max : C.HARD_MAX);
  msgEl.textContent = !r.cand ? `No ${band === 'all' ? '' : bn + ' '}observations were found in this period for the current collection, coordinates and radius. Try another search${w.auto ? ' or another random month' : ''}.`
    : r.picks.length < want ? `Only ${r.picks.length} of ${want} possible frames were found: fewer real observations were available (${r.cand} candidates, ${r.found} filled 12-hour slots).` : '';
  renderBlinkFrame();
}
const frames = () => B.picks.filter(o => S.pv.get(o.id)?.img);
function renderBlinkFrame() {
  const f = frames(), bl = $('#sx-bl'), cv = $('#sx-bc');
  if (!S.p) { bl.textContent = 'Run a search to prepare playback frames.'; cv.width = cv.height = 1; return; }
  if (!B.picks.length) { bl.textContent = ''; cv.width = cv.height = 1; return; }
  if (f.length < 2) { bl.textContent = `${B.picks.length} frame(s) selected. Press Play or Next to load their previews; at least 2 loaded frames are needed.`; cv.width = cv.height = 1; return; }
  blink.i = ((blink.i % f.length) + f.length) % f.length; const o = f[blink.i];
  C.draw(cv, S.pv.get(o.id).img, C.range(f.map(x => S.pv.get(x.id).img)));
  bl.textContent = `${blink.i + 1} / ${f.length} · ${when(o)} · ${bandName(o)}${o.emMin !== null ? ` · ${(o.emMin * 1e6).toFixed(2)}–${(o.emMax * 1e6).toFixed(2)} µm` : ''}${f.length < B.picks.length ? ` · ${B.picks.length - f.length} of ${B.picks.length} previews unavailable` : ''}`;
}
function stopBlink() { clearInterval(blink.t); blink.t = null; $('#sx-play').textContent = 'Play'; }
async function ensureBlink() {
  const tok = blink.tok, todo = B.picks.filter(o => !S.pv.get(o.id)); let n = 0;
  const run = async o => { S.pv.set(o.id, { loading: true }); try { S.pv.set(o.id, { img: await C.fetchPreview(o, S.p) }); } catch (e) { S.pv.set(o.id, { err: e.message }); } $('#sx-bl').textContent = `Loading previews ${++n}/${todo.length}…`; };
  for (let k = 0; k < todo.length && tok === blink.tok; k += 4) await Promise.all(todo.slice(k, k + 4).map(run)); // 4 at a time; cached previews are never re-downloaded
  if (tok === blink.tok) renderAll();
  return tok === blink.tok;
}
async function playBlink() {
  stopBlink(); if (!B.picks.length) return;
  if (!(await ensureBlink())) return;
  if (frames().length < 2) { renderBlinkFrame(); return; }
  $('#sx-play').textContent = 'Pause'; blink.t = setInterval(() => { blink.i++; renderBlinkFrame(); }, +$('#sx-speed').value);
}
async function stepBlink(d) { if (!B.picks.length || !(await ensureBlink())) return; blink.i += d; renderBlinkFrame(); }
async function load(o) {
  const cur = S.pv.get(o.id); if (cur && (cur.img || cur.loading)) return;
  S.pv.set(o.id, { loading: true }); renderAll();
  try { S.pv.set(o.id, { img: await C.fetchPreview(o, S.p) }); } catch (e) { S.pv.set(o.id, { err: e.message }); }
  renderAll();
}
function renderAll() { renderGallery(); renderViewer(); renderCompare(); renderBlinkFrame(); }
function schedule() { clearTimeout(timer); if (document.hidden || !S.p) return; timer = setTimeout(() => search(true, true), Math.max(1000, S.updated + C.TTL - Date.now())); }
function step(d) { const v = vis(); if (!v.length) return; S.cur = v[(Math.max(0, v.findIndex(o => o.id === S.cur)) + d + v.length) % v.length].id; renderTimeline(); renderViewer(); load(byId(S.cur)); }

$('#sx-form').addEventListener('submit', e => { e.preventDefault(); search(false); });
$('#sx-wise').addEventListener('click', () => { $('#sx-ra').value = WISE.ra; $('#sx-dec').value = WISE.dec; $('#sx-rad').value = 0.05; });
$('#sx-band').addEventListener('change', e => { S.band = e.target.value; S.shown = 24; renderGallery(); renderTimeline(); });
$('#sx-more').addEventListener('click', () => { S.shown += 24; renderGallery(); });
$('#sx-gallery').addEventListener('click', e => { const a = e.target.closest('[data-act]'); if (!a) return; const o = byId(a.closest('.sx-card').dataset.id);
  if (a.dataset.act === 'load') { S.cur = o.id; renderTimeline(); load(o); } });
$('#sx-gallery').addEventListener('change', e => { if (e.target.dataset.act !== 'sel') return; const id = e.target.closest('.sx-card').dataset.id; e.target.checked ? S.sel.add(id) : S.sel.delete(id); stopBlink(); const o = byId(id); if (e.target.checked) load(o); renderCompare(); renderBlinkFrame(); });
$('#sx-timeline').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; S.cur = b.dataset.id; renderTimeline(); renderViewer(); load(byId(S.cur)); });
$('#sx-viewer').addEventListener('click', e => { if (e.target.dataset.act === 'load') load(byId(S.cur)); });
$('#sx-prev').addEventListener('click', () => step(-1)); $('#sx-next').addEventListener('click', () => step(1));
$('#sx-selband').addEventListener('click', () => { const v = vis().slice(0, 8); S.sel = new Set(v.map(o => o.id)); renderGallery(); renderCompare(); v.forEach(load); });
$('#sx-play').addEventListener('click', () => (blink.t ? stopBlink() : playBlink()));
$('#sx-bprev').addEventListener('click', () => stepBlink(-1)); $('#sx-bnext').addEventListener('click', () => stepBlink(1));
$('#sx-bband').addEventListener('change', computeBlink); $('#sx-bcount').addEventListener('change', computeBlink);
$('#sx-bre').addEventListener('click', () => { S.rand = C.randomPrevYearMonth(new Date(), Math.random, S.rand ? S.rand.m : -1); computeBlink(); });
$('#sx-speed').addEventListener('change', () => { if (blink.t) playBlink(); });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { clearTimeout(timer); stopBlink(); }
  else if (S.p) (Date.now() - S.updated >= C.TTL ? search(true, true) : schedule());
});

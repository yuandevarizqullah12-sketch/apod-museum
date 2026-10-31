import { esc } from './api.js';
import { $, msg } from './app.js';
import * as C from './spherex-core.js';
const WISE = { ra: 133.79513, dec: -7.24514 }; // from the catalog designation WISE J085510.83-071442.5 (J2000); not a SPHEREx measurement
const S = { obs: [], p: null, updated: 0, fromCache: false, cmp: [], cds: null, cinfo: '', applying: false, cur: null, pv: new Map(), band: 'all', shown: 24, busy: null };
let timer = null, blink = { i: 0, t: null, tok: 0 };
const when = o => (o.ms === null ? 'date not provided' : new Date(o.ms).toISOString().replace('T', ' ').slice(0, 16) + ' UTC');
const bandTxt = o => (o.band ? `Band ${o.band} · ` : '') + (o.emMin !== null ? `${(o.emMin * 1e6).toFixed(2)}–${(o.emMax * 1e6).toFixed(2)} µm` : 'wavelength not provided');
const byId = key => S.obs.find(o => o.key === key);
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
async function search(force = false, auto = false, keep = false) {
  const p = auto ? S.p : readForm(); if (!p) return;
  const k = C.keyOf(p); if (S.busy === k) return; S.busy = k;
  if (!auto) { setStatus('Searching IRSA…'); $('#sx-go').disabled = true; }
  try {
    const r = await C.searchSia(p, force);
    if (!S.p || C.keyOf(S.p) !== k) S.pv.clear(); // gallery previews belong to one query
    S.p = p; S.obs = p.t1 === undefined ? r.obs : r.obs.filter(o => o.ms !== null && o.ms >= C.mjdToMs(p.t1) && o.ms < C.mjdToMs(p.t2)); S.updated = r.updated; S.fromCache = r.fromCache;
    if (!auto) { S.cur = null; S.shown = 24; S.band = 'all'; if (!keep) clearApplied(); }
    if (!S.cur && S.obs.length) S.cur = S.obs[0].key;
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
  renderGallery(); renderTimeline(); renderViewer(); renderCompare(); syncBlink();
}
function renderGallery() {
  const v = vis(), g = $('#sx-gallery');
  g.innerHTML = v.length ? v.slice(0, S.shown).map(o => { const pv = S.pv.get(o.key);
    return `<article class="sx-card" data-id="${esc(o.key)}"><time class="eyebrow">${esc(when(o))}</time><h3>${esc(o.id)}</h3><p class="sx-meta">${esc(o.coll)}${o.instr ? ' · ' + esc(o.instr) : ''}<br>${esc(bandTxt(o))}</p>
${pv && pv.img ? '<canvas data-draw="1"></canvas>' : pv && pv.err ? `<p class="state err">${esc(pv.err)}</p>` : pv ? '<p class="sx-meta">Loading preview…</p>' : ''}
<button class="btn" data-act="load" type="button">${pv && pv.img ? 'Reload view' : 'Load preview'}</button></article>`; }).join('') : msg(S.obs.length ? 'No observations in this band.' : 'No observations to show.');
  $('#sx-ginfo').textContent = S.band === 'all' ? `Showing all bands: ${v.length} observation(s).` : `Showing Band ${S.band} (D${S.band}) only: ${v.length} of ${S.obs.length} observation(s). Observations without band metadata are not shown.`;
  $('#sx-more').hidden = v.length <= S.shown;
  g.querySelectorAll('canvas[data-draw]').forEach(c => { const o = byId(c.closest('.sx-card').dataset.id); C.draw(c, S.pv.get(o.key).img, C.range([S.pv.get(o.key).img])); });
}
function renderTimeline() {
  $('#sx-timeline').innerHTML = vis().map(o => `<li><button type="button" data-id="${esc(o.key)}" aria-current="${o.key === S.cur}">${esc(o.ms === null ? o.id : when(o).slice(0, 16))}</button></li>`).join('');
}
function renderViewer() {
  const o = byId(S.cur), v = $('#sx-viewer'); if (!o) { v.innerHTML = ''; return; }
  const pv = S.pv.get(o.key), h = pv && pv.img ? Object.entries(pv.img.hdr).map(([k, x]) => `${k}=${x}`).join(' · ') : '';
  v.innerHTML = `<p><strong>${esc(o.id)}</strong><br><span class="sx-meta">${esc(when(o))} · ${esc(bandTxt(o))} · ${esc(o.coll)}</span></p>${pv && pv.img ? '<canvas></canvas>' : pv && pv.err ? `<p class="state err">${esc(pv.err)}</p>` : pv ? '<p class="sx-meta">Loading preview…</p>' : '<button class="btn" data-act="load" type="button">Load preview</button>'}<p class="sx-meta">${esc(h)}</p>`;
  const c = v.querySelector('canvas'); if (c) C.draw(c, pv.img, C.range([pv.img]));
}
const chosen = () => S.cmp; // the Time Comparison dataset (oldest to newest); Blink Playback plays this same array
function renderCompare() {
  const l = chosen(), box = $('#sx-compare'), pv = o => S.cds && S.cds.pv.get(o.key); $('#sx-selinfo').textContent = S.cinfo;
  const ready = l.filter(o => pv(o)?.img), rg = C.range(ready.map(o => pv(o).img));
  box.innerHTML = !l.length ? '' : l.map(o => { const p = pv(o);
    return `<figure data-id="${esc(o.key)}">${p && p.img ? '<canvas></canvas>' : p && p.err ? `<p class="state err">${esc(p.err)}</p>` : '<p class="sx-meta">Preview not loaded.</p>'}<figcaption>${esc(when(o))}<br>${esc(o.id)}<br>${esc(bandTxt(o))}</figcaption></figure>`; }).join('');
  if (l.length) {
    box.insertAdjacentHTML('beforeend', `<p class="sx-meta" style="grid-column:1/-1">${ready.length > 1 ? 'Shared 1–99% scale across the frames. ' : ''}Frames are shown in detector pixel orientation.</p>`);
    box.querySelectorAll('figure').forEach(f => { const p = S.cds.pv.get(f.dataset.id), c = f.querySelector('canvas'); if (c && p.img) C.draw(c, p.img, rg); });
  }
}
const bandName = o => (o.band ? `Band ${o.band} (D${o.band})` : 'band not provided');
// Time Comparison owns the dataset. Dropdown changes are only "pending"; Set Time builds a dataset {band, requested, obs, pv, ctx} in one atomic step.
// Blink Playback plays S.cmp (= S.cds.obs) and its previews (S.cds.pv): it never selects, searches or loads anything itself.
const pendingBand = () => $('#sx-cband').value, pendingCount = () => Math.min(8, +$('#sx-ccount').value);
function pendingHint() {
  const b = pendingBand(), n = pendingCount(), d = S.cds;
  $('#sx-pend').textContent = !S.p ? '' : !d || d.band !== b || d.requested !== n ? `Pending: Band ${b} (D${b}), ${n} observations. Click Set Time to apply.` : '';
}
function clearApplied() {
  stopBlink(); blink.i = 0; blink.tok++; S.cds = null; S.cmp = [];
  S.cinfo = S.p ? 'No dataset applied yet. Choose a band and number of observations, then click Set Time.' : ''; $('#sx-cerr').hidden = true;
  renderCompare(); syncBlink(); pendingHint();
}
const detectorOf = img => { const m = String(img.hdr.DETECTOR ?? '').match(/\d+/); return m ? +m[0] : null; };
function setApplying(on) { S.applying = on; for (const id of ['#sx-set', '#sx-go', '#sx-cband', '#sx-ccount']) $(id).disabled = on; $('#sx-set').textContent = on ? 'Applying…' : 'Set Time'; }
async function setTime() {
  if (S.applying) return;
  const p = readForm(); if (!p) return;
  const band = pendingBand(), n = pendingCount(), bn = `Band ${band} (D${band})`, cerr = $('#sx-cerr'); cerr.hidden = true;
  setApplying(true); stopBlink(); $('#sx-selinfo').textContent = `Applying ${bn}, ${n} observations…`;
  try {
    if (!S.p || C.keyOf(S.p) !== C.keyOf(p)) { await search(false, false, true); if (!S.p || C.keyOf(S.p) !== C.keyOf(p)) throw new Error('The search failed, so the previously applied dataset was kept.'); }
    const elig = S.obs.filter(o => o.ms !== null && String(o.band) === band); // exact band only; S.obs is already limited to the From/To range and sorted by time
    const picks = C.sampleFrames(elig, elig.length ? elig[0].ms : 0, elig.length ? elig[elig.length - 1].ms + 1 : 0, band, n).picks;
    if (picks.length > n || picks.some(o => String(o.band) !== band) || new Set(picks.map(o => o.key)).size !== picks.length) throw new Error('Internal consistency check failed (band, count or duplicates); the previous dataset was kept.');
    const staged = new Map(); let bad = 0, firstErr = '', done = 0;
    const run = async o => { try { const img = await C.fetchPreview(o, p), det = detectorOf(img); if (det !== null && det !== +band) throw new Error(`Image header reports detector D${det}, not D${band}; frame rejected.`); staged.set(o.key, { img }); } catch (e) { bad++; firstErr = firstErr || e.message; staged.set(o.key, { err: e.message }); } $('#sx-selinfo').textContent = `Applying ${bn}: loaded ${++done}/${picks.length} previews…`; };
    for (let k = 0; k < picks.length; k += 4) await Promise.all(picks.slice(k, k + 4).map(run)); // staged privately; nothing visible changes until the commit below
    if (picks.length && bad === picks.length) throw new Error('No previews could be loaded for the selected observations (' + firstErr + '). The previous dataset was kept.');
    stopBlink(); blink.i = 0; blink.tok++;
    S.cds = { band, requested: n, available: elig.length, obs: picks, pv: staged, ctx: p }; S.cmp = picks;
    S.cinfo = !elig.length ? `No ${bn} observations with a timestamp were found for the current collection, coordinates, radius and dates.`
      : `Applied: ${bn} · requested ${n} · available ${elig.length} · selected ${picks.length}, oldest to newest${bad ? ` · ${bad} preview(s) unavailable` : ''}.`;
  } catch (e) { cerr.textContent = e.message; cerr.hidden = false; S.cinfo = S.cds ? `Still applied: Band ${S.cds.band} (D${S.cds.band}) · ${S.cmp.length} observation(s).` : S.cinfo; }
  finally { setApplying(false); renderAll(); syncBlink(); pendingHint(); }
}
function syncBlink() {
  const n = S.cmp.length, d = S.cds;
  $('#sx-binfo').textContent = d ? `Playing the applied Time Comparison dataset: Band ${d.band} (D${d.band}), ${n} observation(s), oldest to newest.` : '';
  $('#sx-bmsg').textContent = !S.p ? '' : !d ? 'Click Set Time in Time Comparison to enable playback.' : n < 2 ? 'Playback needs at least 2 observations. Change the band or number of observations and click Set Time, or adjust the search.' : '';
  for (const id of ['#sx-play', '#sx-bprev', '#sx-bnext']) $(id).disabled = n < 2;
  renderBlinkFrame();
}
const frames = () => (S.cds ? S.cmp.filter(o => S.cds.pv.get(o.key)?.img) : []);
function renderBlinkFrame() {
  const f = frames(), bl = $('#sx-bl'), cv = $('#sx-bc');
  if (!S.p) { bl.textContent = 'Run a search to prepare playback frames.'; cv.width = cv.height = 1; return; }
  if (S.cmp.length < 2 || f.length < 2) { bl.textContent = S.cmp.length >= 2 ? 'Fewer than 2 previews could be loaded for this dataset.' : ''; cv.width = cv.height = 1; return; }
  blink.i = ((blink.i % f.length) + f.length) % f.length; const o = f[blink.i];
  C.draw(cv, S.cds.pv.get(o.key).img, C.range(f.map(x => S.cds.pv.get(x.key).img)));
  bl.textContent = `${blink.i + 1} / ${f.length} · ${when(o)} · ${bandName(o)} · ${o.id}${o.emMin !== null ? ` · ${(o.emMin * 1e6).toFixed(2)}–${(o.emMax * 1e6).toFixed(2)} µm` : ''}${f.length < S.cmp.length ? ` · ${S.cmp.length - f.length} of ${S.cmp.length} previews unavailable` : ''}`;
}
function stopBlink() { clearInterval(blink.t); blink.t = null; $('#sx-play').textContent = 'Play'; }
function playBlink() {
  stopBlink(); if (frames().length < 2) { renderBlinkFrame(); return; }
  $('#sx-play').textContent = 'Pause'; blink.t = setInterval(() => { blink.i++; renderBlinkFrame(); }, +$('#sx-speed').value);
}
function stepBlink(d) { if (frames().length < 2) return; blink.i += d; renderBlinkFrame(); }
async function load(o) {
  const cur = S.pv.get(o.key); if (cur && (cur.img || cur.loading)) return;
  S.pv.set(o.key, { loading: true }); renderAll();
  try { S.pv.set(o.key, { img: await C.fetchPreview(o, S.p) }); } catch (e) { S.pv.set(o.key, { err: e.message }); }
  renderAll();
}
function renderAll() { renderGallery(); renderViewer(); renderCompare(); renderBlinkFrame(); }
function schedule() { clearTimeout(timer); if (document.hidden || !S.p) return; timer = setTimeout(() => search(true, true), Math.max(1000, S.updated + C.TTL - Date.now())); }
function step(d) { const v = vis(); if (!v.length) return; S.cur = v[(Math.max(0, v.findIndex(o => o.key === S.cur)) + d + v.length) % v.length].key; renderTimeline(); renderViewer(); load(byId(S.cur)); }

$('#sx-form').addEventListener('submit', e => { e.preventDefault(); search(false); });
$('#sx-wise').addEventListener('click', () => { $('#sx-ra').value = WISE.ra; $('#sx-dec').value = WISE.dec; $('#sx-rad').value = 0.05; });
$('#sx-band').addEventListener('change', e => { S.band = e.target.value; S.shown = 24; renderGallery(); renderTimeline(); });
$('#sx-more').addEventListener('click', () => { S.shown += 24; renderGallery(); });
$('#sx-gallery').addEventListener('click', e => { const a = e.target.closest('[data-act]'); if (!a) return; const o = byId(a.closest('.sx-card').dataset.id);
  if (a.dataset.act === 'load') { S.cur = o.key; renderTimeline(); load(o); } });
$('#sx-timeline').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; S.cur = b.dataset.id; renderTimeline(); renderViewer(); load(byId(S.cur)); });
$('#sx-viewer').addEventListener('click', e => { if (e.target.dataset.act === 'load') load(byId(S.cur)); });
$('#sx-prev').addEventListener('click', () => step(-1)); $('#sx-next').addEventListener('click', () => step(1));
$('#sx-play').addEventListener('click', () => (blink.t ? stopBlink() : playBlink()));
$('#sx-bprev').addEventListener('click', () => stepBlink(-1)); $('#sx-bnext').addEventListener('click', () => stepBlink(1));
$('#sx-cband').addEventListener('change', pendingHint); $('#sx-ccount').addEventListener('change', pendingHint); $('#sx-set').addEventListener('click', setTime);
$('#sx-speed').addEventListener('change', () => { if (blink.t) playBlink(); });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { clearTimeout(timer); stopBlink(); }
  else if (S.p) (Date.now() - S.updated >= C.TTL ? search(true, true) : schedule());
});

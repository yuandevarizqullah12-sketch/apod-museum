// SPHEREx data layer: IRSA SIA2 (VOTable) search, streamed FITS IMAGE-HDU reader, IndexedDB cache (10 min TTL).
export const TTL = 10 * 60 * 1000;
export const CUT = 0.1; // cutout size in degrees (IRSA cutout service `size`)
export const BANDS = [[1, 0.75, 1.09], [2, 1.10, 1.62], [3, 1.63, 2.41], [4, 2.42, 3.82], [5, 3.83, 4.41], [6, 4.42, 5.00]]; // from IRSA data-products docs

// ---- cache: IndexedDB with in-memory fallback -------------------------------------------
const mem = new Map(); let dbp;
const db = () => dbp || (dbp = new Promise((ok, no) => { try { const r = indexedDB.open('spherex-cache', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); } catch (e) { no(e); } }));
export async function cacheGet(k) {
  let v = mem.get(k);
  if (!v) try { const d = await db(); v = await new Promise((ok, no) => { const q = d.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => ok(q.result); q.onerror = () => no(q.error); }); if (v) mem.set(k, v); } catch { /* IndexedDB unavailable: memory only */ }
  return v && Date.now() - v.t < TTL ? v : null;
}
export async function cacheSet(k, data) {
  const v = { t: Date.now(), data }; mem.set(k, v);
  try { const d = await db(); await new Promise((ok, no) => { const tx = d.transaction('kv', 'readwrite'); tx.objectStore('kv').put(v, k); tx.oncomplete = ok; tx.onerror = tx.onabort = () => no(tx.error); }); } catch { /* quota/unavailable: kept in memory only */ }
  return v;
}

// ---- SIA2 search -----------------------------------------------------------------------
const mjdMs = m => (m - 40587) * 864e5;
export const dateToMjd = d => new Date(d + 'T00:00:00Z').getTime() / 864e5 + 40587;
export const keyOf = p => ['sia', p.collection, p.ra, p.dec, p.radius, p.t1 ?? '', p.t2 ?? ''].join('|');
export function parseVOTable(xml) {
  const d = new DOMParser().parseFromString(xml, 'text/xml');
  if (d.querySelector('parsererror') || !d.querySelector('VOTABLE')) throw new Error('IRSA returned a response that is not a VOTable.');
  const bad = [...d.querySelectorAll('INFO')].find(i => i.getAttribute('name') === 'QUERY_STATUS' && i.getAttribute('value') === 'ERROR');
  if (bad) throw new Error('IRSA reported an error: ' + bad.textContent.trim().slice(0, 200));
  const fields = [...d.querySelectorAll('TABLE > FIELD')].map(f => f.getAttribute('name') || f.getAttribute('ID'));
  if (!d.querySelector('TABLEDATA')) { if (d.querySelector('BINARY, BINARY2')) throw new Error('Unsupported VOTable encoding (binary).'); return []; }
  return [...d.querySelectorAll('TABLEDATA > TR')].map(tr => Object.fromEntries([...tr.children].map((td, i) => [fields[i], td.textContent.trim()])));
}
export function normalize(rows, collection) {
  const n = v => (v === undefined || v === '' || !Number.isFinite(+v) ? null : +v);
  return rows.map((r, i) => {
    const tMjd = n(r.t_min), emMin = n(r.em_min), emMax = n(r.em_max), c = emMin !== null && emMax !== null ? (emMin + emMax) / 2 * 1e6 : null; // metres -> microns
    const band = c === null ? null : (BANDS.find(b => c >= b[1] && c <= b[2]) || [])[0] || null;
    return { id: r.obs_id || r.obs_publisher_did || 'row' + i, tMjd, ms: tMjd === null ? null : mjdMs(tMjd), ra: n(r.s_ra), dec: n(r.s_dec), emMin, emMax, center: c, band,
      url: r.access_url || '', coll: r.obs_collection || collection, instr: r.instrument_name || '', raw: r };
  }).sort((a, b) => (a.ms ?? Infinity) - (b.ms ?? Infinity));
}
async function tfetch(url, ms, ctrl = new AbortController()) {
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { signal: ctrl.signal }); } catch (e) { throw new Error(ctrl.signal.aborted ? 'The request timed out.' : 'Network error: could not reach the server.'); } finally { clearTimeout(t); }
}
export async function searchSia(p, force = false) {
  const k = keyOf(p);
  if (!force) { const c = await cacheGet(k); if (c) return { obs: c.data, updated: c.t, fromCache: true }; }
  const q = new URLSearchParams({ kind: 'sia', collection: p.collection, ra: p.ra, dec: p.dec, radius: p.radius });
  if (p.t1 !== undefined) { q.set('t1', p.t1); q.set('t2', p.t2); }
  const r = await tfetch('/api/spherex?' + q, 30000);
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'IRSA search failed (HTTP ' + r.status + ').');
  const obs = normalize(parseVOTable(await r.text()), p.collection);
  const v = await cacheSet(k, obs); // only successful, fully parsed responses are cached
  return { obs, updated: v.t, fromCache: false };
}

// ---- FITS: stream the cutout MEF, stop after the IMAGE HDU ----------------------------------
export async function readFitsImage(resp, ctrl) {
  const rd = resp.body.getReader(); let buf = new Uint8Array(0), off = 0;
  const need = async n => { while (buf.length < n) { const { done, value } = await rd.read(); if (done) throw new Error('FITS data ended unexpectedly.'); const nb = new Uint8Array(buf.length + value.length); nb.set(buf); nb.set(value, buf.length); buf = nb; } };
  try {
    for (let h = 0; h < 8; h++) {
      const hdr = {}; let end = false;
      while (!end) {
        await need(off + 2880); const blk = buf.subarray(off, off + 2880); off += 2880;
        for (let i = 0; i < 36 && !end; i++) {
          const c = String.fromCharCode(...blk.subarray(i * 80, i * 80 + 80)), k = c.slice(0, 8).trim();
          if (k === 'END') end = true; else if (c[8] === '=') { const v = c.slice(10).trim(); hdr[k] = v[0] === "'" ? v.slice(1, v.indexOf("'", 1)).trim() : (Number.isNaN(+v.split('/')[0]) ? v.split('/')[0].trim() : +v.split('/')[0]); }
        }
      }
      const dims = []; for (let i = 1; i <= (hdr.NAXIS || 0); i++) dims.push(hdr['NAXIS' + i]);
      const bytes = dims.length ? Math.abs(hdr.BITPIX) / 8 * dims.reduce((a, b) => a * b, 1) + (hdr.PCOUNT || 0) : 0;
      if (hdr.EXTNAME === 'IMAGE' && dims.length === 2) {
        await need(off + bytes); const dv = new DataView(buf.buffer, buf.byteOffset + off, bytes), n = dims[0] * dims[1], px = new Float32Array(n), bp = hdr.BITPIX, sz = Math.abs(bp) / 8;
        for (let i = 0; i < n; i++) { const o = i * sz; let v = bp === -32 ? dv.getFloat32(o) : bp === -64 ? dv.getFloat64(o) : bp === 16 ? dv.getInt16(o) : bp === 32 ? dv.getInt32(o) : bp === 8 ? dv.getUint8(o) : NaN; px[i] = v * (hdr.BSCALE ?? 1) + (hdr.BZERO ?? 0); }
        const keep = {}; for (const k of ['BUNIT', 'EXTNAME', 'DETECTOR', 'DATE-OBS', 'MJD-OBS', 'MJD-AVG', 'EXPTIME', 'OBSID', 'CRPIX1A', 'CRPIX2A']) if (hdr[k] !== undefined) keep[k] = hdr[k];
        return { w: dims[0], h: dims[1], px, hdr: keep };
      }
      off += Math.ceil(bytes / 2880) * 2880;
    }
    throw new Error('No IMAGE extension found in the FITS product.');
  } finally { ctrl.abort(); rd.cancel().catch(() => {}); }
}
export async function fetchPreview(o, p) {
  if (!/^https:\/\/irsa\.ipac\.caltech\.edu\/ibe\/data\/spherex\//.test(o.url)) throw new Error('This observation has no cutout-capable access URL.');
  const k = ['cut', o.url, p.ra, p.dec, CUT].join('|'), c = await cacheGet(k);
  if (c) return c.data;
  const ctrl = new AbortController(), q = new URLSearchParams({ kind: 'cutout', url: o.url, ra: p.ra, dec: p.dec, size: CUT });
  const r = await tfetch('/api/spherex?' + q, 45000, ctrl);
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Cutout failed (HTTP ' + r.status + ').');
  const img = await readFitsImage(r, ctrl);
  await cacheSet(k, img);
  return img;
}

// ---- display scaling: linear between the 1st and 99th percentile of finite pixels --------------
export function range(imgs) {
  const v = []; for (const i of imgs) for (const x of i.px) if (Number.isFinite(x)) v.push(x);
  if (!v.length) return [0, 1]; v.sort((a, b) => a - b);
  const lo = v[Math.floor(v.length * 0.01)], hi = v[Math.min(v.length - 1, Math.floor(v.length * 0.99))];
  return [lo, hi > lo ? hi : lo + 1];
}
export function draw(canvas, img, [lo, hi]) {
  canvas.width = img.w; canvas.height = img.h; const g = canvas.getContext('2d'), d = g.createImageData(img.w, img.h);
  for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) {
    const v = img.px[(img.h - 1 - y) * img.w + x], o = (y * img.w + x) * 4, t = Number.isFinite(v) ? Math.max(0, Math.min(1, (v - lo) / (hi - lo))) * 255 : 0; // FITS row 0 is the bottom
    d.data[o] = d.data[o + 1] = d.data[o + 2] = t; d.data[o + 3] = 255;
  }
  g.putImageData(d, 0, 0);
}

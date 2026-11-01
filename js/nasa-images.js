// NASA Image and Video Library client (https://images-api.nasa.gov). Every media URL comes from an API response; nothing is guessed.
// Search metadata is cached per normalized query + media type (memory + sessionStorage, with expiry); identical in-flight requests are shared.
const BASE = 'https://images-api.nasa.gov', mem = new Map(), inflight = new Map();
const TTL_OK = 30 * 60 * 1000, TTL_EMPTY = 2 * 60 * 1000; // empty results are re-checked after 2 minutes; errors are never cached
const store = { get: k => { try { return JSON.parse(sessionStorage.getItem('fa2:' + k)); } catch { return null; } }, set: (k, v) => { try { sessionStorage.setItem('fa2:' + k, JSON.stringify(v)); } catch { /* storage full: memory only */ } } };
const norm = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
function cached(k, fn, ttlOf = () => TTL_OK) {
  const e = mem.get(k) || store.get(k);
  if (e && Date.now() - e.t < e.ttl) { mem.set(k, e); return Promise.resolve(e.v); }
  if (inflight.has(k)) return inflight.get(k);
  const p = (async () => { const v = await fn(); const ent = { t: Date.now(), ttl: ttlOf(v), v }; mem.set(k, ent); store.set(k, ent); return v; })().finally(() => inflight.delete(k));
  inflight.set(k, p); return p;
}
async function api(path) {
  const ac = new AbortController(), t = setTimeout(() => ac.abort(), 15000);
  try {
    const r = await fetch(BASE + path, { signal: ac.signal });
    if (!r.ok) throw new Error(`NASA Image Library returned HTTP ${r.status}.`);
    try { return await r.json(); } catch { throw new Error('NASA Image Library returned invalid JSON.'); }
  } catch (e) { throw ac.signal.aborted ? new Error('NASA Image Library request timed out.') : e.message.startsWith('NASA') ? e : new Error('Could not reach the NASA Image Library.'); }
  finally { clearTimeout(t); }
}
const listOf = d => { const it = d && d.collection && d.collection.items; if (!Array.isArray(it)) throw new Error('Unexpected response from the NASA Image Library.'); return it; };
const lc = s => String(s || '').toLowerCase();
const https = u => String(u).replace(/^http:/, 'https:');
// Preview rendition from the search response's own links: medium, then small, then whatever image link was returned.
function previewOf(links) {
  const imgs = (links || []).filter(l => l && typeof l.href === 'string' && (l.render === 'image' || /\.(jpe?g|png)$/i.test(l.href))).map(l => l.href);
  const h = [/~medium\./i, /~small\./i, /~large\./i, /./].map(re => imgs.find(x => re.test(x))).find(Boolean);
  return h ? https(h) : '';
}
function toItem(it) {
  const d = it && it.data && it.data[0]; if (!d || !d.nasa_id) return null;
  return { nasaId: d.nasa_id, title: d.title || '', description: String(d.description || d.description_508 || '').slice(0, 400), keywords: (Array.isArray(d.keywords) ? d.keywords : []).slice(0, 20), center: d.center || '', creator: d.photographer || d.secondary_creator || '', date: d.date_created || '', type: d.media_type || '', thumb: previewOf(it.links) };
}
const hitsTtl = v => (v.length ? TTL_OK : TTL_EMPTY);
const search = (q, type) => cached(`s:${type}:${norm(q)}`, async () => listOf(await api(`/search?q=${encodeURIComponent(norm(q))}&media_type=${type}`)).map(toItem).filter(Boolean), hitsTtl);
const byNasaId = (id, type) => cached(`i:${type}:${id}`, async () => listOf(await api(`/search?nasa_id=${encodeURIComponent(id)}`)).map(toItem).filter(h => h && h.type === type), hitsTtl);
const STOP = new Set(['the', 'and', 'lander', 'rover', 'mission', 'module', 'lunar', 'mars', 'moon', 'nasa', 'with', 'from']);
// Relevance of a search hit to one artifact record: name/shortName matter most, then mission name, then distinctive words in the title.
export function score(a, h) {
  const t = lc(h.title), k = lc(h.keywords.join(' ')), d = lc(h.description), at = (term, wt, wk, wd) => !term ? 0 : t.includes(term) ? wt : k.includes(term) ? wk : d.includes(term) ? wd : 0;
  let s = 0;
  for (const n of [a.name, a.shortName]) s = Math.max(s, at(lc(n), 5, 4, 3));
  s += at(lc(a.missionName), 2, 1, 1);
  const words = [...new Set(lc(a.name + ' ' + a.shortName).split(/[^a-z0-9]+/).filter(w => w.length > 3 && !STOP.has(w)))];
  s += Math.min(3, words.filter(w => t.includes(w)).length);
  return s;
}
export const MIN_SCORE = 5;
// Best validated hit of the requested type ('image' | 'video'), or null. preferredNasaId is tried first and must resolve to that media type.
export async function findMedia(a, type) {
  const m = a.media || {};
  if (m.preferredNasaId) { try { const hit = (await byNasaId(m.preferredNasaId, type))[0]; if (hit) return hit; } catch (e) { if (!/HTTP 4|invalid/.test(e.message)) throw e; } }
  let lastErr = null, any = false;
  for (const q of [m.searchQuery, ...(m.alternateQueries || [])].filter(Boolean)) {
    let hits; try { hits = await search(q, type); any = true; } catch (e) { lastErr = e; continue; }
    const best = hits.map(h => [score(a, h), h]).filter(x => x[0] >= MIN_SCORE).sort((x, y) => y[0] - x[0])[0];
    if (best) return best[1];
  }
  if (!any && lastErr) throw lastErr;
  return null;
}
// Asset manifests are only requested for the one artifact (or video) the visitor opens.
export const getAssets = id => cached('m:' + id, async () => {
  const hrefs = listOf(await api('/asset/' + encodeURIComponent(id))).map(x => x && x.href).filter(h => typeof h === 'string' && /^https?:\/\//.test(h)).map(https);
  if (!hrefs.length) throw new Error('The asset manifest for this item is empty or invalid.');
  return hrefs;
});
const pick = (hrefs, res) => { for (const r of res) { const h = hrefs.find(x => r.test(x)); if (h) return h; } return ''; };
export const pickImage = h => pick(h, [/~medium\.(jpe?g|png)$/i, /~large\.(jpe?g|png)$/i, /~small\.(jpe?g|png)$/i, /~orig\.(jpe?g|png)$/i, /^(?!.*~thumb).*\.(jpe?g|png)$/i]);
export const pickVideo = h => pick(h, [/~mobile\.mp4$/i, /~small\.mp4$/i, /~medium\.mp4$/i, /~large\.mp4$/i, /\.mp4$/i]);
export const pickPoster = h => pick(h, [/~medium\.(jpe?g|png)$/i, /~small\.(jpe?g|png)$/i, /~thumb\.(jpe?g|png)$/i]);
export const getCaptions = id => cached('c:' + id, async () => { try { const d = await api('/captions/' + encodeURIComponent(id)); const u = d && d.location; return typeof u === 'string' && /\.vtt$/i.test(u) ? https(u) : null; } catch { return null; } }, v => (v ? TTL_OK : TTL_EMPTY));
export const detailsUrl = id => 'https://images.nasa.gov/details/' + encodeURIComponent(id);

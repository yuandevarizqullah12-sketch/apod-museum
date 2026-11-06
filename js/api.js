// APOD data layer. Talks only to our /api/apod proxy, which forwards to NASA's WordPress
// "apod-basic" endpoint using exactly one of: date | start_date(+end_date) | count.
// All calendar dates are YYYY-MM-DD in US Eastern time (NASA's publishing day).
export const FIRST = '1995-06-16';
export const PER = 25; // NASA's documented maximum for count; also our window size
const TTL = { latest: 30 * 60e3, hist: 7 * 864e5, wiki: 7 * 864e5 };
const PREFIX = 'apod3:'; // bumped again: results cached while the proxy sent unsupported parameters (wrong rows, "no entry") must not be reused
const mem = new Map(), inflight = new Map();

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------- dates (pure UTC arithmetic: no local-timezone drift) ---------- */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ms = d => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
const fmt = t => new Date(t).toISOString().slice(0, 10);
export const isValidDate = d => typeof d === 'string' && DATE_RE.test(d) && fmt(ms(d)) === d; // rejects 2023-02-29, 2024-13-01…
export const addDays = (d, n) => fmt(ms(d) + n * 864e5);
export const diffDays = (a, b) => Math.round((ms(b) - ms(a)) / 864e5);
export const daysInMonth = (y, m) => new Date(Date.UTC(+y, +m, 0)).getUTCDate(); // m is 1-12
const NY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
export const today = () => { const p = {}; for (const x of NY.formatToParts(new Date())) p[x.type] = x.value; return `${p.year}-${p.month}-${p.day}`; };
/** @deprecated No longer used for requests; kept only so un-migrated importers do not break. Delete once nothing imports it. */
export const toLegacy = d => d.slice(2, 4) + d.slice(5, 7) + d.slice(8, 10);

/* ---------- errors, transport ---------- */
export class ApiError extends Error {
  constructor(message, status = 0, code = 'error') { super(message); this.name = 'ApiError'; this.status = status; this.code = code; }
}
const sleep = t => new Promise(r => setTimeout(r, t));
const abortErr = () => Object.assign(new Error('Aborted'), { name: 'AbortError' });
const withSignal = (p, s) => !s ? p : new Promise((res, rej) => {
  if (s.aborted) return rej(abortErr());
  const f = () => rej(abortErr());
  s.addEventListener('abort', f, { once: true });
  p.then(v => { s.removeEventListener('abort', f); res(v); }, e => { s.removeEventListener('abort', f); rej(e); });
});

async function getJSON(url, tries = 2) {
  let r;
  try { r = await fetch(url); }
  catch { if (tries > 1) { await sleep(400); return getJSON(url, tries - 1); } throw new ApiError('Network error. Check your connection and try again.', 0, 'network'); }
  if (r.status === 404) return null; // a genuine "no such entry", not a failure
  if (r.status === 429) throw new ApiError('Rate limit reached. Please try again shortly.', 429, 'rate_limited');
  if (r.status >= 500) {
    if (tries > 1) { await sleep(400); return getJSON(url, tries - 1); }
    throw new ApiError('The NASA archive is unavailable right now.', r.status, 'upstream');
  }
  if (!r.ok) {
    let m = 'The request was not valid.';
    try { m = (await r.json()).error || m; } catch {}
    throw new ApiError(m, r.status, 'bad_request');
  }
  try { return await r.json(); } catch { throw new ApiError('Received an invalid response.', 502, 'invalid_response'); }
}
// Returns the raw proxy items. [] only for a genuine 404; every real error throws.
async function apiGet(params) {
  const data = await getJSON('/api/apod?' + new URLSearchParams(params));
  if (data === null) return [];
  if (!data || !Array.isArray(data.items)) throw new ApiError('Received an invalid response.', 502, 'invalid_response');
  return data.items;
}

/* ---------- cache: memory + localStorage, de-duplicated in-flight, never caches failures ---------- */
const ls = {
  get: k => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); return true; } catch { return false; } },
  del: k => { try { localStorage.removeItem(k); } catch {} },
  keys: () => { try { return Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)); } catch { return []; } }
};
try { ls.keys().filter(k => k && (k.startsWith('apod:') || k.startsWith('apod2:'))).forEach(ls.del); } catch {} // one-off: drop entries cached by older versions
function prune() {
  const rows = ls.keys().filter(k => k && k.startsWith(PREFIX)).map(k => {
    try { return [k, JSON.parse(ls.get(k)).t || 0]; } catch { return [k, 0]; }
  }).sort((a, b) => a[1] - b[1]);
  const stale = rows.filter(r => Date.now() - r[1] > TTL.hist);
  (stale.length ? stale : rows.slice(0, 20)).forEach(r => ls.del(r[0]));
}
function readLS(key, ttl) {
  const raw = ls.get(PREFIX + key);
  if (!raw) return null;
  try { const v = JSON.parse(raw); if (v && typeof v.t === 'number' && 'd' in v && Date.now() - v.t < ttl) return v; } catch {}
  return null;
}
function writeLS(key, d) {
  const s = JSON.stringify({ t: Date.now(), d });
  if (!ls.set(PREFIX + key, s)) { prune(); ls.set(PREFIX + key, s); } // quota full: evict, retry once, then give up silently
}
function cached(key, ttl, fn) {
  const m = mem.get(key);
  if (m && Date.now() - m.t < ttl) return Promise.resolve(m.d);
  const hit = readLS(key, ttl);
  if (hit) { mem.set(key, hit); return Promise.resolve(hit.d); }
  if (inflight.has(key)) return inflight.get(key);
  const p = (async () => {
    try { const d = await fn(); mem.set(key, { t: Date.now(), d }); writeLS(key, d); return d; }
    finally { inflight.delete(key); } // a rejection propagates and is never stored
  })();
  inflight.set(key, p);
  return p;
}
const isRecent = d => d >= addDays(today(), -1);

/* ---------- normalisation ---------- */
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = s => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
  if (e[0] === '#') { try { return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)); } catch { return m; } }
  return ENT[e.toLowerCase()] ?? m;
});
const plain = html => decode(String(html ?? '')
  .replace(/<(?:br|\/p|\/div|\/li|p|div|li)\b[^>]*>/gi, ' ') // block breaks become spaces; inline tags vanish ("magnificent<a>ly" stays one word)
  .replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
const IMG_RE = /\.(?:jpe?g|png|gif|webp|avif|bmp|tiff?)(?:[?#]|$)/i;
function imageOf(r) {
  for (const raw of [r.hdurl, r.url]) { // never trust an entry to be an image: only accept URLs that look like image files
    if (typeof raw !== 'string' || !IMG_RE.test(raw)) continue;
    try {
      const u = new URL(raw);
      if (!/^https?:$/.test(u.protocol)) continue;
      u.protocol = 'https:';
      if (u.hostname === 'assets.science.nasa.gov') u.search = ''; // drop NASA's resize params (w=0&h=0…) → original asset
      return u.href;
    } catch {}
  }
  return '';
}
export function norm(r) {
  if (!r || typeof r !== 'object' || !isValidDate(r.date)) return null;
  const text = plain(r.explanation).replace(/^Explanation:\s*/i, '').replace(/\s*Tomorrow.s picture:.*$/i, '').trim();
  const who = plain(r.credit || r.copyright);
  return {
    date: r.date, title: plain(r.title) || 'Untitled', text,
    media: r.media_type || 'image',
    image: imageOf(r), // '' when there is no usable image (e.g. some videos): callers must handle it
    link: r.permalink || r.url || '',
    credit: who ? 'Image Credit & Copyright: ' + who : '',
    short: text.length > 150 ? text.slice(0, 150).replace(/\s\S*$/, '') + '…' : text,
    alt: plain(r.alt),
    mediaUrl: typeof r.media_url === 'string' && /^https?:\/\//.test(r.media_url) ? r.media_url : ''
  };
}
const merge = (...arrs) => {
  const by = new Map();
  arrs.flat().forEach(e => by.set(e.date, e));
  return [...by.values()].sort((x, y) => y.date.localeCompare(x.date));
};
const list = a => merge((Array.isArray(a) ? a : []).map(norm).filter(Boolean));

/* ---------- ranges: date windows, never page/per_page ---------- */
export function rangeWindow(from, to, page = 1, per = PER) {
  per = Math.min(Math.max(per | 0, 1), PER); page = Math.max(page | 0, 1);
  const lo = from < FIRST ? FIRST : from, hi = to > today() ? today() : to;
  if (lo > hi) return null;
  const end = addDays(hi, -(page - 1) * per);
  if (end < lo) return null;
  const start = addDays(end, -(per - 1));
  return { start: start < lo ? lo : start, end };
}
export const hasMore = (from, to, page = 1, per = PER) => !!rangeWindow(from, to, page + 1, per);

// NASA has an entry for every day, so fewer items than days hints at a truncated response: split and refetch (bounded).
async function fetchSpan(start, end, budget = { n: 8 }) {
  const expected = diffDays(start, end) + 1 - (end >= today() ? 1 : 0); // today's entry may not be published yet
  const items = list(await apiGet(start === end ? { date: start } : { start_date: start, end_date: end }));
  if (items.length >= expected || start === end || budget.n <= 0) return items;
  budget.n--;
  const mid = addDays(start, Math.floor(diffDays(start, end) / 2));
  const [a, b] = await Promise.all([fetchSpan(start, mid, budget), fetchSpan(addDays(mid, 1), end, budget)]);
  return merge(items, a, b);
}
const seed = items => items.forEach(e => { if (!mem.has('day:' + e.date)) mem.set('day:' + e.date, { t: Date.now(), d: e }); });

/** One page = one window of up to 25 days, newest first. Page 1 ends at `to` (clamped to today). */
export async function getRange(from, to, page = 1, per = PER) {
  if (!isValidDate(from) || !isValidDate(to)) throw new RangeError('Invalid date range. Use YYYY-MM-DD.');
  const w = rangeWindow(from, to, page, per);
  if (!w) return [];
  const items = await cached(`range:${w.start}:${w.end}`, isRecent(w.end) ? TTL.latest : TTL.hist, () => fetchSpan(w.start, w.end));
  seed(items);
  return items;
}
export const getPage = (page = 1, per = PER) => getRange(FIRST, today(), page, per);
export async function getLatest() { return (await getPage(1, PER))[0] || null; } // shares its cache with Archive page 1

export async function getByDate(date, opts = {}) {
  if (!isValidDate(date)) throw new RangeError('Invalid date. Use YYYY-MM-DD.');
  if (date < FIRST || date > today()) return null; // never request dates NASA cannot have
  return withSignal(cached('day:' + date, isRecent(date) ? TTL.latest : TTL.hist, async () => list(await apiGet({ date })).find(e => e.date === date) || null), opts.signal);
}

/* ---------- On This Day ---------- */
async function pool(limit, count, worker, stop) {
  let i = 0;
  const run = async () => { while (i < count && !stop()) await worker(i++); };
  await Promise.all(Array.from({ length: Math.min(limit, count) }, run));
}
const p2 = v => String(v).padStart(2, '0');
/**
 * Entries for month/day across years [from..to] (ascending). `onEach(entry)` fires incrementally, still in year order.
 * Returns the array of entries with extra props: failed [{year,error}], missing [year], skipped [{year,reason}].
 * Throws RangeError for an invalid month/day or From > To. Honors opts.signal; concurrency is bounded.
 */
export async function getOnThisDay(mm, dd, onEach, opts = {}) {
  const m = +mm, d = +dd, nowY = +today().slice(0, 4);
  if (!Number.isInteger(m) || m < 1 || m > 12 || !Number.isInteger(d) || d < 1 || d > daysInMonth(2024, m)) throw new RangeError('Invalid month or day.');
  const from = opts.from ?? 1995, to = opts.to ?? nowY, { signal, concurrency = 4 } = opts, t = today();
  if (!Number.isInteger(from) || !Number.isInteger(to)) throw new RangeError('Invalid year range.');
  if (from > to) throw new RangeError('"From year" must not be after "To year".');
  const years = [];
  for (let y = Math.max(from, 1995); y <= Math.min(to, nowY); y++) years.push(y);
  const out = [], failed = [], missing = [], skipped = [], slots = new Array(years.length).fill(undefined), todo = [];
  years.forEach((y, i) => {
    const date = `${y}-${p2(m)}-${p2(d)}`;
    if (!isValidDate(date)) { skipped.push({ year: y, reason: 'no-such-date' }); slots[i] = null; } // e.g. Feb 29 in a non-leap year
    else if (date < FIRST || date > t) { skipped.push({ year: y, reason: 'outside-archive' }); slots[i] = null; }
    else todo.push(i);
  });
  let next = 0, halt = null;
  const emit = r => { out.push(r); try { onEach && onEach(r); } catch (e) { console.error(e); } };
  const flush = () => { while (next < slots.length && slots[next] !== undefined) { const r = slots[next++]; if (r) emit(r); } };
  flush();
  await pool(concurrency, todo.length, async k => {
    const i = todo[k], y = years[i];
    try {
      const r = await getByDate(`${y}-${p2(m)}-${p2(d)}`, { signal });
      if (!r) missing.push(y);
      slots[i] = r || null;
    } catch (e) {
      if (e.name === 'AbortError') return;
      failed.push({ year: y, error: e }); slots[i] = null;
      if (e.status === 429) halt = e; // stop hammering a rate-limited API
    }
    flush();
  }, () => !!halt || !!(signal && signal.aborted));
  if (!(signal && signal.aborted)) {
    slots.forEach((s, i) => { if (s === undefined) { failed.push({ year: years[i], error: halt || new Error('Not loaded') }); slots[i] = null; } });
  }
  for (; next < slots.length; next++) if (slots[next]) emit(slots[next]);
  failed.sort((a, b) => a.year - b.year);
  return Object.assign(out, { failed, missing: missing.sort((a, b) => a - b), skipped });
}

/* ---------- random: NASA's own count parameter ---------- */
export async function getRandomBatch(n = 1) { return list(await apiGet({ count: Math.min(Math.max(n | 0, 1), PER) })); }
export async function getRandom() {
  for (let i = 0; i < 2; i++) { const r = (await getRandomBatch(1))[0]; if (r) return r; }
  return null;
}

/* ---------- collections / categories / Wikipedia (unchanged behaviour) ---------- */
let catsP;
export function getCategories() {
  return catsP || (catsP = fetch('data/categories.json').then(r => { if (!r.ok) throw new Error('categories unavailable'); return r.json(); }).catch(e => { catsP = null; throw e; }));
}
export function classify(e, c) {
  const t = (e.title + ' ' + e.text).toLowerCase();
  return c.collections.filter(x => x.keywords.some(k => t.includes(k))).map(x => x.id);
}
export async function getWiki(e) {
  const c = await getCategories(), t = e.title.toLowerCase(), b = e.text.toLowerCase();
  const hit = c.subjects.find(s => t.includes(s[0].toLowerCase())) || c.subjects.find(s => b.includes(s[0].toLowerCase()));
  if (!hit) return null;
  try {
    return await cached('wiki:' + hit[1], TTL.wiki, async () => {
      const r = await fetch('https://en.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(hit[1].replace(/ /g, '_')), { headers: { 'Api-User-Agent': 'NASA-APOD-Museum/1.0 (educational project)' } });
      if (r.status === 404) return null;           // genuinely no article: cacheable
      if (!r.ok) throw new Error('wiki ' + r.status); // transient: thrown, so never cached
      const j = await r.json();
      if (j.type !== 'standard' || !j.extract) return null;
      return { title: j.title, extract: j.extract, thumb: j.thumbnail && j.thumbnail.source, url: j.content_urls && j.content_urls.desktop.page };
    });
  } catch { return null; }
}

// Resized, WebP-converted copies via Vercel Image Optimization (configured in vercel.json).
const LOCAL = typeof location !== 'undefined' && ['localhost', '127.0.0.1'].includes(location.hostname);
export const W = [256, 640, 1080, 1920];
export const optUrl = (u, w) => `/_vercel/image?url=${encodeURIComponent(u)}&w=${w}&q=75`;
export const srcset = (u, ws = W) => (LOCAL || !/^https:\/\//.test(u) ? '' : ws.map(w => `${optUrl(u, w)} ${w}w`).join(', '));

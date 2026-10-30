export const FIRST = '1995-06-16';
const TTL = { latest: 6 * 36e5, hist: 7 * 864e5, wiki: 7 * 864e5 };
const mem = new Map();
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const today = () => new Date().toISOString().slice(0, 10);
export const toLegacy = d => d.slice(2, 4) + d.slice(5, 7) + d.slice(8, 10);

async function cached(key, ttl, fn) {
  if (mem.has(key)) return mem.get(key);
  try { const v = JSON.parse(localStorage.getItem('apod:' + key)); if (v && Date.now() - v.t < ttl) { mem.set(key, v.d); return v.d; } } catch {}
  const d = await fn();
  mem.set(key, d);
  try { localStorage.setItem('apod:' + key, JSON.stringify({ t: Date.now(), d })); } catch {}
  return d;
}
async function getJSON(url) {
  const r = await fetch(url);
  if (r.status === 404) return null;
  if (r.status === 429) throw new Error('Rate limit reached. Please try again shortly.');
  if (!r.ok) throw new Error('The NASA archive is unavailable right now.');
  try { return await r.json(); } catch { throw new Error('Received an invalid response.'); }
}
const plain = html => String(html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
export function norm(r) {
  if (!r || !r.date) return null;
  const text = plain(r.explanation);
  const credit = (plain(r.basic_html).match(/Image Credit.{0,160}?(?=Explanation|$)/i) || [''])[0].trim();
  return { date: r.date, title: plain(r.title) || 'Untitled', text, media: r.media_type || 'image',
    image: r.hdurl || '', link: r.permalink || r.url || '', credit,
    short: text.length > 150 ? text.slice(0, 150).replace(/\s\S*$/, '') + '…' : text };
}
const list = a => (Array.isArray(a) ? a.map(norm).filter(Boolean).sort((x, y) => y.date.localeCompare(x.date)) : []);

export const getPage = (page = 1, per = 25) =>
  cached(`list:${page}:${per}`, page === 1 ? TTL.latest : TTL.hist, async () => list(await getJSON(`/api/apod?page=${page}&per_page=${per}`)));
export const getRange = (from, to, page = 1) =>
  cached(`range:${from}:${to}:${page}`, TTL.hist, async () => list(await getJSON(`/api/apod?date_from=${toLegacy(from)}&date_to=${toLegacy(to)}&page=${page}&per_page=25`)));
export const getByDate = date =>
  cached('day:' + date, date === today() ? TTL.latest : TTL.hist, async () => norm(await getJSON(`/api/apod?id=${toLegacy(date)}`)));
export async function getLatest() { return (await getPage(1, 1))[0] || null; }

export async function getOnThisDay(mm, dd, onEach) {
  const out = [], now = new Date().getFullYear();
  for (let y = 1995; y <= now; y += 6) {
    const batch = [];
    for (let k = y; k < y + 6 && k <= now; k++) {
      const d = `${k}-${mm}-${dd}`;
      if (d >= FIRST && d <= today()) batch.push(getByDate(d).catch(() => null));
    }
    (await Promise.all(batch)).filter(Boolean).forEach(r => { out.push(r); onEach && onEach(r); });
  }
  return out;
}
export async function getRandom() {
  const a = new Date(FIRST).getTime(), b = Date.now();
  for (let i = 0; i < 6; i++) {
    const r = await getByDate(new Date(a + Math.random() * (b - a)).toISOString().slice(0, 10)).catch(() => null);
    if (r) return r;
  }
  return null;
}
let cats;
export async function getCategories() { return cats || (cats = await (await fetch('data/categories.json')).json()); }
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
      if (!r.ok) return null;
      const j = await r.json();
      if (j.type !== 'standard' || !j.extract) return null;
      return { title: j.title, extract: j.extract, thumb: j.thumbnail && j.thumbnail.source, url: j.content_urls && j.content_urls.desktop.page };
    });
  } catch { return null; }
}

// Vercel serverless proxy for the NASA APOD WordPress endpoint. Allow-listed params only.
const BASE = 'https://science.nasa.gov/wp-json/wp/v2/apod-basic';
const CODE = /^\d{6}$/;
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const q = req.query || {};
  const p = new URLSearchParams();
  let path = '';
  if (q.id !== undefined) {
    if (!CODE.test(q.id)) return res.status(400).json({ error: 'Invalid id' });
    path = '/' + q.id;
  } else {
    for (const k of ['date_from', 'date_to']) if (q[k] !== undefined) {
      if (!CODE.test(q[k])) return res.status(400).json({ error: 'Invalid ' + k });
      p.set(k, q[k]);
    }
    const page = parseInt(q.page || '1', 10), per = parseInt(q.per_page || '25', 10);
    if (!(page >= 1 && page <= 500) || !(per >= 1 && per <= 25)) return res.status(400).json({ error: 'Invalid paging' });
    p.set('page', page); p.set('per_page', per);
  }
  // NASA's current docs list no key requirement for this endpoint, so NASA_API_KEY is not sent.
  // If NASA starts requiring one, read process.env.NASA_API_KEY here (server side only, never log it).
  try {
    const r = await fetch(BASE + path + (p.toString() ? '?' + p : ''), { headers: { Accept: 'application/json' } });
    if (r.status === 404) return res.status(404).json({ error: 'Not found' });
    if (r.status === 429) return res.status(429).json({ error: 'Rate limited' });
    if (!r.ok) return res.status(502).json({ error: 'Upstream error' });
    const data = await r.json();
    const recent = q.id === undefined && !q.date_from;
    res.setHeader('Cache-Control', `public, s-maxage=${recent ? 21600 : 604800}, stale-while-revalidate=86400`);
    return res.status(200).json(data);
  } catch { return res.status(502).json({ error: 'Network failure' }); }
}

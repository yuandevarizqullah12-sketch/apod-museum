// Same-origin pass-through to IRSA (SIA2 search + SPHEREx cutouts). Allow-listed hosts/paths/params only; no key needed.
const HOST = 'https://irsa.ipac.caltech.edu';
const COLL = ['spherex_qr3', 'spherex_qr3_deep', 'spherex_qr2', 'spherex_qr2_deep'];
const num = (v, lo, hi) => { const n = Number(v); return v !== undefined && v !== '' && Number.isFinite(n) && n >= lo && n <= hi ? n : null; };
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const bad = m => res.status(400).json({ error: m });
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const q = req.query || {};
  const ra = num(q.ra, 0, 360), dec = num(q.dec, -90, 90);
  if (ra === null || dec === null) return bad('Invalid coordinates');
  let url, ok = 'public, s-maxage=300';
  if (q.kind === 'sia') {
    const r = num(q.radius, 1e-6, 0.5);
    if (!COLL.includes(q.collection) || r === null) return bad('Invalid collection or radius');
    const p = new URLSearchParams({ COLLECTION: q.collection, POS: `circle ${ra} ${dec} ${r}` });
    if (q.t1 !== undefined || q.t2 !== undefined) {
      const a = num(q.t1, 40000, 100000), b = num(q.t2, 40000, 100000);
      if (a === null || b === null || a > b) return bad('Invalid time range');
      p.set('TIME', `${a} ${b}`);
    }
    url = `${HOST}/SIA?${p}`;
  } else if (q.kind === 'cutout') {
    const s = num(q.size, 1e-4, 0.5), u = String(q.url || '');
    if (s === null || !/^https:\/\/irsa\.ipac\.caltech\.edu\/ibe\/data\/spherex\/[\w\/.\-]+\.fits$/.test(u)) return bad('Invalid cutout request');
    url = `${u}?center=${ra},${dec}&size=${s}`; ok = 'no-store';
  } else return bad('Invalid kind');
  const ac = new AbortController(), timer = setTimeout(() => ac.abort(), 25000);
  res.on('close', () => ac.abort()); // the browser aborts cutout streams once the IMAGE HDU has been read
  try {
    const up = await fetch(url, { signal: ac.signal });
    if (!up.ok) { clearTimeout(timer); return res.status(502).json({ error: `IRSA returned HTTP ${up.status}` }); }
    res.setHeader('Content-Type', up.headers.get('content-type') || 'application/octet-stream');
    res.setHeader('Cache-Control', ok);
    res.status(200);
    for await (const chunk of up.body) res.write(chunk);
    clearTimeout(timer); res.end();
  } catch { clearTimeout(timer); if (!res.headersSent) res.status(502).json({ error: 'IRSA unreachable or timed out' }); else res.end(); }
}

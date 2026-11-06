// Vercel serverless proxy for NASA's APOD "apod-basic" WordPress endpoint.
//
// Browser-facing contract (unchanged; js/api.js depends on it). Exactly one form per call:
//   ?date=YYYY-MM-DD
//   ?start_date=YYYY-MM-DD[&end_date=YYYY-MM-DD]   (max 31 days per call)
//   ?count=1..25                                    (random entries)
// Success: 200 { items: [...] }.  Failure: 4xx/5xx { error, code }.
//
// Upstream contract (NASA, "APOD APIs and RSS info"): apod-basic does NOT take the legacy
// planetary/apod parameters (date, start_date, end_date, count). It documents:
//   GET {BASE}/{YYMMDD}                                                one entry, by date code
//   GET {BASE}?date_from=YYMMDD&date_to=YYMMDD&page=N&per_page=1..25   a list
// WordPress ignores query arguments it does not know and answers with its default list, so
// sending legacy parameters returns the wrong entries instead of an error. This proxy therefore
// translates the browser contract into the documented parameters, and keeps only rows whose
// date really belongs to the request.
const BASE = 'https://science.nasa.gov/wp-json/wp/v2/apod-basic';
const FIRST = '1995-06-16';
const MAX_COUNT = 25;
const MAX_SPAN_DAYS = 31;
const PER_PAGE = 25;                                   // NASA's documented per_page maximum
const MAX_PAGES = Math.ceil(MAX_SPAN_DAYS / PER_PAGE); // a 31-day span needs at most 2 pages
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ALLOWED = new Set(['date', 'start_date', 'end_date', 'count']);
const UPSTREAM_TIMEOUT_MS = 9000;

// APOD "today" is the US Eastern calendar day, not the server's UTC day.
const NY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
export function todayNY(now = new Date()) {
  const p = {};
  for (const x of NY.formatToParts(now)) p[x.type] = x.value;
  return `${p.year}-${p.month}-${p.day}`;
}
const ms = d => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
const fmt = t => new Date(t).toISOString().slice(0, 10);
export const isRealDate = d => typeof d === 'string' && DATE_RE.test(d) && fmt(ms(d)) === d;
const addDays = (d, n) => fmt(ms(d) + n * 864e5);
const yymmdd = d => d.slice(2, 4) + d.slice(5, 7) + d.slice(8, 10); // NASA's date code: 1995-06-16 -> 950616
const fail = (status, code, error) => ({ ok: false, status, code, error });

function checkDate(value, name, today) {
  if (!isRealDate(value)) return fail(400, 'invalid_date', `${name} must be a real calendar date in YYYY-MM-DD format.`);
  if (value < FIRST) return fail(400, 'before_first', `${name} cannot be before ${FIRST}, the first APOD.`);
  if (value > today) return fail(400, 'future_date', `${name} cannot be in the future.`);
  return null;
}

// Pure validation, exported so it can be tested without HTTP.
export function parseQuery(q, today = todayNY()) {
  const keys = Object.keys(q || {});
  if (!keys.length) return fail(400, 'missing_params', 'Specify date, start_date (with optional end_date), or count.');
  for (const k of keys) {
    if (!ALLOWED.has(k)) return fail(400, 'unsupported_param', `Unsupported parameter: ${k}`);
    if (typeof q[k] !== 'string') return fail(400, 'duplicate_param', `Parameter ${k} may only be given once.`);
  }
  const { date, start_date: start, end_date: endRaw, count } = q;

  if (count !== undefined) {
    if (date !== undefined || start !== undefined || endRaw !== undefined) return fail(400, 'conflicting_params', 'count cannot be combined with date, start_date or end_date.');
    if (!/^\d{1,2}$/.test(count) || +count < 1 || +count > MAX_COUNT) return fail(400, 'invalid_count', `count must be an integer from 1 to ${MAX_COUNT}.`);
    return { ok: true, params: { count }, cache: 'none' };
  }
  if (date !== undefined) {
    if (start !== undefined || endRaw !== undefined) return fail(400, 'conflicting_params', 'date cannot be combined with start_date or end_date.');
    const bad = checkDate(date, 'date', today);
    return bad || { ok: true, params: { date }, cache: date >= addDays(today, -1) ? 'recent' : 'historical' };
  }
  if (start === undefined) return fail(400, 'missing_start', 'end_date requires start_date.');
  let bad = checkDate(start, 'start_date', today);
  if (bad) return bad;
  const end = endRaw === undefined ? today : endRaw;
  bad = checkDate(end, 'end_date', today);
  if (bad) return bad;
  if (start > end) return fail(400, 'invalid_range', 'start_date must not be after end_date.');
  if ((ms(end) - ms(start)) / 864e5 + 1 > MAX_SPAN_DAYS) return fail(400, 'range_too_large', `A range may span at most ${MAX_SPAN_DAYS} days per request.`);
  return { ok: true, params: { start_date: start, end_date: end }, cache: end >= addDays(today, -1) ? 'recent' : 'historical' };
}

const decodeAmp = s => s.replace(/&amp;/g, '&');
function mediaUrl(html) {
  const m = /<(?:source|iframe|embed)\b[^>]*?\bsrc=["']([^"']+)["']/i.exec(String(html || ''));
  if (!m) return '';
  const u = decodeAmp(m[1]);
  return u.startsWith('//') ? 'https:' + u : /^https?:\/\//i.test(u) ? u : '';
}
// An entry's calendar day as YYYY-MM-DD ('' when it has none). Tolerates a trailing time part.
const dateOf = r => (r && typeof r.date === 'string' && isRealDate(r.date.slice(0, 10)) ? r.date.slice(0, 10) : '');
// Small, predictable item shape (basic_html is large and only mined for the video/embed URL).
const slim = r => ({
  date: dateOf(r),
  title: r.title || '',
  explanation: r.explanation || '',
  media_type: r.media_type || 'image',
  url: r.url || '',
  hdurl: r.hdurl || '',
  permalink: r.permalink || '',
  credit: r.credit || r.copyright || '',
  copyright: r.copyright || '',
  alt: r.alt || '',
  media_url: r.media_type && r.media_type !== 'image' ? mediaUrl(r.basic_html) : ''
});

const CACHE = {
  recent: 'public, s-maxage=1800, stale-while-revalidate=3600',
  historical: 'public, s-maxage=604800, stale-while-revalidate=86400',
  none: 'no-store'
};
function send(res, status, body, cache = 'none', extra = {}) {
  res.setHeader('Cache-Control', status === 200 ? CACHE[cache] : 'no-store');
  for (const [k, v] of Object.entries(extra)) res.setHeader(k, v);
  return res.status(status).json(body);
}
const sendErr = (res, status, code, error, extra) => send(res, status, { error, code }, 'none', extra);

/* ---------- upstream (NASA apod-basic) ---------- */
class UpstreamError extends Error {
  constructor(status, code, message, extra) { super(message); this.status = status; this.code = code; this.extra = extra; }
}

// One upstream GET. Resolves to parsed JSON, or null for "no such entry" (HTTP 404). Everything else that is not a
// usable JSON answer throws an UpstreamError carrying the status/code the browser should see.
async function getUpstream(path, params = {}) {
  const qs = new URLSearchParams(params);
  // Server-side only; sent to NASA only if configured. Never logged or returned.
  if (process.env.NASA_API_KEY) qs.set('api_key', process.env.NASA_API_KEY);
  const query = qs.toString();
  let r;
  try {
    r = await fetch(BASE + path + (query ? '?' + query : ''), { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
  } catch (e) {
    const timeout = e && (e.name === 'TimeoutError' || e.name === 'AbortError');
    throw new UpstreamError(timeout ? 504 : 502, timeout ? 'upstream_timeout' : 'upstream_unreachable', timeout ? 'The NASA archive took too long to respond.' : 'Could not reach the NASA archive.');
  }
  if (r.status === 404) return null;
  if (r.status === 429) throw new UpstreamError(429, 'rate_limited', 'Rate limited by NASA.', r.headers.get('retry-after') ? { 'Retry-After': r.headers.get('retry-after') } : undefined);
  if (r.status === 400) throw new UpstreamError(400, 'upstream_rejected', 'NASA rejected the request parameters.');
  if (!r.ok) throw new UpstreamError(502, 'upstream_error', 'The NASA archive returned an error.');

  let data;
  try { data = await r.json(); } catch { throw new UpstreamError(502, 'invalid_response', 'The NASA archive returned an unreadable response.'); }

  // WordPress REST errors look like { code, message, data: { status } } — never treat them as entries.
  if (data && !Array.isArray(data) && typeof data === 'object' && data.code && !data.date) {
    const s = data.data && +data.data.status;
    if (s === 404) return null;
    throw new UpstreamError(502, 'upstream_error', 'The NASA archive returned an error.');
  }
  return data;
}
const asRows = data => (Array.isArray(data) ? data : data && typeof data === 'object' ? [data] : []);

// One day: the documented per-date route. Only an entry that really is that day is returned.
async function fetchDate(date) {
  return asRows(await getUpstream('/' + yymmdd(date))).filter(x => dateOf(x) === date);
}

// A span. First try the documented date_from/date_to list (NASA's 25-per-page maximum). Whatever that list does not
// deliver, for any reason (rejected parameters, different range semantics, a short page), is then fetched day by day
// through the per-date route, which is the one request form confirmed to work. A 404 there is a genuine gap in the archive.
async function fetchSpan(start, end) {
  const rows = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    let data;
    try { data = await getUpstream('', { date_from: yymmdd(start), date_to: yymmdd(end), page, per_page: PER_PAGE }); }
    catch (e) {
      if (e.code === 'upstream_rejected' || e.code === 'upstream_error' || e.code === 'invalid_response') break; // list unusable or past the last page: fall back below
      throw e; // rate limit / timeout / network: report, do not hammer NASA with a fallback
    }
    const list = asRows(data);
    rows.push(...list);
    if (list.length < PER_PAGE) break;
  }
  const got = new Map();
  for (const x of rows) { const d = dateOf(x); if (d >= start && d <= end) got.set(d, x); }
  const missing = [];
  for (let d = start; d <= end; d = addDays(d, 1)) if (!got.has(d)) missing.push(d);
  for (let i = 0; i < missing.length; i += 6) { // 6 at a time
    const found = await Promise.all(missing.slice(i, i + 6).map(fetchDate));
    found.flat().forEach(x => got.set(dateOf(x), x));
  }
  return [...got.values()];
}

// Random entries: apod-basic has no count parameter, so pick random archive days and look each up.
// A pick without an entry (a gap in the archive, or today's not yet published) is simply redrawn.
async function fetchRandom(count, today) {
  const lo = ms(FIRST), days = (ms(today) - lo) / 864e5 + 1, got = new Map();
  for (let round = 0; round < 3 && got.size < count; round++) {
    const picks = new Set();
    while (picks.size < count - got.size) picks.add(fmt(lo + Math.floor(Math.random() * days) * 864e5));
    const found = await Promise.all([...picks].filter(d => !got.has(d)).map(fetchDate));
    found.flat().forEach(x => got.set(dateOf(x), x));
  }
  return [...got.values()];
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return sendErr(res, 405, 'method_not_allowed', 'Method not allowed', { Allow: 'GET' });
  const v = parseQuery(req.query || {});
  if (!v.ok) return sendErr(res, v.status, v.code, v.error);

  let rows;
  try {
    if (v.params.count) rows = await fetchRandom(+v.params.count, todayNY());
    else if (v.params.date) rows = await fetchDate(v.params.date);
    else rows = await fetchSpan(v.params.start_date, v.params.end_date);
  } catch (e) {
    if (e instanceof UpstreamError) return sendErr(res, e.status, e.code, e.message, e.extra);
    return sendErr(res, 502, 'upstream_error', 'The NASA archive returned an error.');
  }

  const items = [...new Map(rows.map(slim).map(x => [x.date, x])).values()].sort((a, b) => b.date.localeCompare(a.date));
  if (!items.length && v.params.date) return sendErr(res, 404, 'not_found', 'No APOD entry exists for that date.');
  return send(res, 200, { items }, v.cache);
}

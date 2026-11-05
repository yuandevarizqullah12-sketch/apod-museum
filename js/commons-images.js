// Wikimedia Commons client (MediaWiki Action API). Fallback image source: results are returned together with a license verdict.
import { cached, fetchJson, normalize, MediaError } from './media-cache.js';

const API = 'https://commons.wikimedia.org/w/api.php';
const SOURCE_NAME = 'Wikimedia Commons';
const ALLOWED_MIME = /^image\/(jpeg|png|webp|tiff)$/;
const THUMB_HOST = 'upload.wikimedia.org';

function toPlainText(html) {
  if (!html) return '';
  return new DOMParser().parseFromString(String(html), 'text/html').body.textContent.replace(/\s+/g, ' ').trim();
}
const metaText = (meta, field) => toPlainText(meta && meta[field] && meta[field].value);

/** License policy: public domain, CC0, CC BY and CC BY-SA only; a license link is required for the CC licenses. */
export function evaluateLicense(meta) {
  const name = metaText(meta, 'LicenseShortName'), url = metaText(meta, 'LicenseUrl');
  if (!name) return { ok: false, reason: 'missing license information', name, url };
  if (/\b(nc|nd)\b|non-?commercial|no[- ]?deriv/i.test(name)) return { ok: false, reason: `license not allowed (${name})`, name, url };
  const publicDomain = /^(public domain|pd([- ]|$)|cc0)/i.test(name), creativeCommons = /^cc[- ]by(-sa)?[- ]\d/i.test(name);
  if (!publicDomain && !creativeCommons) return { ok: false, reason: `license not recognised (${name})`, name, url };
  if (creativeCommons && !/^https:\/\//.test(url)) return { ok: false, reason: 'missing license link', name, url };
  return { ok: true, name, url };
}

function toCandidate(page) {
  const info = page.imageinfo && page.imageinfo[0];
  if (!info || !info.thumburl || !info.descriptionurl || !ALLOWED_MIME.test(info.mime || '')) return null;
  try { if (new URL(info.thumburl).hostname !== THUMB_HOST) return null; } catch { return null; }
  const meta = info.extmetadata || {};
  return {
    title: page.title.replace(/^File:/, '').replace(/\.[a-z0-9]+$/i, '').replace(/_/g, ' '),
    description: metaText(meta, 'ImageDescription').slice(0, 400),
    categories: metaText(meta, 'Categories').split('|').map(category => category.trim()).filter(Boolean).slice(0, 20),
    creator: metaText(meta, 'Artist'), thumbUrl: info.thumburl, originalUrl: info.url || '', pageUrl: info.descriptionurl, license: evaluateLicense(meta)
  };
}

/** Candidates for a free-text query, in Commons' relevance order; cached per normalized query. */
export const searchCommons = query => cached('commons:search:' + normalize(query), async () => {
  const params = new URLSearchParams({ action: 'query', generator: 'search', gsrsearch: query, gsrnamespace: '6', gsrlimit: '10', prop: 'imageinfo', iiprop: 'url|extmetadata|mime', iiurlwidth: '640', format: 'json', origin: '*' });
  const data = await fetchJson(`${API}?${params}`, SOURCE_NAME);
  if (data.error) throw new MediaError('invalid', `${SOURCE_NAME} returned an error.`);
  const pages = data.query && data.query.pages ? Object.values(data.query.pages) : [];
  return pages.sort((a, b) => (a.index || 0) - (b.index || 0)).map(toCandidate).filter(Boolean);
});

/** A larger thumbnail URL for one Commons file (used only on the artifact detail page). */
export const getCommonsThumbnail = (pageUrl, width) => cached(`commons:thumb:${width}:${pageUrl}`, async () => {
  const title = decodeURIComponent(new URL(pageUrl).pathname.replace(/^\/wiki\//, ''));
  const params = new URLSearchParams({ action: 'query', titles: title, prop: 'imageinfo', iiprop: 'url', iiurlwidth: String(width), format: 'json', origin: '*' });
  const data = await fetchJson(`${API}?${params}`, SOURCE_NAME);
  const page = data.query && data.query.pages ? Object.values(data.query.pages)[0] : null;
  const url = page && page.imageinfo && page.imageinfo[0] && page.imageinfo[0].thumburl;
  return url && new URL(url).hostname === THUMB_HOST ? url : '';
});

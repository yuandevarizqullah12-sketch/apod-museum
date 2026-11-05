// NASA Image and Video Library client (https://images-api.nasa.gov). Every media URL comes from an API response; nothing is guessed.
import { cached, fetchJson, normalize, MediaError } from './media-cache.js';

const BASE = 'https://images-api.nasa.gov';
const SOURCE_NAME = 'the NASA Image and Video Library';
const api = path => fetchJson(BASE + path, SOURCE_NAME);
const toHttps = url => String(url).replace(/^http:/, 'https:');

function itemsOf(response) {
  const items = response && response.collection && response.collection.items;
  if (!Array.isArray(items)) throw new MediaError('invalid', `Unexpected response from ${SOURCE_NAME}.`);
  return items;
}
// Preview rendition taken from the search response's own links: medium, then small, then any image link returned.
function previewUrl(links) {
  const images = (links || []).filter(link => link && typeof link.href === 'string' && (link.render === 'image' || /\.(jpe?g|png)$/i.test(link.href))).map(link => link.href);
  const best = [/~medium\./i, /~small\./i, /~large\./i, /./].map(pattern => images.find(url => pattern.test(url))).find(Boolean);
  return best ? toHttps(best) : '';
}
function toHit(item) {
  const data = item && item.data && item.data[0];
  if (!data || !data.nasa_id) return null;
  return {
    nasaId: data.nasa_id, title: data.title || '', mediaType: data.media_type || '',
    description: String(data.description || data.description_508 || '').slice(0, 400),
    keywords: (Array.isArray(data.keywords) ? data.keywords : []).slice(0, 20),
    center: data.center || '', creator: data.photographer || data.secondary_creator || '', date: data.date_created || '',
    previewUrl: previewUrl(item.links)
  };
}

/** Search hits for a free-text query; cached per normalized query and media type. */
export const searchNasa = (query, mediaType) => cached(`nasa:${mediaType}:${normalize(query)}`, async () => {
  const params = new URLSearchParams({ q: normalize(query), media_type: mediaType, page_size: '30' });
  return itemsOf(await api('/search?' + params)).map(toHit).filter(Boolean);
});
/** The record for a known NASA ID (only when it is of the requested media type). */
export const findNasaId = (nasaId, mediaType) => cached(`nasa:id:${mediaType}:${nasaId}`, async () => {
  const params = new URLSearchParams({ nasa_id: nasaId });
  return itemsOf(await api('/search?' + params)).map(toHit).filter(hit => hit && hit.mediaType === mediaType);
});
/** Asset manifest URLs. Requested only for the one artifact (or video) a visitor opens. */
export const getAssetUrls = nasaId => cached('nasa:assets:' + nasaId, async () => {
  const urls = itemsOf(await api('/asset/' + encodeURIComponent(nasaId))).map(item => item && item.href).filter(href => typeof href === 'string' && /^https?:\/\//.test(href)).map(toHttps);
  if (!urls.length) throw new MediaError('invalid', 'The asset manifest for this item is empty or invalid.');
  return urls;
});
export const getCaptionUrl = nasaId => cached('nasa:captions:' + nasaId, async () => {
  try { const data = await api('/captions/' + encodeURIComponent(nasaId)); return typeof data.location === 'string' && /\.vtt$/i.test(data.location) ? toHttps(data.location) : null; }
  catch { return null; } // captions are optional
});

const firstMatch = (urls, patterns) => { for (const pattern of patterns) { const url = urls.find(candidate => pattern.test(candidate)); if (url) return url; } return ''; };
export const pickImageUrl = urls => firstMatch(urls, [/~medium\.(jpe?g|png)$/i, /~large\.(jpe?g|png)$/i, /~small\.(jpe?g|png)$/i, /~orig\.(jpe?g|png)$/i, /^(?!.*~thumb).*\.(jpe?g|png)$/i]);
export const pickVideoUrl = urls => firstMatch(urls, [/~mobile\.mp4$/i, /~small\.mp4$/i, /~medium\.mp4$/i, /~large\.mp4$/i, /\.mp4$/i]);
export const pickPosterUrl = urls => firstMatch(urls, [/~medium\.(jpe?g|png)$/i, /~small\.(jpe?g|png)$/i, /~thumb\.(jpe?g|png)$/i]);
export const nasaPageUrl = nasaId => 'https://images.nasa.gov/details/' + encodeURIComponent(nasaId);

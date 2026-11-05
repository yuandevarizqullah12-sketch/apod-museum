// Artifact dataset: loading, validation, grouping, and display adapters. data/artifacts.json is read-only source of truth.
export const DATA_URL = 'data/artifacts.json';
export const COLLECTIONS = {
  moon: { location: 'Moon', title: 'The Moon', description: "Explore the equipment and scientific instruments left behind by NASA's lunar missions.", image: 'assets/images/moon-640.webp' },
  mars: { location: 'Mars', title: 'Mars', description: 'Discover the landers, rovers, and scientific equipment that explored the Red Planet.', image: 'assets/images/mars-640.webp' }
};

export async function loadArtifacts() {
  let response;
  try { response = await fetch(DATA_URL); } catch { throw new Error('Could not load the artifact data (network error).'); }
  if (response.status === 404) throw new Error(`The artifact data file ${DATA_URL} was not found.`);
  if (!response.ok) throw new Error(`The artifact data could not be loaded (HTTP ${response.status}).`);
  let data;
  try { data = await response.json(); } catch { throw new Error(`${DATA_URL} is not valid JSON.`); }
  if (!Array.isArray(data)) throw new Error(`${DATA_URL} must be a JSON array of artifact records.`);
  const valid = data.filter(record => record && record.id && record.location);
  if (valid.length !== data.length) console.warn(`[artifact-data] ${data.length - valid.length} record(s) without id or location were skipped.`);
  return valid;
}
export const artifactsIn = (artifacts, collectionKey) => artifacts.filter(artifact => artifact.location === COLLECTIONS[collectionKey].location);
export const collectionKeyOf = artifact => Object.keys(COLLECTIONS).find(key => COLLECTIONS[key].location === artifact.location);

// ---- display adapters (the data itself is never modified)
export const asList = value => (Array.isArray(value) ? value : value == null || value === '' ? [] : [value]);
export const firstText = (object, keys) => { for (const key of keys) if (typeof object[key] === 'string' && object[key]) return object[key]; return ''; };
export const textOf = item => (typeof item === 'string' ? item : firstText(item, ['text', 'description', 'event', 'title', 'label']) || Object.values(item).filter(value => typeof value === 'string').join(' — '));
export const paragraphsOf = value => asList(value).map(textOf).flatMap(text => text.split(/\n+/)).filter(text => text.trim());
/** Display form of a status value such as "inactive_hardware" -> "Inactive hardware". */
export const formatStatus = value => { const text = String(value || '').replace(/[_-]+/g, ' ').trim(); return text.charAt(0).toUpperCase() + text.slice(1); };
export const shorten = (text, max) => { const value = String(text || ''); return value.length > max ? value.slice(0, max).replace(/\s\S*$/, '') + '…' : value; };

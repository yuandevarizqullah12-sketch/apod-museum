// Finds a verified image (NASA first, Wikimedia Commons second) or a NASA video for one artifact record.
// Relevance is judged from the record's own names and queries; the dataset itself is never modified.
import { normalize, MediaError } from './media-cache.js';
import { searchNasa, findNasaId, nasaPageUrl } from './nasa-images.js';
import { searchCommons } from './commons-images.js';

export const MIN_SCORE = 5;
const MAX_NASA_QUERIES = 6, MAX_COMMONS_QUERIES = 3;
const GENERIC_WORDS = new Set(['lunar', 'module', 'descent', 'stage', 'roving', 'vehicle', 'rover', 'lander', 'helicopter', 'mission', 'program', 'science', 'station', 'surface', 'exploration', 'technology', 'demonstration', 'moon', 'mars', 'nasa', 'with', 'from', 'that', 'this', 'image', 'photo']);
// Words that appear in many unrelated texts and therefore must not count as supporting context.
const WEAK_CONTEXT_WORDS = new Set(['with', 'from', 'that', 'this', 'program', 'mission', 'nasa', 'exploration', 'technology', 'demonstration', 'science']);
const REJECTED_COMMONS_TITLE = /\b(logo|patch|insignia|emblem|badge|stamp|coin|medal|toy|lego|cosplay|replica|miniature|poster|diagram|map|flag of)\b/i;
const NUMBERED_NAME = /\b([a-z][a-z-]+)\s(\d+[a-z]?)\b/gi;

const fold = text => ' ' + String(text ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() + ' ';
const mentions = (foldedText, term) => foldedText.includes(' ' + term + ' ');
const wordsOf = text => fold(text).trim().split(' ').filter(Boolean);

/** Distinctive identifiers of an artifact: numbered names ("apollo 11") when present, otherwise distinctive words ("spirit"). */
export function identityTerms(artifact) {
  const numbered = new Set(), prefixes = new Set();
  for (const text of [artifact.name, artifact.shortName, artifact.missionName]) {
    for (const match of String(text || '').matchAll(NUMBERED_NAME)) {
      const term = `${match[1]} ${match[2]}`.toLowerCase();
      if (!/^(mars|moon|lunar) \d/.test(term)) { numbered.add(term); prefixes.add(match[1].toLowerCase()); }
    }
  }
  if (numbered.size) return [...numbered]; // a hit must name the numbered mission, not just the program
  return [...new Set([...wordsOf(artifact.shortName), ...wordsOf(artifact.name)].filter(word => word.length >= 5 && !GENERIC_WORDS.has(word) && !prefixes.has(word)))];
}
/** Context words that make an identity match meaningful (object type, places, instruments from the record's own queries). */
export function subjectTerms(artifact, identity) {
  const known = new Set(identity.flatMap(wordsOf));
  const media = artifact.media || {};
  const source = [artifact.artifactType, artifact.name, artifact.shortName, media.searchQuery, ...(media.alternateQueries || [])].join(' ');
  return [...new Set(wordsOf(source).filter(word => word.length >= 4 && !/^\d+$/.test(word) && !known.has(word) && !WEAK_CONTEXT_WORDS.has(word)))];
}
/** 0 when the candidate does not name the artifact; otherwise identity weight (title 4, keywords 3, description 2) + up to 4 matching context words. */
export function scoreCandidate(artifact, candidate) {
  const identity = identityTerms(artifact);
  if (!identity.length) return 0;
  const title = fold(candidate.title), keywords = fold((candidate.keywords || []).join(' ')), description = fold(candidate.description);
  const weight = identity.reduce((best, term) => Math.max(best, mentions(title, term) ? 4 : mentions(keywords, term) ? 3 : mentions(description, term) ? 2 : 0), 0);
  if (!weight) return 0;
  const everything = title + keywords + description;
  return weight + Math.min(4, subjectTerms(artifact, identity).filter(term => mentions(everything, term)).length);
}

function uniqueQueries(queries, limit) {
  const seen = new Set();
  return queries.map(query => String(query || '').trim()).filter(query => query && !seen.has(normalize(query)) && seen.add(normalize(query))).slice(0, limit);
}
const nasaQueries = a => uniqueQueries([a.media?.searchQuery, ...(a.media?.alternateQueries || []), `${a.missionName} ${a.shortName}`, a.name], MAX_NASA_QUERIES);
const commonsQueries = a => uniqueQueries([a.media?.searchQuery, a.name, `${a.missionName} ${a.shortName}`], MAX_COMMONS_QUERIES);

// ---- source-specific searches. Each returns { state, media|hit } with state: ok | empty | irrelevant | license | failed
async function searchNasaForArtifact(artifact, mediaType) {
  const preferred = artifact.media?.preferredNasaId;
  if (preferred) {
    try { const hit = (await findNasaId(preferred, mediaType))[0]; if (hit) return { state: 'ok', hit }; }
    catch (error) { if (error.kind !== 'http' || error.status >= 500) console.debug('[artifact-media] preferredNasaId lookup failed', artifact.id, error.message); }
  }
  let answered = 0, hitsSeen = 0;
  for (const query of nasaQueries(artifact)) {
    let hits;
    try { hits = await searchNasa(query, mediaType); answered++; hitsSeen += hits.length; }
    catch (error) { console.debug('[artifact-media] NASA search failed', artifact.id, query, error.message); continue; }
    const best = hits.map(hit => ({ hit, score: scoreCandidate(artifact, hit) })).filter(entry => entry.score >= MIN_SCORE).sort((a, b) => b.score - a.score)[0];
    if (best) return { state: 'ok', hit: best.hit };
  }
  return { state: answered === 0 ? 'failed' : hitsSeen ? 'irrelevant' : 'empty' };
}
async function searchCommonsForArtifact(artifact) {
  let answered = 0, relevant = 0;
  for (const query of commonsQueries(artifact)) {
    let candidates;
    try { candidates = await searchCommons(query); answered++; }
    catch (error) { console.debug('[artifact-media] Commons search failed', artifact.id, query, error.message); continue; }
    const scored = candidates.filter(candidate => !REJECTED_COMMONS_TITLE.test(candidate.title))
      .map(candidate => ({ candidate, score: scoreCandidate(artifact, { title: candidate.title, keywords: candidate.categories, description: candidate.description }) })).filter(entry => entry.score >= MIN_SCORE);
    relevant += scored.length;
    for (const entry of scored.filter(item => !item.candidate.license.ok)) console.debug('[artifact-media] Commons file rejected', entry.candidate.title, entry.candidate.license.reason);
    const best = scored.filter(entry => entry.candidate.license.ok).sort((a, b) => b.score - a.score)[0];
    if (best) return { state: 'ok', candidate: best.candidate };
  }
  return { state: answered === 0 ? 'failed' : relevant ? 'license' : 'empty' };
}

// ---- consistent media object used by the UI
const nasaMedia = hit => ({ source: 'nasa', imageUrl: hit.previewUrl, originalUrl: '', sourcePageUrl: nasaPageUrl(hit.nasaId), title: hit.title, creator: hit.creator, center: hit.center, date: hit.date, licenseName: '', licenseUrl: '', nasaId: hit.nasaId, retrievedAt: Date.now() });
const commonsMedia = c => ({ source: 'wikimedia-commons', imageUrl: c.thumbUrl, originalUrl: c.originalUrl, sourcePageUrl: c.pageUrl, title: c.title, creator: c.creator, center: '', date: '', licenseName: c.license.name, licenseUrl: c.license.url, nasaId: '', retrievedAt: Date.now() });
const verifiedUrlMedia = (artifact, url) => ({ source: 'nasa', imageUrl: url, originalUrl: url, sourcePageUrl: artifact.media.preferredNasaId ? nasaPageUrl(artifact.media.preferredNasaId) : url, title: artifact.name, creator: '', center: '', date: '', licenseName: '', licenseUrl: '', nasaId: artifact.media.preferredNasaId || '', retrievedAt: Date.now() });
const isNasaHost = url => { try { const u = new URL(url); return u.protocol === 'https:' && /(^|\.)nasa\.gov$/.test(u.hostname); } catch { return false; } };

/**
 * NASA first, Commons second. Resolves to { status: 'ok' | 'none' | 'error', media?, message }.
 * `onStage(text)` reports progress ("Checking Wikimedia Commons…"). Network failures are reported as 'error' (retryable), never as 'none'.
 */
export async function resolveImage(artifact, { onStage = () => {} } = {}) {
  const verified = artifact.media?.verifiedMediaUrl;
  if (typeof verified === 'string' && isNasaHost(verified)) return { status: 'ok', media: verifiedUrlMedia(artifact, verified), message: '' };
  const nasa = await searchNasaForArtifact(artifact, 'image');
  if (nasa.state === 'ok') return { status: 'ok', media: nasaMedia(nasa.hit), message: '' };
  onStage(nasa.state === 'failed' ? 'NASA media is temporarily unavailable. Checking Wikimedia Commons…' : 'No suitable NASA image found. Checking Wikimedia Commons…');
  const commons = await searchCommonsForArtifact(artifact);
  if (commons.state === 'ok') return { status: 'ok', media: commonsMedia(commons.candidate), message: '' };
  console.debug('[artifact-media] no image for', artifact.id, { nasa: nasa.state, commons: commons.state });
  if (commons.state === 'failed' && nasa.state === 'failed') return { status: 'error', message: 'Image loading failed. Try again.' };
  if (nasa.state === 'failed') return { status: 'error', message: 'NASA media is temporarily unavailable.' };
  if (commons.state === 'failed') return { status: 'error', message: 'Image loading failed. Try again.' };
  return { status: 'none', message: 'No verified image is currently available.' };
}
/** A validated NASA video record (poster preview only); the playable file is resolved later from the asset manifest. */
export async function findVideo(artifact) {
  const result = await searchNasaForArtifact(artifact, 'video');
  if (result.state === 'failed') throw new MediaError('network', 'NASA media is temporarily unavailable.');
  return result.state === 'ok' ? result.hit : null;
}

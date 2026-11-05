// Forgotten Artifacts page: landing, collection gallery, artifact detail, and event handling.
// Data lives in artifact-data.js, media lookup in artifact-media.js (NASA first, Wikimedia Commons second).
import { esc } from './api.js';
import { $, msg } from './app.js';
import { COLLECTIONS, loadArtifacts, artifactsIn, collectionKeyOf, asList, firstText, textOf, paragraphsOf, shorten, formatStatus } from './artifact-data.js';
import { resolveImage, findVideo } from './artifact-media.js';
import { getAssetUrls, pickImageUrl, pickVideoUrl, pickPosterUrl, getCaptionUrl } from './nasa-images.js';
import { getCommonsThumbnail } from './commons-images.js';

const view = { artifacts: [], current: null, video: null };
const root = $('#fa-root');
const hero = $('#fa-head');
const params = new URLSearchParams(location.search);
const SOURCE_LABEL = { nasa: 'NASA', 'wikimedia-commons': 'Wikimedia Commons' };
const MISSING_IMAGE_HANDLER = "this.onerror=null;this.replaceWith(Object.assign(document.createElement('div'),{className:'fa-noimg',role:'img',ariaLabel:'Image not available'}))";

// ---- small rendering helpers
const link = (url, text) => (/^https?:\/\//i.test(url) ? `<a href="${esc(url)}" rel="noopener">${esc(text || url)}</a>` : esc(text || url));
const statusBadge = artifact => (artifact.status ? `<span class="fa-badge">Status: ${esc(formatStatus(artifact.status))}</span>` : '');
const paragraphs = value => paragraphsOf(value).map(text => `<p>${esc(text)}</p>`).join('');
const countLabel = count => `${count} ${count === 1 ? 'artifact' : 'artifacts'}`;
const sourceItem = item => { if (typeof item === 'string') return link(item); const url = firstText(item, ['url', 'href', 'link']); return link(url, firstText(item, ['title', 'name', 'label', 'publisher']) || url); };
const timelineItem = item => {
  if (typeof item === 'string') return `<li><span class="e" style="grid-column:1/-1">${esc(item)}</span></li>`;
  const date = firstText(item, ['date', 'year', 'time', 'when']);
  const event = [firstText(item, ['title', 'event', 'label']), firstText(item, ['description', 'text'])].filter(Boolean).join(' — ');
  return `<li><span class="d">${esc(date)}</span><span class="e">${esc(event)}</span></li>`;
};
/** Attribution line for a media object: source, title, creator, license (linked), and the original page. */
function attributionHtml(media) {
  const parts = [`<strong>${esc(SOURCE_LABEL[media.source] || media.source)}</strong>`, esc(media.title)];
  if (media.nasaId) parts.push('NASA ID ' + esc(media.nasaId));
  for (const value of [media.creator, media.center, media.date && media.date.slice(0, 10)]) if (value) parts.push(esc(value));
  if (media.licenseName) parts.push(media.licenseUrl ? link(media.licenseUrl, media.licenseName) : esc(media.licenseName));
  parts.push(link(media.sourcePageUrl, media.source === 'nasa' ? 'Original on NASA Image and Video Library' : 'File page on Wikimedia Commons'));
  return parts.join(' · ');
}

// ---- landing
function renderLanding() {
  root.innerHTML = `<div class="fa-doors">${Object.entries(COLLECTIONS).map(([key, collection]) => `<a class="fa-door" href="?collection=${key}"><img src="${collection.image}" width="640" height="640" alt="" decoding="async" onerror="${MISSING_IMAGE_HANDLER}"><div class="cap"><span class="n">${countLabel(artifactsIn(view.artifacts, key).length)}</span><h2>${esc(collection.title)}</h2><p>${esc(collection.description)}</p><span class="go">Enter the collection →</span></div></a>`).join('')}</div>`;
}

// ---- collection gallery: text renders at once; images load in the background, visible cards first, at most 3 at a time
const queue = [];
let activeJobs = 0;
function pumpQueue() {
  while (activeJobs < 3 && queue.length) { const { job } = queue.shift(); activeJobs++; job().finally(() => { activeJobs--; pumpQueue(); }); }
}
const enqueue = (job, priority) => { queue.push({ job, priority }); queue.sort((a, b) => a.priority - b.priority); pumpQueue(); };

function showLoading(frame, text, visible) {
  frame.classList.add('fa-skel');
  frame.innerHTML = visible ? `<span class="fa-note">${esc(text)}</span>` : `<span class="fa-sr">${esc(text)}</span>`;
}
function showNote(frame, text, retryId) {
  frame.classList.remove('fa-skel');
  frame.innerHTML = `<span class="fa-note">${esc(text)}</span>${retryId ? `<button type="button" class="fa-retry" data-action="retry-thumbnail" data-id="${esc(retryId)}">Retry image</button>` : ''}`;
}
function showThumbnail(frame, artifact, media) {
  const image = new Image();
  image.width = 640; image.height = 480; image.decoding = 'async'; image.loading = 'lazy';
  image.alt = `${artifact.name}: ${SOURCE_LABEL[media.source]} image “${media.title}”`;
  image.addEventListener('load', () => frame.classList.remove('fa-skel'));
  image.addEventListener('error', () => showNote(frame, 'The image could not be displayed.', artifact.id));
  image.src = media.imageUrl;
  const tag = document.createElement('span');
  tag.className = 'fa-src'; tag.textContent = SOURCE_LABEL[media.source]; tag.title = `Image source: ${SOURCE_LABEL[media.source]}`;
  frame.replaceChildren(image, tag);
}
async function loadThumbnail(artifact, frame) {
  showLoading(frame, 'Loading image', false);
  try {
    const result = await resolveImage(artifact, { onStage: text => showLoading(frame, text, true) });
    if (result.status === 'ok') showThumbnail(frame, artifact, result.media);
    else showNote(frame, result.message, result.status === 'error' ? artifact.id : '');
  } catch (error) { console.warn('[forgotten-artifacts] thumbnail failed', artifact.id, error); showNote(frame, 'Image loading failed. Try again.', artifact.id); }
}
const frameObserver = 'IntersectionObserver' in window ? new IntersectionObserver(entries => entries.forEach(entry => {
  if (entry.isIntersecting) { frameObserver.unobserve(entry.target); enqueue(entry.target.loadImage, 0); }
}), { rootMargin: '300px' }) : null;

function renderCollection(key) {
  const collection = COLLECTIONS[key], items = artifactsIn(view.artifacts, key);
  hero.hidden = true; document.title = `${collection.title} · Forgotten Artifacts · NASA APOD MUSEUM`;
  root.innerHTML = `<nav class="fa-crumbs" aria-label="Breadcrumb"><a href="forgotten-artifacts.html">← Forgotten Artifacts</a></nav>
<header class="fa-chead"><p class="eyebrow">Forgotten Artifacts</p><h1>${esc(collection.title)}</h1><p class="fa-lead">${esc(collection.description)}</p><p class="fa-count">${countLabel(items.length)}</p></header>
<div class="grid">${items.length ? items.map(artifact => `<article class="fa-card"><div class="fa-ph fa-skel" data-id="${esc(artifact.id)}"><span class="fa-sr">Loading image</span></div><p class="fa-meta">${esc([artifact.missionName, artifact.artifactType].filter(Boolean).join(' · '))}</p><h3><a href="?artifact=${encodeURIComponent(artifact.id)}">${esc(artifact.name || artifact.shortName)}</a></h3><p>${esc(shorten(artifact.description, 130))}</p>${statusBadge(artifact)}</article>`).join('') : msg('No artifacts are listed in this collection.')}</div>`;
  root.querySelectorAll('.fa-ph').forEach(frame => {
    const artifact = items.find(item => item.id === frame.dataset.id);
    frame.loadImage = () => loadThumbnail(artifact, frame);
    if (frameObserver) frameObserver.observe(frame); else enqueue(frame.loadImage, 1);
  });
}

// ---- artifact detail
async function fullSizeUrl(media) {
  if (media.source === 'wikimedia-commons') return getCommonsThumbnail(media.sourcePageUrl, 1280);
  return media.nasaId ? pickImageUrl(await getAssetUrls(media.nasaId)) : '';
}
async function renderDetailImage(artifact) {
  const frame = $('#fa-img .fa-frame'), caption = $('#fa-img figcaption');
  showLoading(frame, 'Finding an image…', true); caption.textContent = '';
  const fail = (text, retry) => { frame.classList.remove('fa-skel'); frame.innerHTML = `<span class="fa-note">${esc(text)}</span>${retry ? '<button type="button" class="fa-retry" data-action="retry-image">Retry</button>' : ''}`; };
  try {
    const result = await resolveImage(artifact, { onStage: text => showLoading(frame, text, true) });
    if (result.status !== 'ok') return fail(result.message + (result.status === 'none' ? ' The artifact information below is unaffected.' : ''), result.status === 'error');
    const media = result.media, image = new Image();
    image.alt = `${artifact.name}: ${SOURCE_LABEL[media.source]} image “${media.title}”`; image.decoding = 'async'; image.width = 1120; image.height = 630;
    image.addEventListener('load', () => frame.classList.remove('fa-skel'));
    image.addEventListener('error', () => fail('The image could not be displayed.', false));
    caption.innerHTML = attributionHtml(media);
    image.src = media.imageUrl; frame.replaceChildren(image); // instant: the preview already fetched for the gallery
    try { // then swap in a larger rendition, only for this artifact
      const larger = await fullSizeUrl(media);
      if (larger && larger !== media.imageUrl) await new Promise((done, failed) => { const probe = new Image(); probe.onload = done; probe.onerror = failed; probe.src = larger; }).then(() => { image.src = larger; });
    } catch (error) { console.debug('[forgotten-artifacts] larger rendition unavailable', error.message); caption.innerHTML = attributionHtml(media) + ' · Larger version unavailable; showing the preview.'; }
  } catch (error) { console.warn('[forgotten-artifacts] detail image failed', error); fail('Image loading failed. Try again.', true); }
}
async function renderVideoPoster(artifact) {
  try {
    const hit = await findVideo(artifact);
    if (!hit) return;
    view.video = hit;
    $('#fa-vid').innerHTML = `<h2 class="fa-h">Video</h2><figure class="fa-fig"><div class="fa-frame" id="fa-vframe">${hit.previewUrl ? `<img src="${esc(hit.previewUrl)}" alt="Preview of the NASA video “${esc(hit.title)}”" loading="lazy" decoding="async" width="640" height="360">` : ''}<button type="button" class="fa-play" data-action="load-video">Load video</button></div><figcaption>${attributionHtml({ source: 'nasa', title: hit.title, nasaId: hit.nasaId, creator: hit.creator, center: hit.center, date: hit.date, sourcePageUrl: 'https://images.nasa.gov/details/' + encodeURIComponent(hit.nasaId) })}</figcaption></figure>`;
  } catch (error) { console.debug('[forgotten-artifacts] video lookup skipped', error.message); } // video is optional
}
async function loadVideo() {
  const frame = $('#fa-vframe'), hit = view.video;
  showLoading(frame, 'Loading video…', true);
  try {
    const urls = await getAssetUrls(hit.nasaId), source = pickVideoUrl(urls);
    if (!source) throw new Error('The video record has no playable file.');
    const captions = await getCaptionUrl(hit.nasaId), poster = pickPosterUrl(urls) || hit.previewUrl, video = document.createElement('video');
    video.controls = true; video.preload = 'none'; if (poster) video.poster = poster;
    video.innerHTML = `<source src="${esc(source)}" type="video/mp4">${captions ? `<track kind="captions" src="${esc(captions)}" srclang="en" label="English">` : ''}`;
    frame.classList.remove('fa-skel'); frame.replaceChildren(video);
  } catch (error) { frame.classList.remove('fa-skel'); frame.innerHTML = `<span class="fa-note">Video unavailable: ${esc(error.message)}</span><button type="button" class="fa-retry" data-action="load-video">Retry</button>`; }
}
function factsHtml(artifact) {
  const rows = [['Mission', artifact.missionName], ['Agency', artifact.missionAgency], ['Type', artifact.artifactType], ['Location', [artifact.location, artifact.landingSite].filter(Boolean).join(' — ')], ['Launch', artifact.launchDate], ['Landing', artifact.landingDate], ['Mission end', artifact.missionEndDate], ['Last contact', artifact.lastContactDate], ['Status', [formatStatus(artifact.status), artifact.statusDescription].filter(Boolean).join(' — ')]].filter(row => row[1]);
  return rows.length ? `<dl class="fa-facts">${rows.map(row => `<dt>${esc(row[0])}</dt><dd>${esc(row[1])}</dd>`).join('')}</dl>` : '';
}
function renderDetail(artifactId) {
  const artifact = view.artifacts.find(item => String(item.id) === artifactId);
  hero.hidden = true;
  if (!artifact) { root.innerHTML = `<nav class="fa-crumbs"><a href="forgotten-artifacts.html">← Forgotten Artifacts</a></nav>${msg('This artifact was not found.', 'err')}`; return; }
  view.current = artifact; document.title = `${artifact.name || artifact.shortName} · Forgotten Artifacts · NASA APOD MUSEUM`;
  const key = collectionKeyOf(artifact), legacy = paragraphsOf(artifact.scientificLegacy), uncertainties = asList(artifact.uncertainties), timeline = asList(artifact.timeline);
  root.innerHTML = `<article class="fa-detail"><nav class="fa-crumbs" aria-label="Breadcrumb"><a href="forgotten-artifacts.html">Forgotten Artifacts</a>${key ? `<span aria-hidden="true">/</span><a href="?collection=${key}">← Back to ${esc(COLLECTIONS[key].title)}</a>` : ''}</nav>
<header class="fa-dhead"><p class="eyebrow">${esc([artifact.artifactType, artifact.location].filter(Boolean).join(' · '))}</p><h1>${esc(artifact.name || artifact.shortName)}</h1><p class="fa-sub">${esc([artifact.missionName, artifact.missionAgency].filter(Boolean).join(' · '))}</p>${statusBadge(artifact)}</header>
<figure class="fa-fig" id="fa-img"><div class="fa-frame fa-skel"></div><figcaption></figcaption></figure><div id="fa-vid"></div>
<div class="fa-cols"><aside class="fa-side" aria-label="Artifact details"><h2>At a glance</h2>${factsHtml(artifact)}</aside>
<div class="fa-main"><h2>Mission overview</h2>${paragraphs(artifact.description)}${paragraphs(artifact.missionPurpose)}
${artifact.missionStory ? `<h2>Mission story</h2>${paragraphs(artifact.missionStory)}` : ''}
${legacy.length ? `<h2>Scientific legacy</h2><blockquote class="fa-legacy">${legacy.map(text => `<p>${esc(text)}</p>`).join('')}</blockquote>` : ''}
${timeline.length ? `<h2>Mission timeline</h2><ol class="fa-tl">${timeline.map(timelineItem).join('')}</ol>` : ''}
${uncertainties.length ? `<h2>Known uncertainties</h2><ul class="fa-list">${uncertainties.map(item => `<li>${esc(textOf(item))}</li>`).join('')}</ul>` : ''}</div></div>
<section class="fa-sources"><h2>Sources and credits</h2><ul>${asList(artifact.sources).map(item => `<li>${sourceItem(item)}</li>`).join('')}<li>Images: NASA Image and Video Library first, Wikimedia Commons as a fallback; the source, creator and license are shown with each image.</li></ul></section></article>`;
  renderDetailImage(artifact); renderVideoPoster(artifact);
}

// ---- events: one delegated click handler for every retry / load action
const clickActions = {
  'retry-thumbnail': control => { const frame = control.closest('.fa-ph'), artifact = view.artifacts.find(item => String(item.id) === control.dataset.id); enqueue(() => loadThumbnail(artifact, frame), 0); },
  'retry-image': () => renderDetailImage(view.current),
  'load-video': () => loadVideo()
};
root.addEventListener('click', event => { const control = event.target.closest('[data-action]'); if (control && clickActions[control.dataset.action]) clickActions[control.dataset.action](control); });

// ---- start
try {
  view.artifacts = await loadArtifacts();
  if (params.get('artifact')) renderDetail(params.get('artifact'));
  else if (COLLECTIONS[params.get('collection')]) renderCollection(params.get('collection'));
  else renderLanding();
} catch (error) { root.innerHTML = msg(error.message, 'err'); }

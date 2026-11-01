import { esc } from './api.js';
import { $, msg } from './app.js';
import { findMedia, getAssets, pickImage, pickVideo, pickPoster, getCaptions, detailsUrl } from './nasa-images.js';

const DATA = 'data/artifacts.json';
const COL = {
  moon: { loc: 'Moon', title: 'The Moon', desc: "Explore the equipment and scientific instruments left behind by NASA's lunar missions.", img: 'assets/images/moon-640.webp' },
  mars: { loc: 'Mars', title: 'Mars', desc: 'Discover the landers, rovers, and scientific equipment that explored the Red Planet.', img: 'assets/images/mars-640.webp' }
};
let ALL = [], CUR = null;
const root = $('#fa-root'), head = $('#fa-head'), q = new URLSearchParams(location.search);
// ---- display adapters (the dataset itself is never modified)
const arr = x => (Array.isArray(x) ? x : x == null || x === '' ? [] : [x]);
const first = (o, ks) => { for (const k of ks) if (typeof o[k] === 'string' && o[k]) return o[k]; return ''; };
const plain = it => (typeof it === 'string' ? it : first(it, ['text', 'description', 'event', 'title', 'label']) || Object.values(it).filter(v => typeof v === 'string').join(' — '));
const para = x => arr(x).map(plain).flatMap(s => s.split(/\n+/)).filter(s => s.trim()).map(s => `<p>${esc(s)}</p>`).join('');
const link = (u, t) => (/^https?:\/\//i.test(u) ? `<a href="${esc(u)}" rel="noopener">${esc(t || u)}</a>` : esc(t || u));
const source = it => { if (typeof it === 'string') return /^https?:\/\//i.test(it) ? link(it) : esc(it); const u = first(it, ['url', 'href', 'link']), t = first(it, ['title', 'name', 'label', 'publisher']) || u; return link(u, t); };
const badge = a => (a.status ? `<span class="fa-badge">Status: ${esc(a.status)}</span>` : '');
const short = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n).replace(/\s\S*$/, '') + '…' : s; };
const inCol = (all, k) => all.filter(a => a.location === COL[k].loc);
const NOIMG = "this.onerror=null;this.replaceWith(Object.assign(document.createElement('div'),{className:'fa-noimg',role:'img',ariaLabel:'Image not available'}))";

async function load() {
  let r; try { r = await fetch(DATA); } catch { throw new Error('Could not load the artifact data (network error).'); }
  if (r.status === 404) throw new Error(`The artifact data file ${DATA} was not found. Add the artifact dataset at that path.`);
  if (!r.ok) throw new Error(`The artifact data could not be loaded (HTTP ${r.status}).`);
  let d; try { d = await r.json(); } catch { throw new Error(`${DATA} is not valid JSON.`); }
  if (!Array.isArray(d)) throw new Error(`${DATA} must be a JSON array of artifact records.`);
  return d.filter(a => a && a.id && a.location);
}
// ---- landing
function landing(all) {
  root.innerHTML = `<div class="fa-doors">${Object.entries(COL).map(([k, c]) => { const n = inCol(all, k).length; return `<a class="fa-door" href="?collection=${k}"><img src="${c.img}" width="640" height="640" alt="" decoding="async" onerror="${NOIMG}"><div class="cap"><span class="n">${n} ${n === 1 ? 'artifact' : 'artifacts'}</span><h2>${esc(c.title)}</h2><p>${esc(c.desc)}</p><span class="go">Enter the collection →</span></div></a>`; }).join('')}</div>`;
}
// ---- gallery thumbnails: search metadata only, visible cards first, at most 3 requests at a time
const queue = []; let active = 0;
const pump = () => { while (active < 3 && queue.length) { const { job } = queue.shift(); active++; job().finally(() => { active--; pump(); }); } };
const enqueue = (job, pri) => { queue.push({ job, pri }); queue.sort((a, b) => a.pri - b.pri); pump(); };
const note = (ph, text, retryId) => { ph.classList.remove('fa-skel'); ph.innerHTML = `<span class="fa-note">${esc(text)}</span>${retryId ? `<button type="button" class="fa-retry" data-retry="${esc(retryId)}">Retry image</button>` : ''}`; };
async function loadThumb(a, ph) {
  ph.classList.add('fa-skel'); ph.innerHTML = '<span class="fa-sr">Loading image</span>';
  try {
    const h = await findMedia(a, 'image');
    if (!h || !h.thumb) return note(ph, h ? 'No preview image available.' : 'No verified NASA image found.');
    const im = new Image(); im.width = 640; im.height = 480; im.decoding = 'async'; im.loading = 'lazy'; im.alt = `${a.name || a.shortName}: NASA image “${h.title}”`;
    im.addEventListener('load', () => ph.classList.remove('fa-skel')); im.addEventListener('error', () => note(ph, 'The NASA preview could not be displayed.'));
    im.src = h.thumb; ph.replaceChildren(im);
  } catch { note(ph, 'NASA media is unavailable right now.', a.id); }
}
const seen = 'IntersectionObserver' in window ? new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { seen.unobserve(e.target); enqueue(e.target.__load, 0); } }), { rootMargin: '300px' }) : null;
function collection(all, k) {
  const c = COL[k], items = inCol(all, k); head.hidden = true; document.title = c.title + ' · Forgotten Artifacts · NASA APOD MUSEUM';
  root.innerHTML = `<nav class="fa-crumbs" aria-label="Breadcrumb"><a href="forgotten-artifacts.html">← Forgotten Artifacts</a></nav>
<header class="fa-chead"><p class="eyebrow">Forgotten Artifacts</p><h1>${esc(c.title)}</h1><p class="fa-lead">${esc(c.desc)}</p><p class="fa-count">${items.length} ${items.length === 1 ? 'artifact' : 'artifacts'}</p></header>
<div class="grid">${items.length ? items.map(a => `<article class="fa-card"><div class="fa-ph fa-skel" data-id="${esc(a.id)}"><span class="fa-sr">Loading image</span></div><p class="fa-meta">${esc([a.missionName, a.artifactType].filter(Boolean).join(' · '))}</p><h3><a href="?artifact=${encodeURIComponent(a.id)}">${esc(a.name || a.shortName)}</a></h3><p>${esc(short(a.description, 130))}</p>${badge(a)}</article>`).join('') : msg('No artifacts are listed in this collection.')}</div>`;
  root.querySelectorAll('.fa-ph').forEach(ph => { const a = items.find(x => x.id === ph.dataset.id); ph.__load = () => loadThumb(a, ph); seen ? seen.observe(ph) : enqueue(ph.__load, 1); });
}
root.addEventListener('click', e => { const b = e.target.closest('[data-retry]'); if (b) { const ph = b.closest('.fa-ph'), a = ALL.find(x => String(x.id) === b.dataset.retry); enqueue(() => loadThumb(a, ph), 0); } });
// ---- detail
const credit = h => `${esc(h.title)} · NASA ID ${esc(h.nasaId)}${h.creator ? ' · ' + esc(h.creator) : ''}${h.center ? ' · ' + esc(h.center) : ''}${h.date ? ' · ' + esc(h.date.slice(0, 10)) : ''} · <a href="${esc(detailsUrl(h.nasaId))}" rel="noopener">Original on NASA Image and Video Library</a>`;
const preload = src => new Promise((ok, no) => { const i = new Image(); i.onload = ok; i.onerror = no; i.src = src; });
async function imageBlock(a) {
  const fr = $('#fa-img .fa-frame'), cap = $('#fa-img figcaption');
  fr.classList.add('fa-skel'); fr.innerHTML = '<span class="fa-note">Finding a NASA image…</span>'; cap.textContent = '';
  try {
    const h = await findMedia(a, 'image');
    if (!h) { fr.classList.remove('fa-skel'); fr.innerHTML = '<span class="fa-note">No verified NASA image was found for this artifact. Its information is shown below.</span>'; return; }
    const im = new Image(); im.alt = `${a.name || a.shortName}: NASA image “${h.title}”`; im.decoding = 'async'; im.width = 1120; im.height = 630;
    im.addEventListener('load', () => fr.classList.remove('fa-skel')); im.addEventListener('error', () => { fr.classList.remove('fa-skel'); fr.innerHTML = '<span class="fa-note">The NASA image could not be displayed.</span>'; });
    cap.innerHTML = credit(h);
    if (h.thumb) { im.src = h.thumb; fr.replaceChildren(im); } // instant: the preview already fetched for the gallery
    try { const src = pickImage(await getAssets(h.nasaId)); if (src && src !== h.thumb) { await preload(src); im.src = src; if (!im.isConnected) fr.replaceChildren(im); } else if (!h.thumb) throw new Error('none'); }
    catch { if (!h.thumb) { fr.classList.remove('fa-skel'); fr.innerHTML = '<span class="fa-note">The NASA media record has no usable image file.</span>'; } else cap.innerHTML = credit(h) + ' · Larger version unavailable; showing the preview.'; }
  } catch (e) { fr.classList.remove('fa-skel'); fr.innerHTML = `<span class="fa-note">${esc(e.message)}</span><button type="button" class="fa-retry" data-act="image">Retry</button>`; }
}
let vid = null;
async function videoBlock(a) {
  const box = $('#fa-vid');
  try {
    const h = await findMedia(a, 'video'); if (!h) return;
    vid = { a, h };
    box.innerHTML = `<h2 class="fa-h">Video</h2><figure class="fa-fig"><div class="fa-frame" id="fa-vframe">${h.thumb ? `<img src="${esc(h.thumb)}" alt="Preview of the NASA video “${esc(h.title)}”" loading="lazy" decoding="async" width="640" height="360">` : ''}<button type="button" class="fa-play" data-act="video">Load video</button></div><figcaption>${credit(h)}</figcaption></figure>`;
  } catch { /* video is optional; the artifact page is complete without it */ }
}
async function loadVideo() {
  const fr = $('#fa-vframe'), { h } = vid; fr.classList.add('fa-skel'); fr.innerHTML = '<span class="fa-note">Loading video…</span>';
  try {
    const hrefs = await getAssets(h.nasaId), src = pickVideo(hrefs); if (!src) throw new Error('The video record has no playable file.');
    const cap = await getCaptions(h.nasaId), poster = pickPoster(hrefs) || h.thumb, v = document.createElement('video');
    v.controls = true; v.preload = 'none'; if (poster) v.poster = poster; v.innerHTML = `<source src="${esc(src)}" type="video/mp4">${cap ? `<track kind="captions" src="${esc(cap)}" srclang="en" label="English">` : ''}`;
    fr.classList.remove('fa-skel'); fr.replaceChildren(v);
  } catch (e) { fr.classList.remove('fa-skel'); fr.innerHTML = `<span class="fa-note">Video unavailable: ${esc(e.message)}</span><button type="button" class="fa-retry" data-act="video">Retry</button>`; }
}
root.addEventListener('click', e => { const b = e.target.closest('[data-act]'); if (!b) return; if (b.dataset.act === 'video' && vid) loadVideo(); if (b.dataset.act === 'image') imageBlock(CUR); });
function facts(a) {
  const rows = [['Mission', a.missionName], ['Agency', a.missionAgency], ['Type', a.artifactType], ['Location', [a.location, a.landingSite].filter(Boolean).join(' — ')], ['Launch', a.launchDate], ['Landing', a.landingDate], ['Mission end', a.missionEndDate], ['Last contact', a.lastContactDate], ['Status', [a.status, a.statusDescription].filter(Boolean).join(' — ')]].filter(r => r[1]);
  return rows.length ? `<dl class="fa-facts">${rows.map(r => `<dt>${esc(r[0])}</dt><dd>${esc(r[1])}</dd>`).join('')}</dl>` : '';
}
const tlItem = it => { if (typeof it === 'string') return `<li><span class="e" style="grid-column:1/-1">${esc(it)}</span></li>`; const d = first(it, ['date', 'year', 'time', 'when']), e = first(it, ['event', 'title', 'description', 'label', 'text']) || Object.values(it).filter(v => typeof v === 'string' && v !== d).join(' — '); return `<li><span class="d">${esc(d)}</span><span class="e">${esc(e)}</span></li>`; };
function detail(all, id) {
  const a = all.find(x => String(x.id) === id); head.hidden = true;
  if (!a) { root.innerHTML = `<nav class="fa-crumbs"><a href="forgotten-artifacts.html">← Forgotten Artifacts</a></nav>${msg('This artifact was not found.', 'err')}`; return; }
  const k = Object.keys(COL).find(x => COL[x].loc === a.location), unc = arr(a.uncertainties), legacy = arr(a.scientificLegacy).map(plain).flatMap(s => s.split(/\n+/)).filter(s => s.trim());
  document.title = (a.name || a.shortName) + ' · Forgotten Artifacts · NASA APOD MUSEUM'; CUR = a;
  root.innerHTML = `<article class="fa-detail"><nav class="fa-crumbs" aria-label="Breadcrumb"><a href="forgotten-artifacts.html">Forgotten Artifacts</a>${k ? `<span aria-hidden="true">/</span><a href="?collection=${k}">← Back to ${esc(COL[k].title)}</a>` : ''}</nav>
<header class="fa-dhead"><p class="eyebrow">${esc([a.artifactType, a.location].filter(Boolean).join(' · '))}</p><h1>${esc(a.name || a.shortName)}</h1><p class="fa-sub">${esc([a.missionName, a.missionAgency].filter(Boolean).join(' · '))}</p>${badge(a)}</header>
<figure class="fa-fig" id="fa-img"><div class="fa-frame fa-skel"></div><figcaption></figcaption></figure><div id="fa-vid"></div>
<div class="fa-cols"><aside class="fa-side" aria-label="Artifact details"><h2>At a glance</h2>${facts(a)}</aside>
<div class="fa-main"><h2>Mission overview</h2>${para(a.description)}${para(a.missionPurpose)}
${a.missionStory ? `<h2>Mission story</h2>${para(a.missionStory)}` : ''}
${legacy.length ? `<h2>Scientific legacy</h2><blockquote class="fa-legacy">${legacy.map(s => `<p>${esc(s)}</p>`).join('')}</blockquote>` : ''}
${arr(a.timeline).length ? `<h2>Mission timeline</h2><ol class="fa-tl">${arr(a.timeline).map(tlItem).join('')}</ol>` : ''}
${unc.length ? `<h2>Known uncertainties</h2><ul class="fa-list">${unc.map(u => `<li>${esc(plain(u))}</li>`).join('')}</ul>` : ''}</div></div>
<section class="fa-sources"><h2>Sources and credits</h2><ul>${arr(a.sources).map(s => `<li>${source(s)}</li>`).join('')}<li>Images and video: NASA Image and Video Library; the credit for each item is shown with it.</li></ul></section></article>`;
  imageBlock(a); videoBlock(a);
}
try {
  const all = await load(); ALL = all;
  if (q.get('artifact')) detail(all, q.get('artifact'));
  else if (COL[q.get('collection')]) collection(all, q.get('collection'));
  else landing(all);
} catch (e) { root.innerHTML = msg(e.message, 'err'); }

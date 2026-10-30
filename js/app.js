import { esc, srcset, W } from './api.js';
export const FALLBACK = "data:image/svg+xml;utf8,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 4 3%27%3E%3Crect width=%274%27 height=%273%27 fill=%27%230b1224%27/%3E%3Ccircle cx=%272%27 cy=%271.5%27 r=%27.3%27 fill=%27none%27 stroke=%27%23334%27 stroke-width=%27.04%27/%3E%3C/svg%3E";
export const $ = s => document.querySelector(s);
const TILE = '(max-width:640px) 100vw,(max-width:900px) 50vw,360px';
const FAIL = `if(!this.dataset.r&&this.dataset.o){this.dataset.r=1;this.removeAttribute('srcset');this.src=this.dataset.o}else{this.onerror=null;this.src='${FALLBACK}'}`;
// o: {eager, sizes, ws, w, h}. Eager images get fetchpriority=high; everything else is lazy.
export const img = (e, o = {}) => {
  const u = e.image, ss = u ? srcset(u, o.ws || W.slice(0, 3)) : '';
  return `<img src="${u ? esc(u) : FALLBACK}"${ss ? ` srcset="${esc(ss)}" sizes="${o.sizes || TILE}"` : ''} data-o="${esc(u)}" alt="${esc(e.title)}" width="${o.w || 640}" height="${o.h || 480}" ${o.eager ? 'fetchpriority="high" decoding="async"' : 'loading="lazy" decoding="async"'} onerror="${FAIL.replace(/"/g, '&quot;')}">`;
};
export const tile = e => `<a class="tile" href="detail.html?date=${e.date}"><div class="ph">${img(e)}${e.media !== 'image' ? '<span class="tag">' + esc(e.media) + '</span>' : ''}</div><time>${e.date}</time><h3>${esc(e.title)}</h3><p>${esc(e.short)}</p></a>`;
export const msg = (t, cls = '') => `<p class="state ${cls}" role="status">${esc(t)}</p>`;
const nav = $('#nav'), btn = $('#menu');
if (btn) btn.addEventListener('click', () => { btn.setAttribute('aria-expanded', nav.classList.toggle('open')); });
const here = location.pathname.split('/').pop() || 'index.html';
document.querySelectorAll('#nav a').forEach(a => { const h = a.getAttribute('href'); if (h === here || (here === 'detail.html' && h === 'archive.html')) a.setAttribute('aria-current', 'page'); });

import { getLatest, esc } from './api.js';
import { $, img, msg } from './app.js';
const box = $('#feature');
// Validate the hero <img> that is actually on the page (whichever srcset candidate the browser picked).
const hero = $('.hero-bg img'), credit = $('#heroCredit');
const heroFailed = () => { credit.classList.add('warn'); credit.textContent = `Hero photo failed to load (${hero.currentSrc || hero.src}). Check that assets/images/hero-640.webp, hero-1280.webp and hero-1920.webp exist.`; };
if (hero.complete && hero.naturalWidth === 0) heroFailed(); else hero.addEventListener('error', heroFailed, { once: true });
try {
  const e = await getLatest();
  if (!e) throw new Error('No entry available.');
  box.innerHTML = `<figure><a href="detail.html?date=${e.date}">${img(e, { sizes: '(max-width:1200px) 100vw,1120px', ws: [640, 1080, 1920], w: 1120, h: 630 })}</a></figure><div class="meta"><div><time class="eyebrow">${e.date}</time><h2>${esc(e.title)}</h2><a class="btn" style="margin-top:24px" href="detail.html?date=${e.date}">Explore</a></div><p>${esc(e.text)}</p></div>`;
} catch (err) { box.innerHTML = msg(err.message, 'err'); }

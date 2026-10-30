import { getLatest, esc } from './api.js';
import { $, img, msg } from './app.js';
const box = $('#feature');
try {
  const e = await getLatest();
  if (!e) throw new Error('No entry available.');
  box.innerHTML = `<figure><a href="detail.html?date=${e.date}">${img(e, { sizes: '(max-width:1200px) 100vw,1120px', ws: [640, 1080, 1920], w: 1120, h: 630 })}</a></figure><div class="meta"><div><time class="eyebrow">${e.date}</time><h2>${esc(e.title)}</h2><a class="btn" style="margin-top:24px" href="detail.html?date=${e.date}">Explore</a></div><p>${esc(e.text)}</p></div>`;
} catch (err) { box.innerHTML = msg(err.message, 'err'); }

const probe = new Image();
probe.onerror = () => { const c = $('#heroCredit'); c.classList.add('warn'); c.textContent = 'Hero photo missing: run "node scripts/get-hero.mjs" to download assets/images/hero-space.jpg.'; };
probe.src = 'assets/images/hero-space.jpg';

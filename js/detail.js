import { getByDate, getWiki, esc, FIRST, today } from './api.js';
import { $, img, msg } from './app.js';
const box = $('#detail'), date = new URLSearchParams(location.search).get('date') || '';
(async () => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < FIRST || date > today()) return void (box.innerHTML = msg('Invalid or out-of-range date.', 'err'));
  try {
    const e = await getByDate(date);
    if (!e) return void (box.innerHTML = msg('No APOD was found for this date.'));
    document.title = e.title + ' · NASA APOD MUSEUM';
    const media = e.media === 'image' && e.image ? img(e, false) : e.media !== 'image' && /^https:\/\//.test(e.image) ? '' : img(e, false);
    box.innerHTML = `<div class="media">${media}</div>${e.media !== 'image' ? `<p class="state">This entry is ${esc(e.media)} media. <a href="${esc(e.link)}" rel="noopener">Watch it on the original NASA page</a>.</p>` : ''}
<article class="body"><time>${e.date}</time><h1>${esc(e.title)}</h1><p>${esc(e.text)}</p><div id="wiki"></div>
<div class="credits"><p>${e.credit ? esc(e.credit) + '<br>' : 'Credit: see the original NASA page for image credit and copyright.<br>'}<a href="${esc(e.link)}" rel="noopener">Original NASA source</a></p></div></article>`;
    const w = await getWiki(e);
    if (w) $('#wiki').innerHTML = `<section class="wiki${w.thumb ? '' : ' nothumb'}">${w.thumb ? `<img src="${esc(w.thumb)}" alt="${esc(w.title)}" loading="lazy">` : ''}<div><h2>LEARN MORE ABOUT THIS OBJECT</h2><h3>${esc(w.title)}</h3><p>${esc(w.extract)}</p><small>Source: <a href="${esc(w.url)}" rel="noopener">Wikipedia</a> (CC BY-SA)</small></div></section>`;
  } catch (err) { box.innerHTML = msg(err.message, 'err'); }
})();

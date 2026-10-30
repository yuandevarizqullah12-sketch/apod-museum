import { getPage, getCategories, classify, esc } from './api.js';
import { $, tile, msg } from './app.js';
const box = $('#colls');
try {
  const [c, ...pages] = await Promise.all([getCategories(), ...[1, 2, 3, 4].map(p => getPage(p, 25).catch(() => []))]);
  const all = pages.flat();
  if (!all.length) throw new Error('Could not load entries for collections.');
  const tagged = all.map(e => [e, classify(e, c)]);
  box.innerHTML = c.collections.map(k => {
    const items = tagged.filter(t => t[1].includes(k.id)).map(t => t[0]).slice(0, 6);
    return `<section class="coll"><div class="head"><h2>${esc(k.title)}</h2></div><p>${esc(k.intro)}</p><div class="grid">${items.length ? items.map(tile).join('') : msg('No matching entries in the recent archive yet.')}</div></section>`;
  }).join('');
} catch (e) { box.innerHTML = msg(e.message, 'err'); }

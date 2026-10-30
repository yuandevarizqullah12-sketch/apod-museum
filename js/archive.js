import { getPage, getRange, FIRST, today } from './api.js';
import { $, tile, msg } from './app.js';
const grid = $('#grid'), more = $('#more'), now = new Date();
const M = ['January','February','March','April','May','June','July','August','September','October','November','December'];
$('#year').innerHTML = '<option value="">Year</option>' + Array.from({ length: now.getFullYear() - 1994 }, (_, i) => `<option>${now.getFullYear() - i}</option>`).join('');
$('#month').innerHTML = M.map((m, i) => `<option value="${String(i + 1).padStart(2, '0')}">${m}</option>`).join('');
$('#date').max = today();
let mode = { type: 'latest' }, page = 1;
async function load(reset) {
  if (reset) { page = 1; grid.innerHTML = msg('Loading…'); }
  more.hidden = true;
  try {
    let items;
    if (mode.type === 'latest') items = await getPage(page, 25);
    else { const last = new Date(mode.y, +mode.m, 0).getDate(); items = await getRange(`${mode.y}-${mode.m}-01`, `${mode.y}-${mode.m}-${last}`, page); }
    if (reset) grid.innerHTML = '';
    if (!items.length && reset) grid.innerHTML = msg('No entries found for this selection.');
    grid.insertAdjacentHTML('beforeend', items.map(tile).join(''));
    more.hidden = items.length < 25;
  } catch (e) { grid.innerHTML = msg(e.message, 'err'); }
}
$('#more').onclick = () => { page++; load(false); };
$('#latest').onclick = () => { mode = { type: 'latest' }; load(true); };
$('#go').onclick = () => {
  const d = $('#date').value;
  if (d) { if (d < FIRST || d > today()) return void (grid.innerHTML = msg('Pick a date from June 16, 1995 to today.', 'err')); location.href = 'detail.html?date=' + d; return; }
  const y = $('#year').value; if (!y) return void (grid.innerHTML = msg('Choose a year and month, or a date.', 'err'));
  mode = { type: 'month', y, m: $('#month').value }; load(true);
};
load(true);

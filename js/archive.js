import { getRange, hasMore, isValidDate, daysInMonth, FIRST, today } from './api.js';
import { $, tile, msg } from './app.js';
const grid = $('#grid'), more = $('#more');
const M = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const p2 = v => String(v).padStart(2, '0');
const thisYear = +today().slice(0, 4);

$('#year').innerHTML = '<option value="">Year</option>' + Array.from({ length: thisYear - 1994 }, (_, i) => `<option>${thisYear - i}</option>`).join('');
$('#month').innerHTML = '<option value="">Whole year</option>' + M.map((m, i) => `<option value="${p2(i + 1)}">${m}</option>`).join('');
$('#month').value = '01'; // same default as before (January)
$('#date').min = FIRST;
$('#date').max = today();

// Archive state: which date span is browsed, which 25-day window is next, and which request is current.
let span = { from: FIRST, to: today() }, page = 1, runId = 0, busy = false;
const errBox = text => `<div data-err style="grid-column:1/-1">${msg(text, 'err')}</div>`;

async function load(reset) {
  if (busy && !reset) return;          // ignore repeated Load More clicks while a page is loading
  const run = ++runId;                 // a newer Go/Latest click makes any older response stale
  busy = true;
  more.disabled = true;
  grid.querySelectorAll('[data-err]').forEach(n => n.remove());
  if (reset) { page = 1; more.hidden = true; grid.innerHTML = msg('Loading…'); }
  try {
    const items = await getRange(span.from, span.to, page);
    if (run !== runId) return;
    if (reset) grid.innerHTML = '';
    if (!items.length && reset) grid.innerHTML = msg('No entries found for this selection.');
    grid.insertAdjacentHTML('beforeend', items.map(tile).join(''));
    more.hidden = !hasMore(span.from, span.to, page);
  } catch (e) {
    if (run !== runId) return;
    if (reset) { grid.innerHTML = msg(e.message, 'err'); more.hidden = true; }
    else { page--; grid.insertAdjacentHTML('beforeend', errBox(e.message)); more.hidden = false; } // keep loaded tiles; Load More retries the same window
  } finally {
    if (run === runId) { busy = false; more.disabled = false; }
  }
}

const showError = text => { runId++; busy = false; more.hidden = true; grid.innerHTML = msg(text, 'err'); };

$('#more').onclick = () => { page++; load(false); };
$('#latest').onclick = () => { span = { from: FIRST, to: today() }; load(true); };
// Picking a year/month means "browse that period", so a leftover single date must not override it.
$('#year').onchange = $('#month').onchange = () => { $('#date').value = ''; };
// "Browse" is a submit button inside <form id="controls">. Without preventDefault the browser reloads the page after
// this handler runs, which discards the chosen year/month and cancels the jump to detail.html for a single date.
function browse() {
  const d = $('#date').value;
  if (d) {
    if (!isValidDate(d) || d < FIRST || d > today()) return showError('Pick a date from June 16, 1995 to today.');
    location.href = 'detail.html?date=' + d;
    return;
  }
  const y = $('#year').value;
  if (!y) return showError('Choose a year (and optionally a month), or a date.');
  const m = $('#month').value;           // '' = whole year
  const from = `${y}-${m || '01'}-01`;
  const to = m ? `${y}-${m}-${p2(daysInMonth(y, +m))}` : `${y}-12-31`;
  if (to < FIRST || from > today()) return showError('There are no entries for that period yet.');
  span = { from, to };                   // getRange clamps to June 16, 1995 … today
  load(true);
}
const form = $('#go').form;
if (form) {
  form.noValidate = true;                // our own range messages replace the browser's date-input tooltip
  form.addEventListener('submit', ev => { ev.preventDefault(); browse(); }); // also covers Enter in the date field
} else $('#go').onclick = browse;
load(true);

import { getOnThisDay, getRandom, daysInMonth, today, FIRST } from './api.js';
import { $, tile, msg } from './app.js';
const grid = $('#grid'), n = new Date();
const M = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const p2 = v => String(v).padStart(2, '0');
const nowYear = +today().slice(0, 4), firstYear = +FIRST.slice(0, 4);

$('#month').innerHTML = M.map((m, i) => `<option value="${i + 1}">${m}</option>`).join('');
const days = () => {                      // 2024 is a leap year, so February offers 29 days
  const keep = $('#day').value;
  $('#day').innerHTML = Array.from({ length: daysInMonth(2024, +$('#month').value) }, (_, i) => `<option>${i + 1}</option>`).join('');
  if (keep && +keep <= $('#day').options.length) $('#day').value = keep;
};
$('#month').value = n.getMonth() + 1; days(); $('#day').value = n.getDate();
$('#month').onchange = days;

// Year-range controls. If on-this-day.html already contains #from-year / #to-year they are used as-is; otherwise they are added next to the button.
function yearSelect(id, label, selected) {
  let el = document.getElementById(id);
  if (!el) {
    const wrap = document.createElement('label');
    wrap.htmlFor = id;
    wrap.textContent = label + ' ';
    el = document.createElement('select');
    el.id = id;
    wrap.appendChild(el);
    $('#show').before(wrap);
  }
  const ys = Array.from({ length: nowYear - firstYear + 1 }, (_, i) => firstYear + i);
  el.innerHTML = ys.map(y => `<option>${y}</option>`).join('');
  el.value = selected;
  return el;
}
const fromEl = yearSelect('from-year', 'From year', firstYear);
const toEl = yearSelect('to-year', 'To year', nowYear);

let note = document.getElementById('otd-note');
if (!note) { note = document.createElement('div'); note.id = 'otd-note'; note.setAttribute('role', 'status'); grid.after(note); }
const setNote = html => { note.innerHTML = html; };

let runId = 0, ctrl = null;
function stopCurrent() { runId++; if (ctrl) ctrl.abort(); ctrl = null; return runId; }

async function show() {
  const run = stopCurrent();
  setNote('');
  const from = +fromEl.value, to = +toEl.value;
  if (from > to) { grid.innerHTML = msg('"From year" must not be after "To year".', 'err'); return; }
  ctrl = new AbortController();
  grid.innerHTML = msg('Searching the archive…');
  let first = true;
  try {
    const r = await getOnThisDay(p2($('#month').value), p2($('#day').value), e => {
      if (run !== runId) return;
      if (first) { grid.innerHTML = ''; first = false; }
      grid.insertAdjacentHTML('beforeend', `<div>${tile(e)}</div>`);
    }, { from, to, signal: ctrl.signal });
    if (run !== runId) return;           // a newer search replaced this one
    const bits = [];
    const noDate = r.skipped.filter(s => s.reason === 'no-such-date').length;
    if (noDate) bits.push(`February 29 exists only in leap years, so ${noDate} year${noDate > 1 ? 's were' : ' was'} skipped.`);
    if (r.failed.length) {
      const yrs = r.failed.map(f => f.year).join(', ');
      bits.push(`${r.failed.length} year${r.failed.length > 1 ? 's' : ''} could not be loaded (${yrs}): ${r.failed[0].error.message} Press “Show” to retry.`);
    }
    if (!r.length) {
      grid.innerHTML = r.failed.length ? msg(r.failed[0].error.message, 'err') : msg('No entries found for this date.');
    }
    if (bits.length) setNote(msg(bits.join(' '), r.failed.length ? 'err' : ''));
  } catch (e) {
    if (run !== runId) return;
    grid.innerHTML = msg(e.message, 'err');
  }
}
// "Show entries" is a submit button inside <form id="controls">. Without preventDefault the browser reloads the
// page on every click, which throws the chosen month/day/years away and re-runs show() with the defaults.
const form = $('#show').form;
if (form) form.addEventListener('submit', ev => { ev.preventDefault(); show(); }); // also covers Enter in a select
else $('#show').onclick = show;
$('#rand').onclick = async () => {
  const run = stopCurrent();
  setNote('');
  grid.innerHTML = msg('Choosing a random entry…');
  try {
    const e = await getRandom();
    if (run !== runId) return;
    grid.innerHTML = e ? tile(e) : msg('Could not find a random entry. Try again.', 'err');
  } catch (e) {
    if (run === runId) grid.innerHTML = msg(e.message, 'err');
  }
};
show();

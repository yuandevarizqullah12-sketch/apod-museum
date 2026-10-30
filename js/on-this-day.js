import { getOnThisDay, getRandom } from './api.js';
import { $, tile, msg } from './app.js';
const grid = $('#grid'), n = new Date();
const M = ['January','February','March','April','May','June','July','August','September','October','November','December'];
$('#month').innerHTML = M.map((m, i) => `<option value="${i + 1}">${m}</option>`).join('');
const days = () => { const m = +$('#month').value; $('#day').innerHTML = Array.from({ length: new Date(2024, m, 0).getDate() }, (_, i) => `<option>${i + 1}</option>`).join(''); };
$('#month').value = n.getMonth() + 1; days(); $('#day').value = n.getDate();
$('#month').onchange = days;
const p2 = v => String(v).padStart(2, '0');
async function show() {
  grid.innerHTML = msg('Searching the archive…');
  let first = true;
  try {
    const r = await getOnThisDay(p2($('#month').value), p2($('#day').value), e => { if (first) { grid.innerHTML = ''; first = false; } grid.insertAdjacentHTML('beforeend', `<div>${tile(e)}</div>`); });
    if (!r.length) grid.innerHTML = msg('No entries found for this date.');
  } catch (e) { grid.innerHTML = msg(e.message, 'err'); }
}
$('#show').onclick = show;
$('#rand').onclick = async () => {
  grid.innerHTML = msg('Choosing a random entry…');
  const e = await getRandom();
  grid.innerHTML = e ? tile(e) : msg('Could not find a random entry. Try again.', 'err');
};
show();

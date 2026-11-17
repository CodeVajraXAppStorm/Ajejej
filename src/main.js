import './style.css';
const logoUrl = Object.values(import.meta.glob('../assets/icon.png', { eager: true, query: '?url', import: 'default' }))[0] || '';
import { recents, esc, recentFile, shareRecent, setPending, toast } from './util.js';

const I = (p) => `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="${p}"/></svg>`;

// [colour, icon path, label, loader]
const tools = {
  pdf: ['#d13438', 'M7 3h7l5 5v13H7z M14 3v5h5', 'PDF Editor', () => import('./modules/pdf.js')],
  fill: ['#c239b3', 'M4 4h16v16H4z M8 9h8M8 13h8M8 17h4', 'Fill Form', () => import('./modules/pdf.js').then((m) => ({ default: (r) => m.default(r, { fill: true }) }))],
  sign: ['#8764b8', 'M4 20l4-1 11-11-3-3L5 16z', 'Signature', () => import('./modules/signature.js')],
  scan: ['#038387', 'M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4M4 12h16', 'Scanner', () => import('./modules/scanner.js')],
  idcard: ['#4f6bed', 'M3 6h18v12H3z M7 11h4M7 14h6M15 10h3v3h-3z', 'ID Card', () => import('./modules/idcard.js')],
  compress: ['#00b294', 'M12 4v6M9 7l3 3 3-3M12 20v-6M9 17l3-3 3 3M5 12h14', 'Compress PDF', () => import('./modules/compress.js')],
  excel: ['#107c41', 'M4 4h16v16H4z M4 10h16M4 15h16M10 4v16', 'Excel', () => import('./modules/excel.js')],
  word: ['#2b579a', 'M5 6h14M5 11h14M5 16h9', 'Word', () => import('./modules/word.js')],
  zip: ['#ca5010', 'M5 4h14v16H5z M12 4v8 M10 8h4', 'ZIP', () => import('./modules/zip.js')],
  img: ['#0078d4', 'M4 5h16v14H4z M4 16l5-5 4 4 3-3 4 4', 'Image Tools', () => import('./modules/imagetools.js')],
  ocr: ['#986f0b', 'M4 8V4h4M16 4h4v4M8 12h8M8 15h5', 'OCR', () => import('./modules/ocr.js')],
  conv: ['#5c2e91', 'M4 9h13l-3-3M20 15H7l3 3', 'Convert', () => import('./modules/convert.js')]
};

const view = document.getElementById('view');
const title = document.getElementById('title');
const back = document.getElementById('back');
back.onclick = () => history.back();

const openRecent = async (r) => {
  try {
    const t = { pdf: 'pdf', docx: 'word', xlsx: 'excel' }[r.name.split('.').pop().toLowerCase()];
    if (t) { setPending(await recentFile(r)); location.hash = t; }
    else await shareRecent(r);
  } catch { toast('File not found. It may have been moved or deleted.', 3500); }
};

function home() {
  title.textContent = 'AllInOne Docs';
  back.style.display = 'none';
  const rc = recents().slice(0, 6);
  view.innerHTML =
    (logoUrl
      ? '<div style="text-align:center;margin:4px 0 22px"><img src="' + logoUrl + '" alt="" style="width:96px;height:96px;border-radius:22px;object-fit:cover;box-shadow:0 6px 20px #0008"><div style="font-size:20px;font-weight:600;margin-top:10px">AllInOne Docs</div></div>'
      : '') +
    '<div class="sec">Tools</div><div class="grid">' +
    Object.entries(tools).map(([k, v]) => `<a class="tile" href="#${k}"><span class="ico" style="background:${v[0]}">${I(v[1])}</span>${v[2]}</a>`).join('') +
    '</div>' +
    (rc.length
      ? '<h3>Recent</h3>' + rc.map((r, i) => `<div class="card rec" data-i="${i}"><span>${esc(r.name)}</span><span class="muted">${new Date(r.ts).toLocaleDateString()}</span></div>`).join('')
      : '') +
    '<p class="muted" style="text-align:center;margin-top:28px">Your files never leave your device</p>';
  view.querySelectorAll('.rec').forEach((el) => { el.onclick = () => openRecent(rc[+el.dataset.i]); });
}

async function render() {
  const id = location.hash.slice(1);
  view.innerHTML = '';
  view.scrollTop = 0;
  if (!tools[id]) return home();
  title.textContent = tools[id][2];
  back.style.display = 'block';
  view.innerHTML = '<p class="muted">Loading…</p>';
  try {
    const m = await tools[id][3]();
    view.innerHTML = '';
    await m.default(view);
  } catch (e) {
    console.error(e);
    view.innerHTML = '<p class="muted">Error: ' + esc(e.message) + '</p>';
  }
}

window.addEventListener('hashchange', render);
render();

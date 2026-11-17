import { PDFDocument } from 'pdf-lib';
import { pick, readBytes, save, toast, baseName, pdfjs, rasterPdf, kb } from '../util.js';

// [label, render scale, jpeg quality]
const LADDER = [['High quality', 1.6, 0.8], ['Medium', 1.25, 0.6], ['Small', 0.95, 0.45], ['Smallest', 0.7, 0.32]];

export default function (root) {
  root.innerHTML = `
  <div class="row"><button class="p" id="pk">Select PDF</button></div>
  <p class="muted" id="inf">No file selected.</p>
  <div class="card">
    <div class="row">Level <select id="lv"><option value="L">Light (keeps text selectable)</option><option value="0">High quality</option><option value="1" selected>Medium</option><option value="2">Small</option><option value="3">Smallest</option></select></div>
    <div class="row">Target size (KB, optional) <input id="tk" type="number" style="width:100px" placeholder="e.g. 500"></div>
    <p class="muted">Every level except Light turns pages into images, so the text is no longer selectable. With a target size, the app tries stronger levels until the file fits.</p>
    <button class="p" id="go">Compress</button>
  </div>
  <div id="res"></div>`;
  const $ = (s) => root.querySelector(s);
  let file = null;

  $('#pk').onclick = async () => {
    const [f] = await pick('application/pdf,.pdf');
    if (!f) return;
    file = { name: baseName(f.name), bytes: await readBytes(f), size: f.size };
    $('#inf').textContent = `${f.name} • ${kb(f.size)}`;
    $('#res').innerHTML = '';
  };

  const done = (out) => {
    const pct = Math.round((1 - out.length / file.size) * 100);
    $('#res').innerHTML = `<div class="card"><b>${kb(file.size)} → ${kb(out.length)}</b><p class="muted">${pct > 0 ? 'Reduced by ' + pct + '%' : 'Not smaller than the original. Try a stronger level.'}</p></div>`;
    save(file.name + '_compressed.pdf', out, 'application/pdf');
  };

  $('#go').onclick = async () => {
    if (!file) return toast('Select a PDF first');
    const target = (+$('#tk').value || 0) * 1024, lv = $('#lv').value;
    try {
      let out = null, start = 0;
      if (lv === 'L') {
        toast('Optimising…', 6000);
        const p = await PDFDocument.load(file.bytes, { ignoreEncryption: true });
        out = await p.save({ useObjectStreams: true });
        if (out.length >= file.size) out = file.bytes;
        if (!target || out.length <= target) return done(out);
      } else start = +lv;
      const P = await pdfjs();
      const doc = await P.getDocument({ data: file.bytes.slice() }).promise;
      for (let i = start; i < LADDER.length; i++) {
        const [lab, sc, q] = LADDER[i];
        out = await rasterPdf(doc, sc, q, (n, t) => toast(`${lab}: page ${n} of ${t}…`, 8000));
        if (!target || out.length <= target) break;
      }
      if (target && out.length > target) toast('Could not reach the target size. This is the smallest possible.', 4500);
      done(out);
    } catch (e) {
      toast(e?.name === 'PasswordException' ? 'This PDF is password protected. Open it in PDF Editor first and save an unlocked copy.' : 'Error: ' + e.message, 5000);
    }
  };
}

import { createWorker } from 'tesseract.js';
import { Document, Packer, Paragraph } from 'docx';
import XLSX from 'xlsx-js-style';
import { pick, save, toast } from '../util.js';

export default function (root) {
  root.innerHTML = `
  <div class="row"><button class="p" id="cam">Camera</button><button id="gal">Gallery</button>
    <select id="lg"><option value="eng">English</option><option value="hin">Hindi</option><option value="eng+hin">Hindi + English</option></select></div>
  <p class="muted" id="st">Language data is downloaded from the internet the first time.</p>
  <textarea id="tx" rows="12" style="width:100%" placeholder="Recognised text will appear here"></textarea>
  <div class="row"><button id="cp">Copy</button><button id="txt">TXT</button><button id="wd">Word</button><button id="xl">Excel</button></div>`;
  const $ = (s) => root.querySelector(s);

  const run = async (cam) => {
    const [f] = await pick('image/*', false, cam);
    if (!f) return;
    const st = $('#st');
    try {
      st.textContent = 'Starting…';
      const w = await createWorker($('#lg').value, 1, {
        logger: (m) => { st.textContent = m.status + ' ' + Math.round((m.progress || 0) * 100) + '%'; }
      });
      const { data } = await w.recognize(f);
      await w.terminate();
      $('#tx').value = data.text;
      st.textContent = 'Done';
    } catch (e) {
      st.textContent = 'Error: ' + e.message + ' (check your internet connection)';
    }
  };
  $('#cam').onclick = () => run(true);
  $('#gal').onclick = () => run(false);

  $('#cp').onclick = async () => {
    try { await navigator.clipboard.writeText($('#tx').value); toast('Copied'); } catch { toast('Copy failed'); }
  };
  $('#txt').onclick = () => save('ocr.txt', new Blob([$('#tx').value], { type: 'text/plain' }));
  $('#wd').onclick = async () => {
    const doc = new Document({ sections: [{ children: $('#tx').value.split('\n').map((l) => new Paragraph(l)) }] });
    save('ocr.docx', await Packer.toBlob(doc));
  };
  $('#xl').onclick = () => {
    const ws = XLSX.utils.aoa_to_sheet($('#tx').value.split('\n').map((l) => l.split(/\t| {2,}/)));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'OCR');
    save('ocr.xlsx', XLSX.write(wb, { type: 'array', bookType: 'xlsx' }));
  };
}

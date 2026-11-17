import { PDFDocument } from 'pdf-lib';
import { Document, Packer, Paragraph } from 'docx';
import XLSX from 'xlsx-js-style';
import { pick, readBytes, save, toast, toBlob, loadImg, fileURL, baseName, pdfjs } from '../util.js';

const getPdf = async () => {
  const [f] = await pick('application/pdf,.pdf');
  return f ? { bytes: await readBytes(f), name: baseName(f.name) } : null;
};

const merge = (cells, gapMin) => {
  const out = [];
  let cur = null;
  cells.forEach((c) => {
    const gap = cur ? c.x - (cur.x + cur.w) : 0;
    if (cur && gap < gapMin) {
      cur.s += (gap > 1 ? ' ' : '') + c.s;
      cur.w = c.x + c.w - cur.x;
    } else out.push((cur = { ...c }));
  });
  return out;
};

async function pdfRows(bytes) {
  const P = await pdfjs();
  const doc = await P.getDocument({ data: bytes.slice() }).promise;
  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const tc = await (await doc.getPage(n)).getTextContent();
    const rows = [];
    tc.items.filter((i) => i.str.trim()).forEach((i) => {
      const y = i.transform[5], x = i.transform[4];
      let r = rows.find((q) => Math.abs(q.y - y) < 3);
      if (!r) rows.push((r = { y, cells: [] }));
      r.cells.push({ x, s: i.str, w: i.width });
    });
    rows.sort((a, b) => b.y - a.y);
    pages.push(rows.map((r) => r.cells.sort((a, b) => a.x - b.x)));
  }
  return pages;
}

export default function (root) {
  root.innerHTML = `
  <div class="card"><b>Images to PDF</b><div class="row"><button class="p" id="i2p">Select Images</button></div></div>
  <div class="card"><b>PDF to Images</b><div class="row"><button class="p" id="p2i">Select PDF</button></div><span class="muted">Each page is saved as a separate image in Documents/AllInOneDocs.</span></div>
  <div class="card"><b>PDF to Word</b><div class="row"><button class="p" id="p2w">Select PDF</button></div></div>
  <div class="card"><b>PDF to Excel</b><div class="row"><button class="p" id="p2x">Select PDF</button></div></div>
  <p class="muted">Note: PDF to Word and Excel only work on PDFs that contain real text. For scanned PDFs, use OCR first.</p>`;
  const $ = (s) => root.querySelector(s);

  $('#i2p').onclick = async () => {
    const fs = await pick('image/*', true);
    if (!fs.length) return;
    toast('Creating PDF…', 8000);
    const pdf = await PDFDocument.create();
    for (const f of fs) {
      const im = await loadImg(fileURL(f)), k = Math.min(1, 2000 / Math.max(im.width, im.height));
      const c = document.createElement('canvas');
      c.width = im.width * k; c.height = im.height * k;
      const x = c.getContext('2d');
      x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
      x.drawImage(im, 0, 0, c.width, c.height);
      const jb = new Uint8Array(await (await toBlob(c, 'image/jpeg', 0.9)).arrayBuffer());
      const e = await pdf.embedJpg(jb);
      const pg = pdf.addPage([595, (595 * c.height) / c.width]);
      pg.drawImage(e, { x: 0, y: 0, width: 595, height: pg.getHeight() });
    }
    save('images_' + Date.now() + '.pdf', await pdf.save(), 'application/pdf');
  };

  // every page is saved as its own image file (no ZIP)
  $('#p2i').onclick = async () => {
    const f = await getPdf();
    if (!f) return;
    try {
      const P = await pdfjs();
      const doc = await P.getDocument({ data: f.bytes.slice() }).promise;
      for (let n = 1; n <= doc.numPages; n++) {
        toast(`Saving page ${n} of ${doc.numPages}…`, 8000);
        const pg = await doc.getPage(n), vp = pg.getViewport({ scale: 2 });
        const c = document.createElement('canvas');
        c.width = vp.width; c.height = vp.height;
        const x = c.getContext('2d');
        x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
        await pg.render({ canvasContext: x, viewport: vp }).promise;
        await save(`${f.name}_page_${n}.jpg`, await toBlob(c, 'image/jpeg', 0.9), 'image/jpeg', true);
      }
      toast(`${doc.numPages} image(s) saved to Documents/AllInOneDocs`, 4500);
    } catch (e) { toast('Error: ' + e.message, 4000); }
  };

  $('#p2w').onclick = async () => {
    const f = await getPdf();
    if (!f) return;
    try {
      toast('Converting…', 8000);
      const pages = await pdfRows(f.bytes), kids = [];
      let any = false;
      pages.forEach((rows, i) => {
        if (!rows.length) kids.push(new Paragraph({ text: '', pageBreakBefore: i > 0 }));
        rows.forEach((cells, j) => {
          any = true;
          kids.push(new Paragraph({ text: merge(cells, 1e9).map((c) => c.s).join(' '), pageBreakBefore: i > 0 && j === 0 }));
        });
      });
      if (!any) return toast('No text found. This looks like a scanned PDF, use OCR.', 4500);
      save(f.name + '.docx', await Packer.toBlob(new Document({ sections: [{ children: kids }] })));
    } catch (e) { toast('Error: ' + e.message, 4000); }
  };

  $('#p2x').onclick = async () => {
    const f = await getPdf();
    if (!f) return;
    try {
      toast('Converting…', 8000);
      const pages = await pdfRows(f.bytes), wb = XLSX.utils.book_new();
      let any = false;
      pages.forEach((rows, i) => {
        const aoa = rows.map((cells) => merge(cells, 10).map((c) => c.s));
        if (aoa.length) any = true;
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa.length ? aoa : [['']]), 'Page ' + (i + 1));
      });
      if (!any) return toast('No text found. This looks like a scanned PDF, use OCR.', 4500);
      save(f.name + '.xlsx', XLSX.write(wb, { type: 'array', bookType: 'xlsx' }));
    } catch (e) { toast('Error: ' + e.message, 4000); }
  };
}

import mammoth from 'mammoth/mammoth.browser.min.js';
import { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, AlignmentType, ImageRun } from 'docx';
import { pick, save, toast, ask, fileURL, loadImg, dataToBytes, baseName, takePending } from '../util.js';

const HL = { H1: HeadingLevel.HEADING_1, H2: HeadingLevel.HEADING_2, H3: HeadingLevel.HEADING_3 };
const AL = { center: AlignmentType.CENTER, right: AlignmentType.RIGHT, justify: AlignmentType.JUSTIFIED };
const SZ = [16, 20, 24, 28, 36, 48, 72];
let name = 'document', last = null;

async function runs(node, st = {}) {
  const out = [];
  for (const n of node.childNodes) {
    if (n.nodeType === 3) {
      if (n.textContent) out.push(new TextRun({ text: n.textContent, bold: st.b, italics: st.i, underline: st.u ? {} : undefined, size: st.sz }));
    } else if (n.nodeName === 'BR') {
      out.push(new TextRun({ break: 1 }));
    } else if (n.nodeName === 'IMG') {
      if (!n.src.startsWith('data:')) continue;
      const im = await loadImg(n.src), k = Math.min(1, 450 / im.width);
      out.push(new ImageRun({ data: dataToBytes(n.src), transformation: { width: Math.round(im.width * k), height: Math.round(im.height * k) }, type: n.src.startsWith('data:image/png') ? 'png' : 'jpg' }));
    } else {
      const s = { ...st }, t = n.nodeName;
      if (t === 'B' || t === 'STRONG') s.b = true;
      if (t === 'I' || t === 'EM') s.i = true;
      if (t === 'U') s.u = true;
      if (t === 'FONT' && n.size) s.sz = SZ[n.size - 1];
      out.push(...(await runs(n, s)));
    }
  }
  return out;
}

async function blocks(node) {
  const out = [];
  for (const n of node.childNodes) {
    const t = n.nodeName;
    if (n.nodeType === 3) {
      if (n.textContent.trim()) out.push(new Paragraph({ children: await runs({ childNodes: [n] }) }));
    } else if (t === 'UL' || t === 'OL') {
      let i = 0;
      for (const li of n.children)
        out.push(new Paragraph({
          children: [...(t === 'OL' ? [new TextRun(++i + '. ')] : []), ...(await runs(li))],
          bullet: t === 'UL' ? { level: 0 } : undefined,
          indent: t === 'OL' ? { left: 720 } : undefined
        }));
    } else if (t === 'TABLE') {
      const rows = [];
      for (const tr of n.querySelectorAll('tr')) {
        const cells = [];
        for (const td of tr.children) cells.push(new TableCell({ children: [new Paragraph({ children: await runs(td) })] }));
        if (cells.length) rows.push(new TableRow({ children: cells }));
      }
      if (rows.length) out.push(new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } }));
      out.push(new Paragraph(''));
    } else {
      out.push(new Paragraph({ heading: HL[t], alignment: AL[n.style?.textAlign], children: await runs(n) }));
    }
  }
  return out;
}

const shrink = async (f) => {
  const i = await loadImg(fileURL(f)), k = Math.min(1, 1000 / i.width), c = document.createElement('canvas');
  c.width = i.width * k;
  c.height = i.height * k;
  c.getContext('2d').drawImage(i, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.85);
};

export default function (root) {
  root.innerHTML = `
  <div class="row"><button id="nw">New</button><button class="p" id="op">Open</button><button class="p" id="sv">Save .docx</button></div>
  <div class="row" id="tb">
    <button data-c="bold"><b>B</b></button><button data-c="italic"><i>I</i></button><button data-c="underline"><u>U</u></button>
    <button data-c="formatBlock" data-a="H1">H1</button><button data-c="formatBlock" data-a="H2">H2</button><button data-c="formatBlock" data-a="P">Text</button>
    <button data-c="insertUnorderedList">Bullets</button><button data-c="insertOrderedList">Numbers</button>
    <button data-c="justifyLeft">Left</button><button data-c="justifyCenter">Center</button><button data-c="justifyRight">Right</button>
    <button data-c="undo">Undo</button><button data-c="redo">Redo</button>
    <select id="fs"><option value="">Size</option><option value="2">10</option><option value="3">12</option><option value="4">14</option><option value="5">18</option><option value="6">24</option><option value="7">36</option></select>
    <button id="tbl">Table</button><button id="im">Image</button>
  </div>
  <div id="ed" contenteditable="true"></div>`;
  const $ = (s) => root.querySelector(s);
  const ed = $('#ed');
  document.execCommand('defaultParagraphSeparator', false, 'p');
  ed.innerHTML = localStorage.getItem('wdraft') || '<p><br></p>';

  const keep = () => {
    const s = getSelection();
    if (s.rangeCount && ed.contains(s.anchorNode)) last = s.getRangeAt(0).cloneRange();
  };
  document.addEventListener('selectionchange', keep);
  const restore = () => {
    ed.focus();
    if (last) { const s = getSelection(); s.removeAllRanges(); s.addRange(last); }
  };
  const persist = () => { try { localStorage.setItem('wdraft', ed.innerHTML); } catch {} };
  ed.oninput = persist;

  $('#tb').onmousedown = (e) => { if (e.target.tagName !== 'SELECT') e.preventDefault(); };
  $('#tb').onclick = (e) => {
    const b = e.target.closest('button');
    if (!b?.dataset.c) return;
    restore();
    document.execCommand(b.dataset.c, false, b.dataset.a);
    persist();
  };
  $('#fs').onchange = (e) => {
    if (!e.target.value) return;
    restore();
    document.execCommand('fontSize', false, e.target.value);
    e.target.value = '';
    persist();
  };

  $('#tbl').onclick = async () => {
    const v = await ask('Rows x Columns (e.g. 3x3)', '3x3');
    if (!v) return;
    const [r, c] = v.toLowerCase().split('x').map((x) => parseInt(x));
    if (!r || !c) return toast('Use a format like 3x3');
    restore();
    const row = '<tr>' + '<td><br></td>'.repeat(c) + '</tr>';
    document.execCommand('insertHTML', false, '<table>' + row.repeat(r) + '</table><p><br></p>');
    persist();
  };

  $('#im').onclick = async () => {
    const [f] = await pick('image/*');
    if (!f) return;
    const d = await shrink(f);
    restore();
    document.execCommand('insertImage', false, d);
    persist();
  };

  const openFile = async (f) => {
    try {
      const r = await mammoth.convertToHtml({ arrayBuffer: await f.arrayBuffer() });
      ed.innerHTML = r.value || '<p><br></p>';
      name = baseName(f.name);
      persist();
    } catch (e) { toast('Could not open file (only .docx is supported): ' + e.message, 4000); }
  };

  $('#nw').onclick = () => { ed.innerHTML = '<p><br></p>'; name = 'document'; persist(); };
  $('#op').onclick = async () => {
    const [f] = await pick('.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    if (f) openFile(f);
  };

  $('#sv').onclick = async () => {
    try {
      toast('Creating Word file…', 5000);
      const kids = await blocks(ed);
      if (!kids.length) kids.push(new Paragraph(''));
      const doc = new Document({ sections: [{ children: kids }] });
      save(name + '.docx', await Packer.toBlob(doc));
    } catch (e) { toast('Error: ' + e.message, 4000); console.error(e); }
  };

  const pf = takePending();
  if (pf && /\.docx$/i.test(pf.name)) openFile(pf);
    }

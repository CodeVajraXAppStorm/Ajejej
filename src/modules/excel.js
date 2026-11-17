import { HyperFormula } from 'hyperformula';
import XLSX from 'xlsx-js-style';
import { pick, readBytes, save, toast, baseName, takePending } from '../util.js';

const L = (i) => String.fromCharCode(65 + i);
const blank = (r, c) => Array.from({ length: r }, () => Array(c).fill(''));
const p = (v) => (v === '' ? null : v.trim() !== '' && isFinite(v) ? Number(v) : v);
const fmt = (v) => (v == null ? '' : typeof v === 'object' ? v.value || '#ERR' : typeof v === 'number' ? String(Math.round(v * 1e9) / 1e9) : String(v));
const key = (r, c) => r + ',' + c;
const hex = (c) => String(c || '').replace('#', '').toUpperCase();

let raw = blank(60, 12), sty = {}, cw = Array(12).fill(96), hf, name = 'sheet';
const build = () => {
  hf?.destroy();
  hf = HyperFormula.buildFromArray(raw.map((r) => r.map(p)), { licenseKey: 'gpl-v3' });
};

function fromSheet(ws) {
  const rg = XLSX.utils.decode_range(ws['!ref'] || 'A1:A1');
  const R = Math.max(60, rg.e.r + 20), C = Math.max(12, Math.min(26, rg.e.c + 3));
  const a = blank(R, C), st = {};
  for (let r = rg.s.r; r <= rg.e.r; r++)
    for (let c = rg.s.c; c <= rg.e.c && c < 26; c++) {
      const x = ws[XLSX.utils.encode_cell({ r, c })];
      if (!x) continue;
      a[r][c] = x.f ? '=' + x.f : x.v == null ? '' : String(x.v);
      const s = x.s;
      if (s) { // best effort: styles written by other programs may not be read fully
        const o = {}, bg = s.fgColor?.rgb || s.fill?.fgColor?.rgb;
        if (bg && String(bg).length >= 6 && s.patternType !== 'none' && !/FFFFFF$/i.test(bg)) o.bg = '#' + String(bg).slice(-6);
        if (s.font?.bold || s.bold) o.b = true;
        const fg = s.font?.color?.rgb;
        if (fg && String(fg).length >= 6) o.fg = '#' + String(fg).slice(-6);
        if (s.alignment?.horizontal) o.al = s.alignment.horizontal;
        if (Object.keys(o).length) st[key(r, c)] = o;
      }
    }
  const w = Array.from({ length: C }, (_, i) => { const m = ws['!cols']?.[i]; return Math.max(50, Math.round(m?.wpx || (m?.wch ? m.wch * 8 : 96))); });
  return { a, st, w };
}

const cellStyle = (s) => {
  const o = {};
  if (s.b || s.fg) o.font = { bold: !!s.b, color: s.fg ? { rgb: hex(s.fg) } : undefined };
  if (s.bg) o.fill = { patternType: 'solid', fgColor: { rgb: hex(s.bg) } };
  if (s.al) o.alignment = { horizontal: s.al };
  if (s.bd) { const t = { style: 'thin', color: { rgb: '000000' } }; o.border = { top: t, bottom: t, left: t, right: t }; }
  return o;
};

export default function (root) {
  root.innerHTML = `
  <div class="row"><button class="p" id="op">Open</button><button id="sv">Save .xlsx</button><button id="cp">Copy</button><button id="ar">+ Row</button><button id="ac">+ Col</button><button class="d" id="cl">Clear</button></div>
  <div class="row"><button id="fb"><b>B</b></button><label class="muted">Fill <input type="color" id="fc" value="#ffe066"></label><label class="muted">Text <input type="color" id="tc" value="#d13438"></label><button data-al="left">Left</button><button data-al="center">Center</button><button data-al="right">Right</button><button id="bd">Border</button><button id="cm">Col −</button><button id="cpl">Col +</button><button id="ns">Clear style</button></div>
  <p class="muted">Tap a cell, then use the formatting buttons. Formulas: =SUM(A1:A5), =A1*B1. You can paste a table copied from Word.</p>
  <div class="xl" id="xl"></div>`;
  const $ = (s) => root.querySelector(s);
  const box = $('#xl');
  let sel = null;

  const refresh = (skip) =>
    box.querySelectorAll('input').forEach((i) => {
      if (i !== skip) i.value = fmt(hf.getCellValue({ sheet: 0, row: +i.dataset.r, col: +i.dataset.c }));
    });

  const paint = (r, c) => {
    const i = box.querySelector(`input[data-r="${r}"][data-c="${c}"]`);
    if (!i) return;
    const s = sty[key(r, c)] || {};
    i.style.fontWeight = s.b ? '700' : '';
    i.style.background = s.bg || '';
    i.style.color = s.fg || (s.bg ? '#111' : '');
    i.style.textAlign = s.al || '';
    i.parentElement.style.border = s.bd ? '1px solid #e0e0e0' : '';
  };

  const draw = () => {
    build();
    const C = raw[0].length;
    while (cw.length < C) cw.push(96);
    let h = `<table style="width:${40 + cw.slice(0, C).reduce((a, b) => a + b, 0)}px"><colgroup><col style="width:40px">${cw.slice(0, C).map((w) => `<col style="width:${w}px">`).join('')}</colgroup><tr><th></th>` + Array.from({ length: C }, (_, c) => `<th>${L(c)}</th>`).join('') + '</tr>';
    raw.forEach((row, r) => {
      h += `<tr><th>${r + 1}</th>` + row.map((_, c) => `<td><input data-r="${r}" data-c="${c}" autocomplete="off"></td>`).join('') + '</tr>';
    });
    box.innerHTML = h + '</table>';
    refresh();
    Object.keys(sty).forEach((k) => { const [r, c] = k.split(',').map(Number); paint(r, c); });
  };
  draw();

  const setStyle = (patch) => {
    if (!sel) return toast('Tap a cell first');
    const k = key(sel.r, sel.c);
    sty[k] = { ...sty[k], ...patch };
    paint(sel.r, sel.c);
  };

  $('#fb').onclick = () => setStyle({ b: !(sty[sel && key(sel.r, sel.c)]?.b) });
  $('#bd').onclick = () => setStyle({ bd: !(sty[sel && key(sel.r, sel.c)]?.bd) });
  $('#fc').oninput = (e) => setStyle({ bg: e.target.value });
  $('#tc').oninput = (e) => setStyle({ fg: e.target.value });
  root.querySelectorAll('[data-al]').forEach((b) => { b.onclick = () => setStyle({ al: b.dataset.al }); });
  $('#ns').onclick = () => { if (!sel) return toast('Tap a cell first'); delete sty[key(sel.r, sel.c)]; paint(sel.r, sel.c); };
  const width = (d) => { if (!sel) return toast('Tap a cell first'); cw[sel.c] = Math.max(50, cw[sel.c] + d); draw(); };
  $('#cm').onclick = () => width(-20);
  $('#cpl').onclick = () => width(20);

  box.addEventListener('focusin', (e) => {
    const i = e.target;
    if (i.dataset.r) { sel = { r: +i.dataset.r, c: +i.dataset.c }; i.value = raw[i.dataset.r][i.dataset.c]; }
  });
  box.addEventListener('focusout', (e) => {
    const i = e.target;
    if (!i.dataset.r) return;
    const r = +i.dataset.r, c = +i.dataset.c;
    if (raw[r][c] !== i.value) {
      raw[r][c] = i.value;
      hf.setCellContents({ sheet: 0, row: r, col: c }, [[p(i.value)]]);
    }
    refresh(e.relatedTarget);
  });
  box.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const i = e.target;
    (box.querySelector(`input[data-r="${+i.dataset.r + 1}"][data-c="${i.dataset.c}"]`) || i).focus();
  });
  box.addEventListener('paste', (e) => {
    const t = e.clipboardData.getData('text');
    if (!/[\t\n]/.test(t.trim())) return;
    e.preventDefault();
    const i = e.target, r0 = +i.dataset.r, c0 = +i.dataset.c;
    t.replace(/\r/g, '').replace(/\n$/, '').split('\n').forEach((line, dr) =>
      line.split('\t').forEach((v, dc) => {
        if (raw[r0 + dr] && c0 + dc < raw[0].length) raw[r0 + dr][c0 + dc] = v;
      })
    );
    draw();
  });

  $('#ar').onclick = () => { raw.push(Array(raw[0].length).fill('')); draw(); };
  $('#ac').onclick = () => { if (raw[0].length >= 26) return toast('Maximum 26 columns'); raw.forEach((r) => r.push('')); cw.push(96); draw(); };
  $('#cl').onclick = () => { raw = blank(60, 12); sty = {}; cw = Array(12).fill(96); draw(); };

  $('#cp').onclick = async () => {
    const t = raw
      .map((r, i) => r.map((_, c) => fmt(hf.getCellValue({ sheet: 0, row: i, col: c }))).join('\t'))
      .join('\n')
      .replace(/\t+(?=\n|$)/g, '')
      .trimEnd();
    try { await navigator.clipboard.writeText(t); toast('Copied'); } catch { toast('Copy failed'); }
  };

  const openFile = async (f) => {
    try {
      const wb = XLSX.read(await readBytes(f), { type: 'array', cellStyles: true });
      const r = fromSheet(wb.Sheets[wb.SheetNames[0]]);
      raw = r.a; sty = r.st; cw = r.w;
      name = baseName(f.name);
      draw();
    } catch (e) { toast('Could not open file: ' + e.message, 4000); }
  };
  $('#op').onclick = async () => { const [f] = await pick('.xlsx,.xls,.csv'); if (f) openFile(f); };

  $('#sv').onclick = () => {
    const ws = {};
    raw.forEach((row, r) =>
      row.forEach((v, c) => {
        const s = sty[key(r, c)];
        if (v === '' && !s) return;
        const a = XLSX.utils.encode_cell({ r, c });
        const o = v === '' ? { t: 's', v: '' } : v.startsWith('=') ? { t: 'n', f: v.slice(1) } : v.trim() !== '' && isFinite(v) ? { t: 'n', v: Number(v) } : { t: 's', v };
        if (s) o.s = cellStyle(s);
        ws[a] = o;
      })
    );
    ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: raw.length - 1, c: raw[0].length - 1 } });
    ws['!cols'] = cw.slice(0, raw[0].length).map((w) => ({ wpx: w }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    save(name + '.xlsx', XLSX.write(wb, { type: 'array', bookType: 'xlsx' }), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  };

  const pf = takePending();
  if (pf && /\.(xlsx|xls|csv)$/i.test(pf.name)) openFile(pf);
      }

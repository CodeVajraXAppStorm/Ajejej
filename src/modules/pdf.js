import { PDFDocument, PDFTextField, PDFCheckBox, PDFDropdown, PDFRadioGroup, degrees, rgb, StandardFonts } from 'pdf-lib';
import { pick, readBytes, save, toast, sigs, sheet, ask, loadImg, dataToBytes, baseName, pdfjs, esc, rasterPdf, takePending } from '../util.js';

// state is module-level so the PDF stays loaded when you come back from another tool
const S = { doc: null, bytes: null, name: 'document', items: [], page: 1, pages: 0, zoom: 1, sel: null, scale: 1, dw: 1, dh: 1, typeMode: false };
let seq = 0, task;

function textPng(text, pt, color) {
  const k = 4, c = document.createElement('canvas'), x = c.getContext('2d');
  const font = `${pt * k}px sans-serif`;
  x.font = font;
  const lines = text.split('\n'), lh = pt * k * 1.2;
  c.width = Math.ceil(Math.max(...lines.map((l) => x.measureText(l).width))) + 4;
  c.height = Math.ceil(lh * lines.length) + 4;
  x.font = font;
  x.fillStyle = color;
  x.textBaseline = 'top';
  lines.forEach((l, i) => x.fillText(l, 2, 2 + i * lh));
  return { bytes: dataToBytes(c.toDataURL('image/png')), w: c.width / k, h: c.height / k };
}

function markPng(kind, color) {
  const c = document.createElement('canvas');
  c.width = c.height = 100;
  const x = c.getContext('2d');
  x.strokeStyle = color; x.lineWidth = 12; x.lineCap = x.lineJoin = 'round';
  x.beginPath();
  if (kind === 'tick') { x.moveTo(15, 55); x.lineTo(40, 80); x.lineTo(88, 22); }
  else { x.moveTo(20, 20); x.lineTo(80, 80); x.moveTo(80, 20); x.lineTo(20, 80); }
  x.stroke();
  return c.toDataURL('image/png');
}

const today = () => new Date().toLocaleDateString('en-GB');

const parse = (s, n) =>
  s.split(',').flatMap((p) => {
    const [a, b = a] = p.split('-').map((x) => parseInt(x));
    const r = [];
    for (let i = a; i <= b; i++) if (i >= 1 && i <= n) r.push(i - 1);
    return r;
  });

const rebuild = async (pdf, order) => {
  const o = await PDFDocument.create();
  (await o.copyPages(pdf, order)).forEach((p) => o.addPage(p));
  return o;
};

// opens a PDF; if it is password protected, asks for the password and makes an unlocked copy
async function openPdf(bytes) {
  const P = await pdfjs();
  try {
    return { bytes, doc: await P.getDocument({ data: bytes.slice() }).promise };
  } catch (e) {
    if (e?.name !== 'PasswordException') throw e;
    const pw = await ask('This PDF is password protected. Enter the password:');
    if (!pw) throw new Error('Password required');
    const doc = await P.getDocument({ data: bytes.slice(), password: pw.trim() }).promise;
    toast('Unlocking…', 8000);
    const flat = await rasterPdf(doc, 2, 0.85);
    return { bytes: flat, doc: await P.getDocument({ data: flat.slice() }).promise };
  }
}

export default async function (root, opts = {}) {
  S.typeMode = !!opts.fill;
  root.innerHTML = `
  <div class="row"><button class="p" id="op">Open</button><button id="sv">Save</button><button id="mr">More</button></div>
  <div class="row"><button id="pv">Prev</button><span id="inf" class="muted">–</span><button id="nx">Next</button><button id="zo">−</button><button id="zi">+</button><button id="pgs">Pages</button></div>
  <div class="row"><button id="sg">Sign</button><button id="tx">Text</button><button id="hl">Highlight</button><button id="tt">Tap to type</button><input type="color" id="col" value="#000000"></div>
  <div class="row"><button id="dt">Date</button><button id="tk">Tick</button><button id="cr">Cross</button><span class="muted">Selected:</span><button id="bg">A+</button><button id="sm">A−</button><button class="d" id="dl">Delete</button></div>
  <p class="muted" id="hint"></p>
  <div id="stage"><div id="wrap" class="pgwrap"></div></div>`;
  const $ = (s) => root.querySelector(s);
  const stage = $('#stage'), wrap = $('#wrap'), info = $('#inf'), col = $('#col');
  const cur = () => S.items.find((i) => i.id === S.sel);

  const syncMode = () => {
    $('#tt').classList.toggle('on', S.typeMode);
    $('#hint').textContent = S.typeMode ? 'Tap anywhere on the page to type text there.' : '';
  };
  syncMode();

  async function load(bytes) {
    try {
      const r = await openPdf(bytes);
      S.doc = r.doc;
      S.bytes = r.bytes;
      S.pages = r.doc.numPages;
      S.page = Math.min(Math.max(S.page, 1), S.pages);
      await show();
    } catch (e) {
      console.error(e);
      toast('Could not open PDF: ' + e.message, 4000);
    }
  }

  async function show() {
    if (!S.doc) return;
    const id = ++seq;
    const page = await S.doc.getPage(S.page);
    if (id !== seq) return;
    const base = page.getViewport({ scale: 1 });
    const css = ((stage.clientWidth || 340) / base.width) * S.zoom;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const vp = page.getViewport({ scale: css * dpr });
    S.scale = css; S.dw = base.width; S.dh = base.height;
    wrap.style.width = base.width * css + 'px';
    wrap.style.height = base.height * css + 'px';
    const cv = document.createElement('canvas');
    cv.width = vp.width; cv.height = vp.height;
    wrap.querySelector('canvas')?.remove();
    wrap.prepend(cv);
    info.textContent = `Page ${S.page} of ${S.pages}`;
    drawItems();
    task?.cancel();
    task = page.render({ canvasContext: cv.getContext('2d'), viewport: vp });
    try { await task.promise; } catch {}
  }

  function drawItems() {
    wrap.querySelectorAll('.it').forEach((n) => n.remove());
    S.items.filter((i) => i.page === S.page).forEach((it) => {
      const n = document.createElement('div');
      n.className = 'it' + (it.type === 'hl' ? ' hl' : '') + (S.sel === it.id ? ' sel' : '');
      n.style.left = it.x * 100 + '%';
      n.style.top = it.y * 100 + '%';
      if (it.type === 'text') {
        n.style.fontSize = it.pt * S.scale + 'px';
        n.style.color = it.color;
        n.style.whiteSpace = 'pre';
        n.textContent = it.text;
      } else {
        n.style.width = it.w * 100 + '%';
        if (it.type === 'hl') n.style.height = it.h * 100 + '%';
        else n.innerHTML = `<img src="${it.src}">`;
        n.insertAdjacentHTML('beforeend', '<i class="rs"></i>');
      }
      bind(n, it);
      wrap.append(n);
    });
  }

  function bind(n, it) {
    n.onpointerdown = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const resize = e.target.classList.contains('rs');
      const wasSel = S.sel === it.id;
      S.sel = it.id;
      wrap.querySelectorAll('.it').forEach((x) => x.classList.remove('sel'));
      n.classList.add('sel');
      const r = wrap.getBoundingClientRect(), sx = e.clientX, sy = e.clientY, o = { ...it };
      let moved = false;
      n.setPointerCapture(e.pointerId);
      n.onpointermove = (m) => {
        if (Math.abs(m.clientX - sx) + Math.abs(m.clientY - sy) > 4) moved = true;
        const dx = (m.clientX - sx) / r.width, dy = (m.clientY - sy) / r.height;
        if (resize) {
          it.w = Math.max(0.03, o.w + dx);
          n.style.width = it.w * 100 + '%';
          if (it.type === 'hl') { it.h = Math.max(0.01, o.h + dy); n.style.height = it.h * 100 + '%'; }
        } else {
          it.x = Math.min(0.98, Math.max(-0.1, o.x + dx));
          it.y = Math.min(0.98, Math.max(-0.1, o.y + dy));
          n.style.left = it.x * 100 + '%';
          n.style.top = it.y * 100 + '%';
        }
      };
      n.onpointerup = n.onpointercancel = async () => {
        n.onpointermove = n.onpointerup = n.onpointercancel = null;
        if (!moved && wasSel && it.type === 'text') {
          const t = await ask('Edit text', it.text);
          if (t && t.trim()) { it.text = t; drawItems(); }
        }
      };
    };
  }

  // tap on empty page area: deselect, or (Tap to type mode) place new text there
  let down = null;
  wrap.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.it')) { down = null; return; }
    S.sel = null;
    wrap.querySelectorAll('.it.sel').forEach((n) => n.classList.remove('sel'));
    down = { x: e.clientX, y: e.clientY };
  });
  wrap.addEventListener('pointerup', async (e) => {
    if (!down || !S.typeMode) return;
    const moved = Math.abs(e.clientX - down.x) + Math.abs(e.clientY - down.y);
    down = null;
    if (moved > 8) return;
    const r = wrap.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    const t = await ask('Type here (Hindi is supported)');
    if (t && t.trim()) add({ type: 'text', text: t, pt: 14, color: col.value, x, y: y - 0.01 });
  });

  const add = (o) => {
    const it = { id: Date.now() + Math.random(), page: S.page, ...o };
    S.items.push(it);
    S.sel = it.id;
    drawItems();
  };
  const need = () => { if (!S.doc) { toast('Open a PDF first'); return false; } return true; };

  $('#op').onclick = async () => {
    const [f] = await pick('application/pdf,.pdf');
    if (!f) return;
    S.name = baseName(f.name); S.items = []; S.sel = null; S.page = 1;
    await load(await readBytes(f));
  };

  const go = (n) => { if (!need()) return; S.page = Math.min(S.pages, Math.max(1, n)); S.sel = null; show(); };
  $('#pv').onclick = () => go(S.page - 1);
  $('#nx').onclick = () => go(S.page + 1);
  $('#zi').onclick = () => { S.zoom = Math.min(4, S.zoom * 1.25); show(); };
  $('#zo').onclick = () => { S.zoom = Math.max(0.5, S.zoom / 1.25); show(); };

  $('#sg').onclick = () => {
    if (!need()) return;
    const { box, close } = sheet(`<p>Choose a signature</p><div class="row" id="sl"></div>
      <div class="row"><label class="muted"><input type="checkbox" id="an"> Add name</label><input id="nm" placeholder="Your name" style="flex:1"></div>
      <div class="row"><label class="muted"><input type="checkbox" id="ad"> Add date</label></div>
      <button id="nw">Create new signature</button>`);
    box.querySelector('#nm').value = localStorage.getItem('sname') || '';
    const l = box.querySelector('#sl');
    if (!sigs().length) l.innerHTML = '<span class="muted">No saved signatures yet.</span>';
    sigs().forEach((s) => {
      const b = document.createElement('div');
      b.className = 'thumb';
      b.innerHTML = `<img src="${s}">`;
      b.onclick = async () => {
        const im = await loadImg(s);
        const nm = box.querySelector('#nm').value.trim(), an = box.querySelector('#an').checked, ad = box.querySelector('#ad').checked;
        localStorage.setItem('sname', nm);
        close();
        const w = 0.3, x = 0.3, y = 0.4, r = im.height / im.width;
        let yy = y + (w * S.dw * r) / S.dh + 0.004;
        const lh = 14 / S.dh;
        add({ type: 'sig', src: s, x, y, w, r });
        if (an && nm) { add({ type: 'text', text: nm, pt: 11, color: '#111111', x, y: yy }); yy += lh; }
        if (ad) add({ type: 'text', text: today(), pt: 11, color: '#111111', x, y: yy });
      };
      l.append(b);
    });
    box.querySelector('#nw').onclick = () => { close(); location.hash = 'sign'; };
  };

  $('#tx').onclick = async () => {
    if (!need()) return;
    const t = await ask('Enter text (Hindi is supported)');
    if (t && t.trim()) add({ type: 'text', text: t, pt: 16, color: col.value, x: 0.1, y: 0.1 });
  };
  $('#tt').onclick = () => { S.typeMode = !S.typeMode; syncMode(); };
  $('#hl').onclick = () => { if (need()) add({ type: 'hl', x: 0.2, y: 0.2, w: 0.4, h: 0.03 }); };
  $('#dt').onclick = () => { if (need()) add({ type: 'text', text: today(), pt: 14, color: col.value, x: 0.1, y: 0.1 }); };
  $('#tk').onclick = () => { if (need()) add({ type: 'sig', src: markPng('tick', col.value), x: 0.4, y: 0.4, w: 0.05, r: 1 }); };
  $('#cr').onclick = () => { if (need()) add({ type: 'sig', src: markPng('cross', col.value), x: 0.4, y: 0.4, w: 0.05, r: 1 }); };
  col.oninput = () => { const it = cur(); if (it?.type === 'text') { it.color = col.value; drawItems(); } };

  const scaleSel = (f) => {
    const it = cur();
    if (!it) return toast('Select an item first');
    if (it.type === 'text') it.pt = Math.max(6, it.pt * f);
    else { it.w *= f; if (it.h) it.h *= f; }
    drawItems();
  };
  $('#bg').onclick = () => scaleSel(1.15);
  $('#sm').onclick = () => scaleSel(1 / 1.15);
  $('#dl').onclick = () => { S.items = S.items.filter((i) => i.id !== S.sel); S.sel = null; drawItems(); };

  // writes the overlay items into the real PDF
  async function bake() {
    if (!S.items.length) return S.bytes;
    const pdf = await PDFDocument.load(S.bytes, { ignoreEncryption: true });
    const pages = pdf.getPages();
    for (const it of S.items) {
      const pg = pages[it.page - 1];
      if (!pg) continue;
      const { width: W, height: H } = pg.getSize();
      const R = ((pg.getRotation().angle % 360) + 360) % 360;
      const dw = R % 180 ? H : W, dh = R % 180 ? W : H;
      const map = (u, v) => (R === 0 ? [u, H - v] : R === 90 ? [v, u] : R === 180 ? [W - u, v] : [W - v, H - u]);
      if (it.type === 'hl') {
        const [a, b] = map(it.x * dw, it.y * dh), [c, d] = map((it.x + it.w) * dw, (it.y + it.h) * dh);
        pg.drawRectangle({ x: Math.min(a, c), y: Math.min(b, d), width: Math.abs(c - a), height: Math.abs(d - b), color: rgb(1, 0.86, 0), opacity: 0.45 });
        continue;
      }
      let img, w, h;
      if (it.type === 'sig') { img = await pdf.embedPng(dataToBytes(it.src)); w = it.w * dw; h = w * it.r; }
      else { const t = textPng(it.text, it.pt, it.color); img = await pdf.embedPng(t.bytes); w = t.w; h = t.h; }
      const [x, y] = map(it.x * dw, it.y * dh + h);
      pg.drawImage(img, { x, y, width: w, height: h, rotate: degrees(R) });
    }
    return await pdf.save();
  }

  $('#sv').onclick = async () => {
    if (!need()) return;
    toast('Preparing…');
    save(S.name + '_edited.pdf', await bake(), 'application/pdf');
  };

  async function edit(fn) {
    if (!need()) return;
    try {
      const pdf = await PDFDocument.load(await bake(), { ignoreEncryption: true });
      const out = (await fn(pdf)) || pdf;
      S.items = []; S.sel = null;
      await load(await out.save());
    } catch (e) { toast('Error: ' + e.message, 4000); console.error(e); }
  }

  const move = (i, d) => edit(async (p) => {
    const n = p.getPageCount(), j = i + d;
    if (j < 0 || j >= n) throw new Error('Cannot move further');
    const ord = [...Array(n).keys()];
    [ord[i], ord[j]] = [ord[j], ord[i]];
    S.page = j + 1;
    return rebuild(p, ord);
  });

  const delPage = (i) => edit(async (p) => {
    const n = p.getPageCount();
    if (n < 2) throw new Error('Cannot delete the last page');
    const o = await rebuild(p, [...Array(n).keys()].filter((k) => k !== i));
    S.page = Math.min(S.page, n - 1);
    return o;
  });

  // all pages as thumbnails: open, move earlier/later, delete
  async function openPages() {
    if (!need()) return;
    const { box, close } = sheet('<p>Pages</p><div class="pgrid" id="pg"></div>');
    const g = box.querySelector('#pg'), doc = S.doc, cvs = [];
    for (let i = 0; i < S.pages; i++) {
      const d = document.createElement('div');
      d.className = 'card';
      d.innerHTML = `<canvas></canvas><div class="row"><span class="muted">${i + 1}</span><button data-a="go">Open</button><button data-a="l">‹</button><button data-a="r">›</button><button class="d" data-a="x">✕</button></div>`;
      d.onclick = async (e) => {
        const a = e.target.dataset.a;
        if (!a) return;
        close();
        if (a === 'go') return go(i + 1);
        if (a === 'l') await move(i, -1);
        if (a === 'r') await move(i, 1);
        if (a === 'x') await delPage(i);
        openPages();
      };
      g.append(d);
      cvs.push(d.querySelector('canvas'));
    }
    for (let i = 0; i < cvs.length; i++) {
      if (!box.isConnected) break;
      const pg = await doc.getPage(i + 1), v0 = pg.getViewport({ scale: 1 }), vp = pg.getViewport({ scale: 150 / v0.width });
      cvs[i].width = vp.width; cvs[i].height = vp.height;
      await pg.render({ canvasContext: cvs[i].getContext('2d'), viewport: vp }).promise;
    }
  }
  $('#pgs').onclick = openPages;

  async function fillFields() {
    if (!need()) return;
    const pdf = await PDFDocument.load(await bake(), { ignoreEncryption: true });
    const fields = pdf.getForm().getFields();
    if (!fields.length) return toast('No fillable fields in this PDF. Use Tap to type or Text.', 4500);
    const { box, close } = sheet('<p>Fill form fields</p><div id="ff"></div><div class="row"><button class="p" id="ap">Apply</button></div>');
    const ff = box.querySelector('#ff'), meta = [];
    fields.forEach((f) => {
      const n = f.getName(), i = meta.length;
      let h;
      if (f instanceof PDFTextField) { meta.push({ n, t: 't' }); h = `<label>${esc(n)}<br><input data-i="${i}" value="${esc(f.getText() || '')}" style="width:100%"></label>`; }
      else if (f instanceof PDFCheckBox) { meta.push({ n, t: 'c' }); h = `<label><input type="checkbox" data-i="${i}" ${f.isChecked() ? 'checked' : ''}> ${esc(n)}</label>`; }
      else if (f instanceof PDFDropdown || f instanceof PDFRadioGroup) {
        meta.push({ n, t: f instanceof PDFDropdown ? 'd' : 'r' });
        const sel = f.getSelected?.();
        h = `<label>${esc(n)}<br><select data-i="${i}" style="width:100%"><option value=""></option>${f.getOptions().map((o) => `<option ${sel === o || sel?.[0] === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></label>`;
      } else return;
      ff.insertAdjacentHTML('beforeend', `<div class="card">${h}</div>`);
    });
    box.querySelector('#ap').onclick = () => {
      const vals = meta.map((m, i) => { const el = box.querySelector(`[data-i="${i}"]`); return m.t === 'c' ? el.checked : el.value; });
      close();
      edit(async (p) => {
        const form = p.getForm();
        meta.forEach((m, i) => {
          try {
            if (m.t === 't') form.getTextField(m.n).setText(vals[i]);
            else if (m.t === 'c') { const c = form.getCheckBox(m.n); vals[i] ? c.check() : c.uncheck(); }
            else if (vals[i]) (m.t === 'd' ? form.getDropdown(m.n) : form.getRadioGroup(m.n)).select(vals[i]);
          } catch (e) { console.warn(m.n, e); }
        });
        form.flatten();
      });
    };
  }

  const ops = {
    rot: () => edit((p) => { const pg = p.getPage(S.page - 1); pg.setRotation(degrees((pg.getRotation().angle + 90) % 360)); }),
    del: () => delPage(S.page - 1),
    form: fillFields,
    merge: async () => {
      const [f] = await pick('application/pdf,.pdf');
      if (!f) return;
      const b = await readBytes(f);
      if (!S.doc) { S.name = baseName(f.name); return load(b); }
      edit(async (p) => {
        const o = await PDFDocument.load(b, { ignoreEncryption: true });
        (await p.copyPages(o, o.getPageIndices())).forEach((x) => p.addPage(x));
      });
    },
    split: async () => {
      if (!need()) return;
      const t = await ask('Which pages do you need? (e.g. 1-3,5)', '1');
      if (!t) return;
      const p = await PDFDocument.load(await bake(), { ignoreEncryption: true });
      const ord = parse(t, p.getPageCount());
      if (!ord.length) return toast('Invalid page range');
      const o = await rebuild(p, ord);
      save(S.name + '_part.pdf', await o.save(), 'application/pdf');
    },
    wm: async () => {
      if (!need()) return;
      const t = await ask('Watermark text', 'CONFIDENTIAL');
      if (!t) return;
      const tp = textPng(t, 48, '#888888');
      edit(async (p) => {
        const img = await p.embedPng(tp.bytes), c = Math.SQRT1_2;
        for (const pg of p.getPages()) {
          const { width: W, height: H } = pg.getSize();
          const s = Math.min(1, (Math.min(W, H) * 0.9) / tp.w), w = tp.w * s, h = tp.h * s;
          pg.drawImage(img, { x: W / 2 - (w / 2) * c + (h / 2) * c, y: H / 2 - (w / 2) * c - (h / 2) * c, width: w, height: h, rotate: degrees(45), opacity: 0.25 });
        }
      });
    },
    num: () => edit(async (p) => {
      const f = await p.embedFont(StandardFonts.Helvetica), n = p.getPageCount();
      p.getPages().forEach((pg, i) => pg.drawText(`${i + 1} / ${n}`, { x: pg.getWidth() / 2 - 15, y: 18, size: 10, font: f, color: rgb(0.2, 0.2, 0.2) }));
    }),
    lock: async () => {
      if (!need()) return;
      const pw = await ask('Set a password for this PDF');
      if (!pw || !pw.trim()) return;
      try {
        toast('Encrypting…', 6000);
        const m = await import('@pdfsmaller/pdf-encrypt-lite');
        const enc = m.encryptPDF || m.default?.encryptPDF || m.default;
        const out = await enc(await bake(), pw.trim(), pw.trim());
        save(S.name + '_locked.pdf', out, 'application/pdf');
      } catch (e) { toast('Could not lock PDF: ' + e.message, 4500); console.error(e); }
    }
  };

  $('#mr').onclick = () => {
    const { box, close } = sheet(`<div class="row col">
      <button data-a="form">Fill form fields</button>
      <button data-a="rot">Rotate this page</button>
      <button data-a="del">Delete this page</button>
      <button data-a="merge">Merge another PDF</button>
      <button data-a="split">Extract pages to a new PDF</button>
      <button data-a="wm">Add watermark</button>
      <button data-a="num">Add page numbers</button>
      <button data-a="lock">Set password (lock)</button></div>
      <p class="muted">To remove a password: open the protected PDF here, enter the password, then Save.</p>`);
    box.onclick = (e) => { const a = e.target.dataset.a; if (a) { close(); ops[a](); } };
  };

  const pf = takePending();
  if (pf && /\.pdf$/i.test(pf.name)) {
    S.name = baseName(pf.name); S.items = []; S.sel = null; S.page = 1;
    await load(await readBytes(pf));
  } else if (S.doc) show();
}

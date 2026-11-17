import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { Capacitor } from '@capacitor/core';
import { PDFDocument } from 'pdf-lib';

export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const kb = (n) => (n > 1048576 ? (n / 1048576).toFixed(2) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');

export function toast(m, ms = 2500) {
  document.getElementById('toast')?.remove();
  const t = document.createElement('div');
  t.id = 'toast';
  t.textContent = m;
  document.body.append(t);
  setTimeout(() => t.remove(), ms);
}

export function pick(accept = '*/*', multiple = false, capture = false) {
  return new Promise((res) => {
    const i = document.createElement('input');
    i.type = 'file';
    i.accept = accept;
    i.multiple = multiple;
    i.style.display = 'none';
    if (capture) i.setAttribute('capture', 'environment');
    i.onchange = () => { res([...i.files]); i.remove(); };
    i.addEventListener('cancel', () => { res([]); i.remove(); });
    document.body.append(i);
    i.click();
  });
}

export const readBytes = async (f) => new Uint8Array(await f.arrayBuffer());
export const fileURL = (f) => URL.createObjectURL(f);
export const baseName = (n) => n.replace(/\.[^.]+$/, '');
export const toBlob = (c, type = 'image/png', q = 0.92) => new Promise((r) => c.toBlob(r, type, q));
export const dataToBytes = (d) => Uint8Array.from(atob(d.split(',')[1]), (c) => c.charCodeAt(0));
export const loadImg = (src) => new Promise((res, rej) => {
  const i = new Image();
  i.onload = () => res(i);
  i.onerror = rej;
  i.src = src;
});

export function sheet(html) {
  const s = document.createElement('div');
  s.className = 'sheet';
  s.innerHTML = '<div></div>';
  const box = s.firstChild;
  box.innerHTML = html;
  s.onclick = (e) => { if (e.target === s) s.remove(); };
  document.body.append(s);
  return { box, close: () => s.remove() };
}

export function ask(label, val = '') {
  return new Promise((res) => {
    const { box, close } = sheet(`<p>${label}</p><textarea id="q" rows="3" style="width:100%"></textarea><div class="row"><button class="p" id="ok">OK</button><button id="no">Cancel</button></div>`);
    const q = box.querySelector('#q');
    q.value = val;
    box.querySelector('#ok').onclick = () => { close(); res(q.value); };
    box.querySelector('#no').onclick = () => { close(); res(null); };
  });
}

/* ---------- saved signatures ---------- */
export const sigs = () => JSON.parse(localStorage.getItem('sigs') || '[]');
export const addSig = (d) => localStorage.setItem('sigs', JSON.stringify([...sigs(), d]));
export const delSig = (i) => {
  const a = sigs();
  a.splice(i, 1);
  localStorage.setItem('sigs', JSON.stringify(a));
};

/* ---------- recent files + "open this file in a tool" ---------- */
export const recents = () => { try { return JSON.parse(localStorage.getItem('recents') || '[]'); } catch { return []; } };
const addRecent = (r) => localStorage.setItem('recents', JSON.stringify([r, ...recents().filter((x) => x.path !== r.path)].slice(0, 12)));

let _pending = null;
export const setPending = (f) => { _pending = f; };
export const takePending = () => { const f = _pending; _pending = null; return f; };

export async function recentFile(r) {
  const x = await Filesystem.readFile({ path: r.path, directory: Directory.Documents });
  const bin = atob(x.data), u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return new File([u], r.name);
}
export async function shareRecent(r) {
  const u = await Filesystem.getUri({ path: r.path, directory: Directory.Documents });
  await Share.share({ title: r.name, url: u.uri });
}

/* ---------- save + share ---------- */
const native = () => Capacitor.isNativePlatform();
const b64 = (blob) => new Promise((r) => {
  const f = new FileReader();
  f.onload = () => r(String(f.result).split(',')[1]);
  f.readAsDataURL(blob);
});

async function writeDoc(name, blob) {
  if (!native()) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    return;
  }
  const path = 'AllInOneDocs/' + name;
  await Filesystem.writeFile({ path, data: await b64(blob), directory: Directory.Documents, recursive: true });
  addRecent({ name, path, ts: Date.now() });
}

async function shareBlob(name, blob) {
  if (native()) {
    const w = await Filesystem.writeFile({ path: name, data: await b64(blob), directory: Directory.Cache });
    await Share.share({ title: name, url: w.uri });
    return;
  }
  const f = new File([blob], name, { type: blob.type });
  if (navigator.canShare?.({ files: [f] })) await navigator.share({ files: [f] });
  else await writeDoc(name, blob);
}

// silent=true: save straight to the Documents folder, no sheet
export async function save(name, data, mime = 'application/octet-stream', silent = false) {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
  if (silent) {
    try { await writeDoc(name, blob); } catch (e) { toast('Save failed: ' + e.message, 4000); }
    return;
  }
  const { box, close } = sheet(`<p><b id="fn"></b></p><p class="muted">${kb(blob.size)}</p><div class="row"><button class="p" id="sv">Save</button><button id="sh">Share</button><button id="cl">Close</button></div>`);
  box.querySelector('#fn').textContent = name;
  box.querySelector('#sv').onclick = async () => {
    try { await writeDoc(name, blob); toast(native() ? 'Saved to Documents/AllInOneDocs' : 'Saved', 3500); close(); }
    catch (e) { toast('Save failed: ' + e.message, 4000); }
  };
  box.querySelector('#sh').onclick = async () => {
    try { await shareBlob(name, blob); } catch (e) { if (!/cancel|abort/i.test(e.message)) toast('Share failed: ' + e.message, 4000); }
  };
  box.querySelector('#cl').onclick = close;
}

/* ---------- pdf.js ---------- */
let _pj;
export async function pdfjs() {
  if (!_pj) {
    const [m, w] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.js?url')]);
    const P = m.getDocument ? m : m.default;
    P.GlobalWorkerOptions.workerSrc = w.default;
    _pj = P;
  }
  return _pj;
}

// renders every page to a JPEG and rebuilds a PDF (used for compress + unlock)
export async function rasterPdf(doc, scale, q, onPage) {
  const out = await PDFDocument.create();
  for (let n = 1; n <= doc.numPages; n++) {
    onPage?.(n, doc.numPages);
    const pg = await doc.getPage(n), base = pg.getViewport({ scale: 1 }), vp = pg.getViewport({ scale });
    const c = document.createElement('canvas');
    c.width = Math.ceil(vp.width);
    c.height = Math.ceil(vp.height);
    const x = c.getContext('2d');
    x.fillStyle = '#fff';
    x.fillRect(0, 0, c.width, c.height);
    await pg.render({ canvasContext: x, viewport: vp }).promise;
    const jb = new Uint8Array(await (await toBlob(c, 'image/jpeg', q)).arrayBuffer());
    const im = await out.embedJpg(jb);
    const p = out.addPage([base.width, base.height]);
    p.drawImage(im, { x: 0, y: 0, width: base.width, height: base.height });
    c.width = c.height = 0;
  }
  return out.save();
}

/* ---------- scan helpers (Scanner + ID Card) ---------- */
export function bgData(src) {
  let c = src;
  for (let k = 0; k < 4 && c.width > 8 && c.height > 8; k++) {
    const n = document.createElement('canvas');
    n.width = c.width >> 1;
    n.height = c.height >> 1;
    n.getContext('2d').drawImage(c, 0, 0, n.width, n.height);
    c = n;
  }
  const b = document.createElement('canvas');
  b.width = src.width;
  b.height = src.height;
  const x = b.getContext('2d');
  x.imageSmoothingQuality = 'high';
  x.drawImage(c, 0, 0, b.width, b.height);
  return x.getImageData(0, 0, b.width, b.height).data;
}

export function filter(src, mode) {
  const o = document.createElement('canvas');
  o.width = src.width; o.height = src.height;
  const x = o.getContext('2d');
  x.drawImage(src, 0, 0);
  if (mode === 'orig') return o;
  const im = x.getImageData(0, 0, o.width, o.height), d = im.data, bd = bgData(src);
  for (let i = 0; i < d.length; i += 4) {
    const L = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    const B = 0.299 * bd[i] + 0.587 * bd[i + 1] + 0.114 * bd[i + 2] || 1;
    if (mode === 'bw') {
      d[i] = d[i + 1] = d[i + 2] = L / B > 0.88 ? 255 : 0;
    } else if (mode === 'gray') {
      d[i] = d[i + 1] = d[i + 2] = Math.min(255, (L / B) * 240);
    } else {
      const f = 240 / B;
      for (let k = 0; k < 3; k++) d[i + k] = Math.min(255, Math.max(0, (d[i + k] * f - 128) * 1.2 + 128));
    }
  }
  x.putImageData(im, 0, 0);
  return o;
}

export async function fileToCanvas(f, max = 2200) {
  const im = await loadImg(fileURL(f));
  const k = Math.min(1, max / Math.max(im.naturalWidth, im.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(im.naturalWidth * k);
  c.height = Math.round(im.naturalHeight * k);
  c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
  return c;
}

// finds the 4 corners of the page / card (the biggest bright area). Returns null if unsure.
export function autoCorners(src) {
  const k = Math.min(1, 360 / Math.max(src.width, src.height));
  const w = Math.round(src.width * k), h = Math.round(src.height * k);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d');
  x.drawImage(src, 0, 0, w, h);
  const d = x.getImageData(0, 0, w, h).data, n = w * h;
  const g = new Uint8Array(n), hist = new Array(256).fill(0);
  for (let i = 0; i < n; i++) { const v = (0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]) | 0; g[i] = v; hist[v]++; }
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sB = 0, wB = 0, best = 0, thr = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = n - wB;
    if (!wF) break;
    sB += t * hist[t];
    const mB = sB / wB, mF = (sum - sB) / wF, v = wB * wF * (mB - mF) * (mB - mF);
    if (v > best) { best = v; thr = t; }
  }
  const lab = new Uint8Array(n), st = new Int32Array(n);
  let bestA = 0, bestP = null;
  for (let s = 0; s < n; s++) {
    if (lab[s] || g[s] <= thr) continue;
    let sp = 0, a = 0, mnS = 1e9, mxS = -1e9, mxD = -1e9, mnD = 1e9;
    const P = {};
    st[sp++] = s; lab[s] = 1;
    while (sp) {
      const p = st[--sp], px = p % w, py = (p / w) | 0;
      a++;
      const s1 = px + py, s2 = px - py;
      if (s1 < mnS) { mnS = s1; P.tl = [px, py]; }
      if (s1 > mxS) { mxS = s1; P.br = [px, py]; }
      if (s2 > mxD) { mxD = s2; P.tr = [px, py]; }
      if (s2 < mnD) { mnD = s2; P.bl = [px, py]; }
      if (px > 0 && !lab[p - 1] && g[p - 1] > thr) { lab[p - 1] = 1; st[sp++] = p - 1; }
      if (px < w - 1 && !lab[p + 1] && g[p + 1] > thr) { lab[p + 1] = 1; st[sp++] = p + 1; }
      if (py > 0 && !lab[p - w] && g[p - w] > thr) { lab[p - w] = 1; st[sp++] = p - w; }
      if (py < h - 1 && !lab[p + w] && g[p + w] > thr) { lab[p + w] = 1; st[sp++] = p + w; }
    }
    if (a > bestA) { bestA = a; bestP = P; }
  }
  const ratio = bestA / n;
  if (!bestP || ratio < 0.12 || ratio > 0.97) return null;
  return [bestP.tl, bestP.tr, bestP.br, bestP.bl].map(([px, py]) => ({ x: px / k, y: py / k }));
}

// straightens the quad [tl,tr,br,bl] into a flat rectangle
export function warp(src, [tl, tr, br, bl]) {
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  let W = Math.round((dist(tl, tr) + dist(bl, br)) / 2), H = Math.round((dist(tl, bl) + dist(tr, br)) / 2);
  const m = Math.min(1, 2400 / Math.max(W, H));
  W = Math.max(2, Math.round(W * m)); H = Math.max(2, Math.round(H * m));
  const sw = src.width, sh = src.height, sd = src.getContext('2d').getImageData(0, 0, sw, sh).data;
  const o = document.createElement('canvas');
  o.width = W; o.height = H;
  const ox = o.getContext('2d'), out = ox.createImageData(W, H), od = out.data;
  for (let j = 0; j < H; j++) {
    const v = j / (H - 1);
    const lx = tl.x + (bl.x - tl.x) * v, ly = tl.y + (bl.y - tl.y) * v;
    const rx = tr.x + (br.x - tr.x) * v, ry = tr.y + (br.y - tr.y) * v;
    for (let i = 0; i < W; i++) {
      const u = i / (W - 1), px = lx + (rx - lx) * u, py = ly + (ry - ly) * u;
      const x0 = Math.max(0, Math.min(sw - 2, Math.floor(px))), y0 = Math.max(0, Math.min(sh - 2, Math.floor(py)));
      const fx = Math.max(0, Math.min(1, px - x0)), fy = Math.max(0, Math.min(1, py - y0));
      const a = (y0 * sw + x0) * 4, b = a + 4, c = a + sw * 4, e = c + 4, p = (j * W + i) * 4;
      for (let q = 0; q < 4; q++) od[p + q] = sd[a + q] * (1 - fx) * (1 - fy) + sd[b + q] * fx * (1 - fy) + sd[c + q] * (1 - fx) * fy + sd[e + q] * fx * fy;
    }
  }
  ox.putImageData(out, 0, 0);
  return o;
}

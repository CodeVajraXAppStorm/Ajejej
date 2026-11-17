import SignaturePad from 'signature_pad';
import Cropper from 'cropperjs';
import 'cropperjs/dist/cropper.css';
import { pick, fileURL, toast, sigs, addSig, delSig, bgData } from '../util.js';

function trim(c) {
  const x = c.getContext('2d'), w = c.width, h = c.height, d = x.getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = 0, y1 = 0;
  for (let y = 0; y < h; y++)
    for (let i = 0; i < w; i++)
      if (d[(y * w + i) * 4 + 3] > 20) {
        if (i < x0) x0 = i; if (i > x1) x1 = i;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
  if (x1 < x0) return c;
  const p = 6, o = document.createElement('canvas'), cw = x1 - x0 + 1, ch = y1 - y0 + 1;
  o.width = cw + p * 2;
  o.height = ch + p * 2;
  o.getContext('2d').drawImage(c, x0, y0, cw, ch, p, p, cw, ch);
  return o;
}

function removeBg(src, T, ink) {
  const w = src.width, h = src.height, o = document.createElement('canvas');
  o.width = w; o.height = h;
  const x = o.getContext('2d');
  x.drawImage(src, 0, 0);
  const im = x.getImageData(0, 0, w, h), d = im.data, bd = bgData(src);
  const k = ink === 'orig' ? null : [1, 3, 5].map((i) => parseInt(ink.substr(i, 2), 16));
  for (let i = 0; i < d.length; i += 4) {
    const L = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    const B = 0.299 * bd[i] + 0.587 * bd[i + 1] + 0.114 * bd[i + 2] || 1;
    if (k) { d[i] = k[0]; d[i + 1] = k[1]; d[i + 2] = k[2]; }
    d[i + 3] = 255 * Math.min(1, Math.max(0, (T - L / B) / 0.25));
  }
  x.putImageData(im, 0, 0);
  return trim(o);
}

export default function (root) {
  root.innerHTML = `
  <div class="row"><button class="p" id="tD">Draw</button><button id="tP">From Photo</button></div>
  <div id="draw">
    <canvas class="sg" id="pad"></canvas>
    <div class="row"><select id="ink"><option value="#000000">Black</option><option value="#0a2a8a">Blue</option></select><button id="clr">Clear</button><button class="p" id="sd">Save signature</button></div>
  </div>
  <div id="photo" hidden>
    <div class="row"><button id="cam">Camera</button><button id="gal">Gallery</button></div>
    <div id="cw" hidden><div class="cropbox"><img id="ci"></div><div class="row"><button class="p" id="go">Crop and remove background</button></div></div>
    <div id="rw" hidden>
      <div class="chk"><canvas id="out"></canvas></div>
      <div class="row">Sensitivity <input type="range" id="th" min="40" max="95" value="75"></div>
      <div class="row"><select id="ink2"><option value="orig">Original colour</option><option value="#000000">Black</option><option value="#0a2a8a">Blue</option></select><button class="p" id="sp">Save signature</button></div>
    </div>
  </div>
  <h3>Saved signatures</h3><div id="list"></div>`;
  const $ = (s) => root.querySelector(s);

  const cv = $('#pad'), r = window.devicePixelRatio || 1;
  cv.width = cv.offsetWidth * r;
  cv.height = cv.offsetHeight * r;
  cv.getContext('2d').scale(r, r);
  const pad = new SignaturePad(cv, { penColor: '#000000', minWidth: 1, maxWidth: 3 });
  $('#ink').onchange = (e) => (pad.penColor = e.target.value);
  $('#clr').onclick = () => pad.clear();

  $('#tD').onclick = () => { $('#draw').hidden = false; $('#photo').hidden = true; };
  $('#tP').onclick = () => { $('#draw').hidden = true; $('#photo').hidden = false; };

  const renderList = () => {
    const l = $('#list');
    l.innerHTML = sigs().length ? '' : '<p class="muted">No saved signatures yet.</p>';
    sigs().forEach((s, i) => {
      const d = document.createElement('div');
      d.className = 'card';
      d.innerHTML = `<div class="thumb"><img src="${s}"></div><div class="row"><button class="d">Delete</button></div>`;
      d.querySelector('button').onclick = () => { delSig(i); renderList(); };
      l.append(d);
    });
  };
  renderList();

  $('#sd').onclick = () => {
    if (pad.isEmpty()) return toast('Please sign first');
    addSig(trim(cv).toDataURL('image/png'));
    pad.clear();
    renderList();
    toast('Signature saved');
  };

  let cr, base, res;
  const choose = async (cam) => {
    const [f] = await pick('image/*', false, cam);
    if (!f) return;
    cr?.destroy();
    const ci = $('#ci');
    ci.onload = () => { cr = new Cropper(ci, { viewMode: 1, autoCropArea: 0.9, background: false }); };
    ci.src = fileURL(f);
    $('#cw').hidden = false;
    $('#rw').hidden = true;
  };
  $('#cam').onclick = () => choose(true);
  $('#gal').onclick = () => choose(false);

  const proc = () => {
    res = removeBg(base, $('#th').value / 100, $('#ink2').value);
    const o = $('#out');
    o.width = res.width;
    o.height = res.height;
    o.getContext('2d').drawImage(res, 0, 0);
  };
  $('#go').onclick = () => {
    if (!cr) return;
    base = cr.getCroppedCanvas({ maxWidth: 1000, maxHeight: 1000 });
    $('#cw').hidden = true;
    $('#rw').hidden = false;
    proc();
  };
  $('#th').oninput = () => base && proc();
  $('#ink2').onchange = () => base && proc();
  $('#sp').onclick = () => {
    if (!res) return;
    addSig(res.toDataURL('image/png'));
    renderList();
    toast('Signature saved');
  };
                               }

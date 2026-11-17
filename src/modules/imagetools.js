import Cropper from 'cropperjs';
import 'cropperjs/dist/cropper.css';
import { pick, fileURL, save, toast, toBlob, baseName } from '../util.js';

const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

// makes the plain background (connected to the image border) transparent
function clearBg(c, tol) {
  const x = c.getContext('2d'), w = c.width, h = c.height, im = x.getImageData(0, 0, w, h), d = im.data;
  let R = 0, G = 0, B = 0;
  [0, w - 1, (h - 1) * w, h * w - 1].forEach((i) => { R += d[i * 4]; G += d[i * 4 + 1]; B += d[i * 4 + 2]; });
  R /= 4; G /= 4; B /= 4;
  const near = (i) => { const a = d[i * 4] - R, b = d[i * 4 + 1] - G, e = d[i * 4 + 2] - B; return a * a + b * b + e * e < tol * tol; };
  const seen = new Uint8Array(w * h), st = [];
  const push = (i) => { if (!seen[i] && near(i)) { seen[i] = 1; st.push(i); } };
  for (let i = 0; i < w; i++) { push(i); push((h - 1) * w + i); }
  for (let j = 0; j < h; j++) { push(j * w); push(j * w + w - 1); }
  while (st.length) {
    const i = st.pop(), px = i % w;
    d[i * 4 + 3] = 0;
    if (px > 0) push(i - 1);
    if (px < w - 1) push(i + 1);
    if (i >= w) push(i - w);
    if (i < w * (h - 1)) push(i + w);
  }
  x.putImageData(im, 0, 0);
}

export default function (root) {
  root.innerHTML = `
  <div class="row"><button class="p" id="pk">Select Image</button><button id="cm">Camera</button></div>
  <div id="w" hidden>
    <div class="cropbox"><img id="ci"></div>
    <p class="muted" id="inf"></p>
    <div class="card">
      <div class="row">Width <input id="W" type="number" style="width:90px"> Height <input id="H" type="number" style="width:90px"></div>
      <label class="muted"><input type="checkbox" id="lk" checked> Lock aspect ratio</label>
      <div class="row">Format <select id="fm"><option value="image/jpeg">JPG</option><option value="image/png">PNG</option><option value="image/webp">WebP</option></select></div>
      <div class="row">Quality <input type="range" id="q" min="10" max="100" value="85"></div>
      <div class="row">Target size (KB, optional) <input id="kb" type="number" style="width:100px" placeholder="e.g. 200"></div>
      <label class="muted"><input type="checkbox" id="rb"> Remove plain background (saves as PNG)</label>
      <div class="row">Background tolerance <input type="range" id="tl" min="10" max="90" value="40"></div>
      <button class="p" id="go">Process</button>
    </div>
    <div id="res"></div>
  </div>`;
  const $ = (s) => root.querySelector(s);
  let cr, name = 'image', ratio = 1;

  const choose = async (cam) => {
    const [f] = await pick('image/*', false, cam);
    if (!f) return;
    name = baseName(f.name || 'image');
    cr?.destroy();
    $('#res').innerHTML = '';
    const ci = $('#ci');
    ci.onload = () => {
      $('#inf').textContent = `Original: ${ci.naturalWidth}×${ci.naturalHeight} px • ${(f.size / 1024).toFixed(0)} KB`;
      cr = new Cropper(ci, {
        viewMode: 1, autoCropArea: 1, background: false,
        crop: (e) => { ratio = e.detail.height / e.detail.width; },
        ready: sync, cropend: sync
      });
    };
    ci.src = fileURL(f);
    $('#w').hidden = false;
  };
  const sync = () => {
    const d = cr.getData();
    $('#W').value = Math.round(d.width);
    $('#H').value = Math.round(d.height);
  };
  $('#pk').onclick = () => choose(false);
  $('#cm').onclick = () => choose(true);
  $('#W').oninput = (e) => { if ($('#lk').checked) $('#H').value = Math.round(e.target.value * ratio); };
  $('#H').oninput = (e) => { if ($('#lk').checked) $('#W').value = Math.round(e.target.value / ratio); };

  $('#go').onclick = async () => {
    if (!cr) return;
    const rb = $('#rb').checked, fm = rb ? 'image/png' : $('#fm').value, c = cr.getCroppedCanvas();
    const w = +$('#W').value || c.width, h = +$('#H').value || c.height;
    const o = document.createElement('canvas');
    o.width = w; o.height = h;
    const x = o.getContext('2d');
    x.imageSmoothingQuality = 'high';
    if (fm === 'image/jpeg') { x.fillStyle = '#fff'; x.fillRect(0, 0, w, h); }
    x.drawImage(c, 0, 0, w, h);
    if (rb) clearBg(o, +$('#tl').value);

    let blob = await toBlob(o, fm, $('#q').value / 100);
    const target = (+$('#kb').value || 0) * 1024;
    if (target) {
      if (fm === 'image/png') toast('Choose JPG or WebP for a KB target', 3500);
      else {
        let lo = 0.05, hi = 1;
        for (let i = 0; i < 8; i++) {
          const q = (lo + hi) / 2;
          (await toBlob(o, fm, q)).size > target ? (hi = q) : (lo = q);
        }
        blob = await toBlob(o, fm, lo);
        if (blob.size > target) toast('Cannot reach that size. Reduce the pixel dimensions.', 4000);
      }
    }
    const ext = EXT[fm];
    $('#res').innerHTML = `<div class="card chk" style="display:block"><img src="${URL.createObjectURL(blob)}" style="max-height:220px"></div><p>${w}×${h} px • ${(blob.size / 1024).toFixed(1)} KB</p><button class="p" id="sv">Save / Share</button>`;
    $('#sv').onclick = () => save(`${name}_${w}x${h}.${ext}`, blob);
  };
}

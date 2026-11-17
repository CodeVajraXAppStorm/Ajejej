import Cropper from 'cropperjs';
import 'cropperjs/dist/cropper.css';
import { PDFDocument, rgb } from 'pdf-lib';
import { pick, fileURL, toast, save, toBlob, filter, fileToCanvas, autoCorners, warp } from '../util.js';

const got = { front: null, back: null }; // module-level: kept while you switch tools

function slot(box, key, title) {
  box.className = 'card';
  box.innerHTML = `<b>${title}</b>
  <div class="row"><button class="p" data-a="cam">Camera</button><button data-a="gal">Gallery</button></div>
  <div data-w="crop" hidden><div class="cropbox"><img></div><div class="row"><button class="p" data-a="auto">Auto detect</button><button data-a="man">Manual crop</button></div></div>
  <div data-w="res" hidden><canvas></canvas><div class="row"><select><option value="magic">Magic colour</option><option value="orig">Original</option><option value="gray">Grayscale</option><option value="bw">Black &amp; White</option></select></div></div>`;
  const $ = (s) => box.querySelector(s);
  let cr, src, crop;

  const show = () => {
    const r = filter(crop, $('select').value);
    got[key] = r;
    const cv = $('canvas');
    cv.width = r.width; cv.height = r.height;
    cv.getContext('2d').drawImage(r, 0, 0);
    $('[data-w=res]').hidden = false;
    $('[data-w=crop]').hidden = true;
  };

  const choose = async (cam) => {
    const [f] = await pick('image/*', false, cam);
    if (!f) return;
    cr?.destroy();
    const img = $('img');
    img.onload = () => { cr = new Cropper(img, { viewMode: 1, autoCropArea: 1, background: false }); };
    img.src = fileURL(f);
    src = await fileToCanvas(f);
    $('[data-w=crop]').hidden = false;
    $('[data-w=res]').hidden = true;
  };
  $('[data-a=cam]').onclick = () => choose(true);
  $('[data-a=gal]').onclick = () => choose(false);
  $('[data-a=auto]').onclick = () => {
    if (!src) return;
    const c = autoCorners(src);
    if (!c) return toast('Could not detect the card edges. Adjust the box and use Manual crop.', 4500);
    crop = warp(src, c);
    show();
  };
  $('[data-a=man]').onclick = () => {
    if (!cr) return;
    crop = cr.getCroppedCanvas({ maxWidth: 1600, maxHeight: 1600 });
    show();
  };
  $('select').onchange = () => crop && show();

  if (got[key]) {
    const cv = $('canvas');
    cv.width = got[key].width; cv.height = got[key].height;
    cv.getContext('2d').drawImage(got[key], 0, 0);
    $('[data-w=res]').hidden = false;
  }
}

export default function (root) {
  root.innerHTML = `
  <p class="muted">Scan the front and the back of the card. Both are placed one below the other on a single A4 page.</p>
  <div id="f"></div><div id="b"></div>
  <div class="card">
    <div class="row">Size on page <select id="sz"><option value="actual">Actual card size</option><option value="large">Large</option></select></div>
    <button class="p" id="mk">Create A4 PDF</button>
  </div>`;
  const $ = (s) => root.querySelector(s);
  slot($('#f'), 'front', 'Front side');
  slot($('#b'), 'back', 'Back side');

  $('#mk').onclick = async () => {
    if (!got.front || !got.back) return toast('Scan both the front and the back first', 3500);
    toast('Creating PDF…', 6000);
    const W = 595.28, H = 841.89, cw = $('#sz').value === 'actual' ? 242.6 : 400;
    const pdf = await PDFDocument.create(), pg = pdf.addPage([W, H]);
    let y = H - 90;
    for (const c of [got.front, got.back]) {
      const h = (cw * c.height) / c.width, x = (W - cw) / 2;
      const im = await pdf.embedJpg(new Uint8Array(await (await toBlob(c, 'image/jpeg', 0.92)).arrayBuffer()));
      y -= h;
      pg.drawImage(im, { x, y, width: cw, height: h });
      pg.drawRectangle({ x, y, width: cw, height: h, borderColor: rgb(0.75, 0.75, 0.75), borderWidth: 0.5 });
      y -= 50;
    }
    save('id_card_' + Date.now() + '.pdf', await pdf.save(), 'application/pdf');
  };
  }

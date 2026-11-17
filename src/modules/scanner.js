import Cropper from 'cropperjs';
import 'cropperjs/dist/cropper.css';
import { PDFDocument } from 'pdf-lib';
import { pick, fileURL, toast, save, toBlob, filter, fileToCanvas, autoCorners, warp } from '../util.js';

const pages = []; // module-level: scanned pages are kept here

export default function (root) {
  root.innerHTML = `
  <div class="row"><button class="p" id="cam">Scan with Camera</button><button id="gal">From Gallery</button></div>
  <div id="cw" hidden><div class="cropbox"><img id="ci"></div><div class="row"><button class="p" id="au">Auto detect</button><button id="go">Manual crop</button></div><p class="muted">Auto detect finds the paper edges. If it misses, adjust the box and tap Manual crop.</p></div>
  <div id="fw" hidden>
    <canvas id="pv" style="border-radius:4px"></canvas>
    <div class="row"><select id="fm"><option value="magic">Magic colour</option><option value="orig">Original</option><option value="gray">Grayscale</option><option value="bw">Black &amp; White</option></select><button class="p" id="add">Add page</button></div>
  </div>
  <div id="ls"></div>
  <div class="row" id="fin" hidden><button class="p" id="pdf">Create PDF</button><button class="d" id="clr">Clear all</button></div>`;
  const $ = (s) => root.querySelector(s);
  let cr, crop, res, srcC;

  const renderList = () => {
    const ls = $('#ls');
    ls.innerHTML = pages.length ? '<h3>Scanned pages. Tap a scan button above to add another.</h3>' : '';
    pages.forEach((c, i) => {
      const d = document.createElement('div');
      d.className = 'card';
      d.innerHTML = `<img src="${c.toDataURL('image/jpeg', 0.3)}" style="height:90px"> <span class="muted">Page ${i + 1}</span> <button class="d">Remove</button>`;
      d.querySelector('button').onclick = () => { pages.splice(i, 1); renderList(); };
      ls.append(d);
    });
    $('#fin').hidden = !pages.length;
  };
  renderList();

  const choose = async (cam) => {
    const [f] = await pick('image/*', false, cam);
    if (!f) return;
    cr?.destroy();
    const ci = $('#ci');
    ci.onload = () => { cr = new Cropper(ci, { viewMode: 1, autoCropArea: 1, background: false }); };
    ci.src = fileURL(f);
    srcC = await fileToCanvas(f);
    $('#cw').hidden = false;
    $('#fw').hidden = true;
  };
  $('#cam').onclick = () => choose(true);
  $('#gal').onclick = () => choose(false);

  const preview = () => {
    res = filter(crop, $('#fm').value);
    const pv = $('#pv');
    pv.width = res.width;
    pv.height = res.height;
    pv.getContext('2d').drawImage(res, 0, 0);
  };
  const next = () => { $('#cw').hidden = true; $('#fw').hidden = false; preview(); };

  $('#au').onclick = () => {
    if (!srcC) return;
    const c = autoCorners(srcC);
    if (!c) return toast('Could not detect the edges. Adjust the box and use Manual crop.', 4500);
    crop = warp(srcC, c);
    next();
  };
  $('#go').onclick = () => {
    if (!cr) return;
    crop = cr.getCroppedCanvas({ maxWidth: 1800, maxHeight: 2400 });
    next();
  };
  $('#fm').onchange = () => crop && preview();
  $('#add').onclick = () => {
    pages.push(res);
    $('#fw').hidden = true;
    renderList();
    toast('Page added. Scan another page or create the PDF.', 3500);
  };
  $('#clr').onclick = () => { pages.length = 0; renderList(); };
  $('#pdf').onclick = async () => {
    toast('Creating PDF…', 6000);
    const pdf = await PDFDocument.create();
    for (const c of pages) {
      const b = new Uint8Array(await (await toBlob(c, 'image/jpeg', 0.85)).arrayBuffer());
      const im = await pdf.embedJpg(b);
      const pg = pdf.addPage([595, (595 * c.height) / c.width]);
      pg.drawImage(im, { x: 0, y: 0, width: 595, height: pg.getHeight() });
    }
    save('scan_' + Date.now() + '.pdf', await pdf.save(), 'application/pdf');
  };
}

import JSZip from 'jszip';
import { pick, save, toast } from '../util.js';

export default function (root) {
  root.innerHTML = `
  <div class="card"><b>Create ZIP</b><div class="row"><button class="p" id="mk">Select Files</button></div></div>
  <div class="card"><b>Extract ZIP</b><div class="row"><button class="p" id="ex">Select ZIP</button></div><div id="ls"></div></div>`;
  const $ = (s) => root.querySelector(s);

  $('#mk').onclick = async () => {
    const fs = await pick('*/*', true);
    if (!fs.length) return;
    toast('Creating ZIP…', 5000);
    const z = new JSZip();
    fs.forEach((f) => z.file(f.name, f));
    save('archive_' + Date.now() + '.zip', await z.generateAsync({ type: 'blob', compression: 'DEFLATE' }));
  };

  $('#ex').onclick = async () => {
    const [f] = await pick('.zip,application/zip');
    if (!f) return;
    try {
      const z = await JSZip.loadAsync(f);
      const names = Object.keys(z.files).filter((n) => !z.files[n].dir);
      const ls = $('#ls');
      ls.innerHTML = names.length ? '' : '<p class="muted">This ZIP is empty.</p>';
      names.forEach((n) => {
        const d = document.createElement('div');
        d.className = 'row';
        const s = document.createElement('span');
        s.textContent = n;
        s.style.flex = '1';
        s.style.overflowWrap = 'anywhere';
        const b = document.createElement('button');
        b.textContent = 'Save';
        b.onclick = async () => save(n.split('/').pop(), await z.files[n].async('blob'));
        d.append(s, b);
        ls.append(d);
      });
    } catch (e) { toast('Could not open ZIP: ' + e.message, 4000); }
  };
}

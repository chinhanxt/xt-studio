/**
 * THƯ VIỆN — ảnh (thư mục storyboard) và video trong thư mục lưu: lọc, chọn nhiều để ghép / bỏ vào Thùng rác, đăng FB.
 */
(function () {
  'use strict';
  const { api, $, escapeHtml, fileUrl, fmtTime, toast } = window.App;
  const isImg = p => files.find(f => f.localPath === p)?.kind === 'image';
  if (!api) return;

  const grid = $('library-grid');
  const btnMerge = $('lib-merge');
  const btnTrash = $('lib-trash');
  let files = [];
  let filter = 'all';
  let prj = '';
  let fileProject = {}; // đường dẫn file → dự án của task tạo ra nó
  let sel = []; // đường dẫn theo thứ tự bấm chọn = thứ tự ghép
  const PAGE = 24;
  let page = 1;
  const pager = document.createElement('div');
  pager.id = 'lib-pager';
  pager.className = 'xt-pager';
  grid.after(pager);

  const mb = n => n ? `${(n / 1048576).toFixed(1)} MB` : '';

  function render() {
    const inPrj = f => !prj || fileProject[f.localPath] === prj;
    const all = files.filter(f => inPrj(f) && (filter === 'all' || f.kind === filter));
    const pages = Math.max(1, Math.ceil(all.length / PAGE));
    page = Math.min(Math.max(1, page), pages);
    const shown = all.slice((page - 1) * PAGE, page * PAGE);
    renderPager(pages, all.length);
    $('lib-filters').querySelectorAll('[data-f]').forEach(b => {
      b.classList.toggle('active', b.dataset.f === filter);
      b.lastElementChild.textContent = files.filter(f => inPrj(f) && (b.dataset.f === 'all' || f.kind === b.dataset.f)).length;
    });
    const vids = sel.filter(p => files.find(f => f.localPath === p)?.kind === 'video');
    $('lib-sel').textContent = sel.length ? `Đã chọn ${sel.length}` : '';
    btnMerge.disabled = vids.length < 2;
    btnTrash.disabled = !sel.length;
    $('lib-asset').disabled = !sel.some(isImg);
    grid.innerHTML = shown.length ? shown.map(f => {
      const k = sel.indexOf(f.localPath);
      const src = fileUrl(f.localPath);
      return `
      <div class="video-card${k >= 0 ? ' selected' : ''}" data-path="${escapeHtml(f.localPath)}">
        <input type="checkbox" class="lib-check"${k >= 0 ? ' checked' : ''} title="Chọn">
        ${f.kind === 'video' ? `<video class="lib-media" src="${src}#t=0.1" preload="metadata" muted></video>` : `<img class="lib-media" src="${src}" alt="" loading="lazy">`}
        <div class="video-card-title" title="${escapeHtml(f.filename)}">${escapeHtml(f.filename)}</div>
        <div class="video-card-meta">${fmtTime(f.timestamp)}${f.size ? ` · ${mb(f.size)}` : ''}${k >= 0 && f.kind === 'video' ? ` · thứ tự ghép ${vids.indexOf(f.localPath) + 1}` : ''}</div>
        <div class="row">
          <button class="btn-ghost btn-sm" data-act="reveal">Mở</button>
          ${f.kind === 'video' ? '<button class="btn-ghost btn-sm" data-act="fb">Đăng FB Reels</button>' : ''}
        </div>
      </div>`;
    }).join('') : `<div class="queue-empty" style="grid-column: 1 / -1;"><strong>Chưa có ${filter === 'image' ? 'ảnh' : filter === 'video' ? 'video' : 'file'} nào</strong>Ảnh và video làm xong sẽ nằm ở thư mục lưu.</div>`;
  }

  // Thanh phân trang: ‹ 1 2 … 5 › — chỉ hiện khi nhiều hơn 1 trang
  function renderPager(pages, total) {
    if (pages <= 1) { pager.innerHTML = ''; pager.hidden = true; return; }
    pager.hidden = false;
    const nums = [];
    for (let i = 1; i <= pages; i++) {
      if (i === 1 || i === pages || Math.abs(i - page) <= 1) nums.push(i);
      else if (nums[nums.length - 1] !== '…') nums.push('…');
    }
    const from = (page - 1) * PAGE + 1, to = Math.min(total, page * PAGE);
    pager.innerHTML = `<span class="xt-pager-info">${from}–${to} / ${total}</span><div class="xt-pager-btns">`
      + `<button type="button" data-pg="${page - 1}"${page === 1 ? ' disabled' : ''} title="Trang trước"><svg class="xi" viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg></button>`
      + nums.map(n => n === '…' ? '<span class="xt-pager-gap">…</span>' : `<button type="button" data-pg="${n}"${n === page ? ' class="on"' : ''}>${n}</button>`).join('')
      + `<button type="button" data-pg="${page + 1}"${page === pages ? ' disabled' : ''} title="Trang sau"><svg class="xi" viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></svg></button></div>`;
  }
  pager.addEventListener('click', e => {
    const b = e.target.closest('[data-pg]');
    if (!b || b.disabled) return;
    page = Number(b.dataset.pg);
    render();
    document.querySelector('.main-stage')?.scrollTo({ top: 0, behavior: 'smooth' });
  });

  async function load() {
    const [list, t] = await Promise.all([api.listLibrary(), api.listTasks()]);
    files = Array.isArray(list) ? list : [];
    fileProject = {};
    for (const task of t?.tasks || []) for (const f of task.files) fileProject[f] = task.project || 'default';
    sel = sel.filter(p => files.some(f => f.localPath === p));
    render();
    api.getSettings().then(s => { if (s?.outputDir) $('lib-path').textContent = s.outputDir; });
  }

  grid.addEventListener('click', e => {
    const card = e.target.closest('[data-path]');
    if (!card) return;
    const p = card.dataset.path;
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'reveal') return api.revealFile(p);
    if (act === 'fb') return window.App.selectVideoForFb(p);
    if (e.target.tagName === 'VIDEO' && !e.target.controls) { e.target.controls = true; return; }
    if (e.target.tagName === 'VIDEO') return;
    sel = sel.includes(p) ? sel.filter(x => x !== p) : sel.concat(p);
    render();
  });

  $('lib-filters').addEventListener('click', e => {
    const b = e.target.closest('[data-f]');
    if (b) { filter = b.dataset.f; page = 1; render(); }
  });

  btnMerge.addEventListener('click', () => {
    const vids = sel.filter(p => files.find(f => f.localPath === p)?.kind === 'video');
    window.App.openMerge(vids, () => { sel = []; load(); });
  });
  // Lọc dự án: '' = tất cả (kể cả video ghép, không thuộc task nào)
  window.App.onStudio(d => {
    $('lib-prj').innerHTML = '<option value="">Mọi dự án</option>' + d.projects.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
    if (!d.projects.some(p => p.id === prj)) prj = '';
    $('lib-prj').value = prj;
    render();
  });
  $('lib-prj').addEventListener('change', e => { prj = e.target.value; page = 1; render(); });

  // Ảnh đã chọn → Tư liệu (người mẫu / luân phiên / nhân vật): tạo 1 gương mặt ưng ý rồi dùng lại cho mọi tab
  window.App.onStudio(d => {
    $('lib-asset').innerHTML = '<option value="">Lưu vào Tư liệu…</option>'
      + `<option value="model">Người mẫu cố định (${d.model.images.length}/3)</option>`
      + `<option value="rotate">Ảnh luân phiên (${d.rotate.images.length}/20)</option>`
      + '<option value="new">Nhân vật mới…</option>'
      + d.characters.map(c => `<option value="${c.id}">Nhân vật: ${escapeHtml(c.name)} (${c.images.length}/3)</option>`).join('');
  });
  $('lib-asset').addEventListener('change', async e => {
    const to = e.target.value;
    e.target.value = '';
    if (!to) return;
    const name = to === 'new' ? await window.App.askName('Tên nhân vật (viết đúng như trong prompt)') : '';
    if (to === 'new' && !name) return;
    const imgs = sel.filter(isImg);
    const d = window.App.studioData();
    const ch = d.characters.find(c => c.id === to);
    const cur = to === 'model' || to === 'rotate' ? d[to].images : ch ? ch.images : [];
    const room = (to === 'rotate' ? 20 : 3) - cur.length;
    if (room <= 0) return toast('Mục này đã đủ ảnh — bỏ bớt ở tab Tư liệu.', 'warn');
    const added = [];
    for (const p of imgs.slice(0, room)) { const f = await api.addStudioImage({ filePath: p }); if (f) added.push(f); }
    const next = cur.concat(added);
    const now = window.App.studioData(); // đọc lại, phòng dữ liệu đổi trong lúc chép ảnh
    await api.saveStudio(to === 'model' || to === 'rotate' ? { [to]: { ...now[to], images: next } }
      : { characters: to === 'new' ? [...now.characters, { id: '', name, images: next }] : now.characters.map(c => (c.id === to ? { ...c, images: next } : c)) });
    toast(`Đã lưu ${added.length} ảnh vào Tư liệu${imgs.length > added.length ? ` (bỏ ${imgs.length - added.length} ảnh vì quá số ảnh tối đa)` : ''}.`, added.length ? 'ok' : 'warn');
  });

  btnTrash.addEventListener('click', async () => {
    if (!confirm(`Bỏ ${sel.length} file đã chọn vào Thùng rác?`)) return;
    const n = await api.trashFiles(sel);
    toast(`Đã bỏ ${n} file vào Thùng rác.`, n ? 'ok' : 'warn');
    sel = [];
    load();
  });

  $('lib-open').addEventListener('click', () => api.openOutputFolder());
  api.onVideoCompleted(load);
  document.addEventListener('app:tab', e => { if (e.detail === 'tab-library') load(); });
})();

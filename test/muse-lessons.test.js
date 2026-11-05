// Kiểm các bài học Muse chuyển từ EM BÔNG sang xT studio — chạy: npm test (không cần tài khoản Muse thật)
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const { runTask } = require('../engine/muse-runner');
const { Pool } = require('../engine/pool');
const { pausedUntil } = require('../engine/scheduler');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xt-test-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const hasFfmpeg = (() => { try { execFileSync('ffprobe', ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } })();
function makeVideo(name, color, src = `color=c=${color}:s=64x64:d=2`) {
  const f = path.join(tmp, name);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', src, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', f]);
  return fs.readFileSync(f);
}

// Trang Muse giả: results = danh sách lần lượt page.result() trả về
function fakePage({ results, files = {} }) {
  let i = 0;
  return {
    send: async () => ({ ok: true, sessionId: 'S1' }),
    status: async () => 'done',
    cancel: async () => {},
    result: async () => results[Math.min(i++, results.length - 1)],
    readFile: async p => files[p],
  };
}
const baseTask = (over = {}) => ({ id: 't1', kind: 'video', prompt: 'test', images: [], attempts: 1, ...over });
const ctx = (page, over = {}) => ({ page, update: () => {}, isLive: () => true, outputDir: tmp, loadImage: async () => ({}), sleep: async () => {}, pollMs: 0, ...over });

test('Muse báo hết lượt bằng chữ → lỗi limit (không phải lỗi thường)', async () => {
  const page = fakePage({ results: [{ files: [], text: 'Sorry, you are out of credits for this week.' }] });
  await assert.rejects(runTask(baseTask(), ctx(page)), e => e.limit === true && /hết lượt/.test(e.message));
});

test('Phiên xong nhưng file chưa có → đọc lại rồi tải được', { skip: !hasFfmpeg }, async () => {
  const buf = makeVideo('ok1.mp4', 'red');
  const file = { path: '/out/a.mp4', mime: 'video/mp4', byteLen: buf.length };
  const page = fakePage({ results: [{ files: [], text: '' }, { files: [file], text: '' }], files: { '/out/a.mp4': buf } });
  const saved = await runTask(baseTask(), ctx(page));
  assert.equal(saved.length, 1);
  assert.ok(fs.existsSync(saved[0]));
});

test('File video hỏng → xoá file, báo lỗi để làm lại', { skip: !hasFfmpeg }, async () => {
  const bad = Buffer.from('không phải video'.repeat(50));
  const file = { path: '/out/bad.mp4', mime: 'video/mp4', byteLen: bad.length };
  const page = fakePage({ results: [{ files: [file], text: '' }], files: { '/out/bad.mp4': bad } });
  const before = fs.readdirSync(tmp).length;
  await assert.rejects(runTask(baseTask(), ctx(page)), e => e.museResult && /bị lỗi/.test(e.message));
  assert.equal(fs.readdirSync(tmp).length, before, 'file hỏng phải bị xoá');
});

test('Video trùng nội dung với video vừa tải → báo lỗi trùng', { skip: !hasFfmpeg }, async () => {
  const buf = makeVideo('dup.mp4', 'blue');
  const file = { path: '/out/d.mp4', mime: 'video/mp4', byteLen: buf.length };
  const mk = () => fakePage({ results: [{ files: [file], text: '' }], files: { '/out/d.mp4': buf } });
  await runTask(baseTask(), ctx(mk()));
  await new Promise(r => setTimeout(r, 5)); // tên file theo Date.now()
  await assert.rejects(runTask(baseTask(), ctx(mk())), e => /trùng nội dung/.test(e.message));
});

// --- Pool với store giả ---
function stores(accIds) {
  const tasks = new Map();
  const accs = new Map(accIds.map(id => [id, { id, name: id, provider: 'muse', enabled: true, threads: 1, loggedIn: true, quota: null, lastUsedAt: 0 }]));
  return {
    tasks: { get: id => tasks.get(id), list: () => [...tasks.values()], update: (id, p) => { tasks.set(id, { ...tasks.get(id), ...p }); return tasks.get(id); }, add: t => tasks.set(t.id, t) },
    accounts: { get: id => accs.get(id), list: () => [...accs.values()], update: (id, p) => { accs.set(id, { ...accs.get(id), ...p }); return accs.get(id); }, settings: { maxAccounts: 5, totalThreads: 5, mode: 'rotate' } },
  };
}
const queued = id => ({ id, kind: 'video', prompt: id, images: [], status: 'queued', attempts: 0, createdAt: 1 });
const okPage = { login: async () => ({ loggedIn: true }), quota: async () => null, show: async () => {}, cancel: async () => {} };

test('Pool: các lần gửi cách nhau ít nhất khoảng cách chung, kể cả khác tài khoản', async () => {
  const { tasks, accounts } = stores(['A', 'B', 'C']);
  ['t1', 't2', 't3'].forEach(id => tasks.add(queued(id)));
  const sendAt = [];
  const pool = new Pool({
    tasks, accounts, pageFor: () => okPage, config: () => ({ outputDir: tmp, limits: { video: 30 }, maxAttempts: 2 }), loadImage: async () => ({}),
    run: async () => { sendAt.push(Date.now()); return []; }, gap: () => 0, globalGap: () => 120,
  });
  pool.pump();
  for (let i = 0; i < 100 && sendAt.length < 3; i++) await new Promise(r => setTimeout(r, 20));
  assert.equal(sendAt.length, 3);
  sendAt.sort((a, b) => a - b);
  for (let i = 1; i < 3; i++) assert.ok(sendAt[i] - sendAt[i - 1] >= 110, `khoảng cách ${sendAt[i] - sendAt[i - 1]}ms`);
});

test('Pool: Muse báo hết lượt → task về hàng đợi, không tính lượt thử, tài khoản nghỉ', async () => {
  const { tasks, accounts } = stores(['A']);
  tasks.add(queued('t1'));
  let calls = 0;
  const pool = new Pool({
    tasks, accounts, pageFor: () => okPage, config: () => ({ outputDir: tmp, limits: { video: 30 }, maxAttempts: 2 }), loadImage: async () => ({}),
    run: async () => { calls++; throw Object.assign(new Error('Muse báo hết lượt: "out of credits"'), { limit: true, limitText: 'out of credits' }); },
    gap: () => 0, globalGap: () => 0,
  });
  pool.pump();
  for (let i = 0; i < 50 && pool.running.size + calls < 2 && !(calls && !pool.running.size); i++) await new Promise(r => setTimeout(r, 10));
  await new Promise(r => setTimeout(r, 30));
  const t = tasks.get('t1'), a = accounts.get('A');
  assert.equal(calls, 1, 'không gửi lại ngay trên tài khoản đang nghỉ');
  assert.equal(t.status, 'queued');
  assert.equal(t.attempts, 0);
  assert.ok(a.limitUntil > Date.now());
  assert.ok(pausedUntil(a, accounts.settings, Date.now()) > 0, 'scheduler phải coi tài khoản đang nghỉ');
});

// --- Nhập cookie ---
const { parseCookieFile, toCdpCookies } = require('../engine/cookie-import');
test('Cookie: giữ đúng tên miền, host-only theo url, gia hạn cookie phiên, đổi sameSite', () => {
  const raw = parseCookieFile(JSON.stringify({ cookies: [
    { name: 'hatch_sess', value: 'a', domain: '.muse.ai', path: '/', sameSite: 'no_restriction', session: true },
    { name: '__Host-x', value: 'b', domain: 'muse.ai', path: '/app', secure: true },
    { name: 'NID', value: 'c', domain: '.google.com' }] }));
  const out = toCdpCookies(raw, 'muse', 1000);
  assert.equal(out.length, 2, 'bỏ cookie google.com');
  assert.equal(out[0].domain, '.muse.ai');
  assert.equal(out[0].sameSite, 'None');
  assert.equal(out[0].secure, true, 'SameSite=None bắt buộc secure');
  assert.equal(out[0].expires, 1000 + 7 * 86400);
  assert.equal(out[1].url, 'https://muse.ai/', '__Host- luôn host-only, path /');
  assert.throws(() => parseCookieFile('không phải json'), /JSON/);
});

// --- Nối clip + âm thanh: câu lệnh ---
const { buildMessage } = require('../engine/muse-runner');
test('Câu lệnh: clip 1 giữ snapshot, clip sau resume_from_snapshot_id, âm thanh đúng chế độ', () => {
  const m1 = buildMessage({ kind: 'video', prompt: 'cô gái đi dạo phố cổ lúc hoàng hôn, máy quay lia chậm theo bước chân, ánh nắng vàng chiếu nghiêng qua mái ngói rêu phong cổ kính', clipK: 1, clipTotal: 3 });
  assert.match(m1, /CLIP 1\/3/); assert.match(m1, /keep its snapshot_id/);
  const m2 = buildMessage({ kind: 'video', prompt: 'tiếp', clipK: 2, clipTotal: 3, audio: 'off' });
  assert.match(m2, /resume_from_snapshot_id = the snapshot_id of clip 1/);
  assert.match(m2, /KHÔNG có âm thanh/);
  const m3 = buildMessage({ kind: 'video', prompt: 'tiếp', clipK: 3, clipTotal: 3 }, 'frame');
  assert.match(m3, /clip CUỐI/); assert.match(m3, /khung hình CUỐI/); assert.doesNotMatch(m3, /resume_from_snapshot_id/);
  assert.doesNotMatch(buildMessage({ kind: 'image', prompt: 'x', clipK: 2, clipTotal: 3, audio: 'off' }), /CLIP|ÂM THANH/, 'ảnh không gắn');
  assert.doesNotMatch(buildMessage({ kind: 'video', prompt: 'x' }), /CLIP|ÂM THANH/, 'mặc định không đổi gì');
});

// --- Nối clip: cách gửi ---
function recPage(results, files, { threadOk = true } = {}) {
  const sends = [];
  return { sends, page: {
    send: async (text, atts, thread) => { sends.push({ text, atts: atts.length, attNames: atts.map(a => a.filename), thread: thread || '' }); return thread && !threadOk ? { ok: false, reason: 'gone' } : { ok: true, sessionId: thread || 'NEW' }; },
    status: (() => { let n = 0; return async () => (n++ === 0 ? 'running' : 'done'); })(), cancel: async () => {}, result: async () => results, readFile: async p => files[p],
  } };
}
const imgLoader = async img => ({ mimeType: 'image/jpeg', dataBase64: fs.readFileSync(img.imageLocalPath || '/dev/null').toString('base64') || 'AA==' });

test('Nối clip: clip 2 gửi vào chat cũ, không kèm ảnh', { skip: !hasFfmpeg }, async () => {
  const buf = makeVideo('c2.mp4', 'green');
  const f = { path: '/o/c2.mp4', mime: 'video/mp4', byteLen: buf.length };
  const { page, sends } = recPage({ files: [f], text: '' }, { '/o/c2.mp4': buf });
  const ref = path.join(tmp, 'ref.jpg'); fs.writeFileSync(ref, Buffer.from('jpg'));
  await runTask(baseTask({ clipK: 2, clipTotal: 3, thread: 'https://muse.ai/thread/OLD', pin: 'A', images: [{ imageLocalPath: ref }] }), ctx(page, { accountId: 'A', loadImage: imgLoader }));
  assert.equal(sends.length, 1);
  assert.equal(sends[0].thread, 'OLD');
  assert.equal(sends[0].atts, 0);
  assert.match(sends[0].text, /resume_from_snapshot_id/);
});

test('Nối clip: chat cũ hỏng → chat mới kèm khung cuối clip trước', { skip: !hasFfmpeg }, async () => {
  const prevClip = path.join(tmp, 'prev.mp4'); fs.writeFileSync(prevClip, makeVideo('prev_src.mp4', '', 'testsrc=s=320x240:d=2'));
  const buf = makeVideo('c3.mp4', 'purple');
  const f = { path: '/o/c3.mp4', mime: 'video/mp4', byteLen: buf.length };
  const { page, sends } = recPage({ files: [f], text: '' }, { '/o/c3.mp4': buf }, { threadOk: false });
  await runTask(baseTask({ clipK: 3, clipTotal: 3, thread: 'https://muse.ai/thread/OLD', pin: 'A', continueFrom: prevClip }), ctx(page, { accountId: 'A', loadImage: imgLoader }));
  assert.equal(sends.length, 2);
  assert.equal(sends[1].thread, '');
  assert.equal(sends[1].attNames[0], 'khung_cuoi_clip_truoc.jpg');
  assert.match(sends[1].text, /khung hình CUỐI/);
});

test('Âm thanh Tắt tiếng: file tải về không còn luồng âm thanh', { skip: !hasFfmpeg }, async () => {
  const src = path.join(tmp, 'withaudio.mp4');
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=white:s=64x64:d=2', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', src]);
  const buf = fs.readFileSync(src);
  const f = { path: '/o/a.mp4', mime: 'video/mp4', byteLen: buf.length };
  const { page } = recPage({ files: [f], text: '' }, { '/o/a.mp4': buf });
  const [saved] = await runTask(baseTask({ audio: 'off' }), ctx(page));
  const streams = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', saved]).toString().trim().split('\n');
  assert.deepEqual(streams, ['video']);
});

// --- Âm thanh cho Flow / Dola / Seedance (qua bộ điều phối) ---
test('Dola/Flow/Seedance: prompt có câu âm thanh, Tắt tiếng thì file không còn tiếng', { skip: !hasFfmpeg }, async () => {
  const dola = require('../engine/dola-runner');
  const { dispatchTask } = require('../engine/multi-engine');
  const src = path.join(tmp, 'dola_audio.mp4');
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=gray:s=64x64:d=2', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=2', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', src]);
  const orig = dola.runTask;
  let seenPrompt = '';
  dola.runTask = async t => { seenPrompt = t.prompt; return [src]; };
  try {
    const files = await dispatchTask({ id: 'x', kind: 'video', prompt: 'Cảnh 1: mèo chạy\n\nCảnh 2: mèo ngủ', engine: 'dola', audio: 'off' }, { page: { provider: 'dola' } });
    assert.match(seenPrompt, /KHÔNG có âm thanh/);
    const streams = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', files[0]]).toString().trim().split('\n');
    assert.deepEqual(streams, ['video']);
    await dispatchTask({ id: 'y', kind: 'video', prompt: 'mèo', engine: 'dola', audio: '' }, { page: { provider: 'dola' } });
    assert.doesNotMatch(seenPrompt, /ÂM THANH/, 'Có tiếng (mặc định) không thêm gì');
  } finally { dola.runTask = orig; }
});

// --- Ô "Tự ghép khi xong" ---
test('Task: merge mặc định bật, tắt được; 3 engine chỉ ghép khi merge bật', () => {
  const TaskStore = require('../engine/task-store');
  const Store = TaskStore.TaskStore || TaskStore;
  const st = new Store(fs.mkdtempSync(path.join(tmp, 'ts-')));
  assert.equal(st.add({ prompt: 'a' }).merge, true);
  assert.equal(st.add({ prompt: 'b', merge: false }).merge, false);
  for (const f of ['gflow-runner', 'dola-runner', 'seedance-runner']) {
    const src = fs.readFileSync(path.join(__dirname, '..', 'engine', f + '.js'), 'utf8');
    assert.match(src, /sceneFiles\.length > 1[^{]*task\.merge !== false\) \{/, f + ' phải xét task.merge trước khi ghép');
  }
});

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
function makeVideo(name, color) {
  const f = path.join(tmp, name);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `color=c=${color}:s=64x64:d=2`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', f]);
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

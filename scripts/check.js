// Kiểm tra cú pháp toàn bộ file JS (main, preload, engine, ui) — chạy: npm run check
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const files = [];
(function walk(d) {
  for (const f of fs.readdirSync(d)) {
    if (['node_modules', '.git'].includes(f)) continue;
    const p = path.join(d, f);
    if (fs.statSync(p).isDirectory()) walk(p); else if (p.endsWith('.js')) files.push(p);
  }
})(root);
let bad = 0;
for (const f of files) {
  try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); }
  catch (e) { bad++; console.error('LỖI', path.relative(root, f), '\n', String(e.stderr)); }
}
console.log(`${files.length - bad}/${files.length} file JS hợp lệ`);
process.exit(bad ? 1 : 0);

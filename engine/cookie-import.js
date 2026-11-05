/**
 * NHẬP COOKIE từ file .json cho 1 tài khoản (bài học EM BÔNG #236: cookie nhập tay phải thắng phiên cũ trong profile).
 * Nhận: mảng cookie (Cookie-Editor, EditThisCookie, J2TEAM…) hoặc { cookies: [...] } (Playwright storageState).
 * Trả về cookie dạng CDP Storage.setCookies, chỉ giữ cookie đúng tên miền của loại tài khoản.
 */

// Tên miền cookie theo loại tài khoản + origin cần xoá dữ liệu cũ trước khi nạp
const PROVIDER = {
  muse: { re: /(^|\.)muse\.ai$/i, origins: ['https://muse.ai'], label: 'muse.ai' },
  google_flow: { re: /(^|\.)(google\.com|labs\.google|flow\.google|googleusercontent\.com)$/i, origins: ['https://labs.google', 'https://flow.google.com', 'https://accounts.google.com'], label: 'Google' },
  dola: { re: /(^|\.)dola\.com$/i, origins: ['https://www.dola.com', 'https://dola.com'], label: 'dola.com' },
  seedance: { re: /(^|\.)(byteplus\.com|bytepluses\.com)$/i, origins: ['https://ai.byteplus.com', 'https://console.byteplus.com'], label: 'BytePlus' },
};

const DAY = 86400;
const SAME_SITE = { no_restriction: 'None', none: 'None', lax: 'Lax', strict: 'Strict' };

function parseCookieFile(text) {
  let data;
  try { data = JSON.parse(String(text).replace(/^﻿/, '')); } catch (e) { throw new Error('File không phải JSON hợp lệ'); }
  const list = Array.isArray(data) ? data : Array.isArray(data?.cookies) ? data.cookies : null;
  if (!list) throw new Error('Không thấy danh sách cookie (cần mảng cookie hoặc { "cookies": [...] })');
  return list.filter(c => c && typeof c.name === 'string' && c.value != null && (c.domain || c.url));
}

function toCdpCookies(raw, provider = 'muse', nowSec = Math.floor(Date.now() / 1000)) {
  const p = PROVIDER[provider] || PROVIDER.muse;
  const out = [];
  for (const c of raw) {
    let domain = String(c.domain || '').trim();
    if (!domain && c.url) { try { domain = new URL(c.url).hostname; } catch (_) {} }
    const bare = domain.replace(/^\./, '');
    if (!bare || !p.re.test(bare)) continue;
    const path = c.path || '/';
    const secure = Boolean(c.secure) || c.name.startsWith('__Secure-') || c.name.startsWith('__Host-');
    // host-only (không có dấu chấm đầu, hoặc file ghi hostOnly, hoặc __Host-) → đặt theo url để Chrome giữ đúng host-only
    const hostOnly = c.hostOnly === true || c.name.startsWith('__Host-') || (c.hostOnly === undefined && !domain.startsWith('.'));
    const ck = { name: c.name, value: String(c.value), path, secure, httpOnly: Boolean(c.httpOnly) };
    if (hostOnly) ck.url = `https://${bare}${c.name.startsWith('__Host-') ? '/' : path}`;
    else ck.domain = domain.startsWith('.') ? domain : '.' + bare;
    const ss = SAME_SITE[String(c.sameSite || '').toLowerCase()];
    if (ss) ck.sameSite = ss;
    if (ck.sameSite === 'None') ck.secure = true;
    // Hạn: cookie phiên / sắp hết (<1 ngày) → gia hạn 7 ngày (cách EM BÔNG) để đóng Chrome không mất phiên
    let exp = Number(c.expirationDate ?? c.expires ?? c.expiry ?? -1);
    if (exp > 1e12) exp = Math.floor(exp / 1000); // file ghi mili-giây
    if (c.session === true || !(exp > 0) || exp < nowSec + DAY) exp = nowSec + 7 * DAY;
    ck.expires = Math.floor(exp);
    out.push(ck);
  }
  return out;
}

module.exports = { PROVIDER, parseCookieFile, toCdpCookies };

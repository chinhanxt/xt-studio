/**
 * MUSE PAGE — script nạp vào trang muse.ai (window.__mss) + lớp Node gọi nó qua Chrome.
 * Gửi lệnh bằng chính client React của Muse (sendMessage, mỗi lệnh 1 chat phụ mới), đọc phiên qua RPC
 * của Muse (sessions.list / chat.history / chat.cancel), tải file qua fs.raw từng đoạn base64.
 */

const CHUNK = 2097152; // 2MB mỗi đoạn tải file
const fs = require('fs');
const path = require('path');

// Chạy TRONG trang Muse (không chạy trong Node) — chuyển thành chuỗi qua toString().
function pageMain(CHUNK) {
  const rt = () => window.__hatchEarlyGatewayRuntimeState.activeRuntime.getSnapshot();
  // Object chat của Muse: tìm trong cây React (memoizedProps.value có sendMessage + ensureActiveChatSendReady)
  const chat = () => {
    if (!document.body) return null; // vừa chuyển trang, trang mới chưa dựng xong
    let root;
    for (const el of [document.body, ...document.querySelectorAll('body *')].slice(0, 80)) {
      const k = Object.keys(el).find(k => k.startsWith('__reactContainer') || k.startsWith('__reactFiber'));
      if (k) { root = el[k]; break; }
    }
    if (!root) return null;
    if (root.stateNode?.current) root = root.stateNode.current;
    const stack = [root];
    for (let n = 0; stack.length && n < 300000; n++) {
      const f = stack.pop();
      const v = f.memoizedProps?.value;
      if (v && typeof v.sendMessage === 'function' && typeof v.ensureActiveChatSendReady === 'function') return v;
      if (f.child) stack.push(f.child);
      if (f.sibling) stack.push(f.sibling);
    }
    return null;
  };
  const files = new Map();
  let fileSeq = 0;
  const b64 = u8 => {
    let s = '';
    for (let i = 0; i < u8.length; i += 32768) s += String.fromCharCode.apply(null, u8.subarray(i, i + 32768));
    return btoa(s);
  };
  return (window.__mss = {
    async login() {
      try {
        const r = await fetch('/api/session', { credentials: 'include' });
        const j = await r.json().catch(() => ({}));
        // Muse phải đã cấp máy ảo cho tài khoản (status 'assigned'); VM đang ngủ thì đánh thức (cách EM BÔNG làm)
        const assigned = !j.status || j.status === 'assigned';
        if (r.status === 200 && j.status === 'assigned' && j.vm_id && j.vm_state && j.vm_state !== 'RUNNING') {
          fetch('/api/hatch/vm/wake', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
            body: JSON.stringify({ vm_id: j.vm_id, retry_count: 0, connect_attempt_id: crypto.randomUUID() }) }).catch(() => {});
        }
        return { loggedIn: r.status === 200 && assigned && Boolean(chat()), http: r.status, status: j.status || null, vm: j.vm_state || null };
      } catch (e) {
        return { loggedIn: false, http: 0, status: null, vm: null };
      }
    },
    // thread = sessionId chat có sẵn: gửi thẳng vào chat đó (targetRoute của Muse), không chuyển trang; không có → chat phụ mới
    async send(text, atts, thread = '') {
      // Trang đang chuyển/đang dựng lại (vd. người dùng bấm mở 1 đoạn chat) → chờ tối đa 20s cho client chat hiện lại
      let c = chat();
      for (let k = 0; !c && k < 20; k++) { await new Promise(r => setTimeout(r, 1000)); c = chat(); }
      if (!c) return { ok: false, reason: `not_ready (${location.pathname})` };
      const r = await c.sendMessage(text, atts, thread
        ? { targetRoute: { kind: 'thread', sessionId: thread }, waitForReadiness: true }
        : { createNewThread: true, waitForReadiness: true });
      return { ok: Boolean(r?.ok), sessionId: r?.sessionId || (r?.ok ? thread : ''), reason: r?.reason || r?.error || '' };
    },
    async status(sid) {
      const { sessions = [] } = await rt().sendRequest('sessions.list', {});
      return sessions.find(s => s.session_id === sid)?.status || null;
    },
    async result(sid) {
      const h = await rt().sendRequest('chat.history', { session_id: sid, limit: 50 });
      return (h.chat_events || []).filter(e => e.role === 'assistant').map(e => ({
        text: e.display_text || '', images: e.payload?.data?.images || [], videos: e.payload?.data?.videos || []
      }));
    },
    async open(path) {
      const r = await rt().sendRequest('fs.raw', { path: path.replace(/^sandbox:\/\//, '') });
      const blob = r instanceof Blob ? r : r.data;
      files.set(++fileSeq, blob);
      return { id: fileSeq, size: blob.size };
    },
    async slice(id, i) {
      return b64(new Uint8Array(await files.get(id).slice(i * CHUNK, (i + 1) * CHUNK).arrayBuffer()));
    },
    closeFile(id) {
      files.delete(id);
      return null;
    },
    async cancel(sid) {
      await rt().sendRequest('chat.cancel', { session_id: sid });
      return null;
    },
    // Hạn mức: server action Next.js "fetchSubscriptionAction" (id đổi theo bản Muse → tìm trong file JS đã tải).
    // File JS chỉ có khi trang từng hiện; không tìm được → null (không rõ hạn mức).
    async quota() {
      if (!window.__mssQuotaId) {
        const re = /createServerReference\)\("([0-9a-f]{20,})",[^;]{0,120}?"fetchSubscriptionAction"\)/;
        const urls = [...new Set(performance.getEntriesByType('resource').map(e => e.name).filter(u => /\.js(\?|$)/.test(u)))];
        for (const u of urls) {
          const m = re.exec(await fetch(u).then(r => r.text()).catch(() => ''));
          if (m) { window.__mssQuotaId = m[1]; break; }
        }
        if (!window.__mssQuotaId) return null;
      }
      const r = await fetch('/', {
        method: 'POST', credentials: 'include', body: JSON.stringify([{}]),
        headers: { 'Next-Action': window.__mssQuotaId, Accept: 'text/x-component', 'Content-Type': 'text/plain;charset=UTF-8' }
      });
      if (!r.ok) { window.__mssQuotaId = ''; return null; }
      for (const line of (await r.text()).split('\n')) {
        if (!line.includes('"success"')) continue;
        try {
          const j = JSON.parse(line.slice(line.indexOf(':') + 1));
          if (j.success && j.subscription) return j.subscription;
        } catch (e) {}
      }
      return null;
    }
  });
}

const PAGE_SCRIPT = `(${pageMain.toString()})(${CHUNK})`;

// Sự kiện assistant [{text, images, videos}] → {files:[{path,mime,byteLen}], text}. Video trước ảnh, bỏ file missing.
function parseResult(events) {
  const pick = list => list.filter(m => !m.missing).map(m => ({ path: m.path, mime: m.mime, byteLen: m.byte_len }));
  return {
    files: [...pick(events.flatMap(e => e.videos)), ...pick(events.flatMap(e => e.images))],
    text: events.map(e => e.text).filter(Boolean).join('\n')
  };
}

// subscription của Muse → {pct, resetsAt (ms), status, tier, paid, topupLeft (0..1 | null), topupBalance, topupTotal, label, subtitle, checkedAt}
function parseQuota(sub) {
  if (!sub?.usage) return null;
  const total = Number(sub.topupTotal) || 0;
  return {
    pct: Number(sub.usage.percentUsed) || 0, resetsAt: (Number(sub.usage.resetsAt) || 0) * 1000, status: sub.usage.quotaStatus || '',
    tier: sub.tier?.name || '', paid: Boolean(sub.tier?.isPaid), topupLeft: total > 0 ? (Number(sub.topupBalance) || 0) / total : null,
    topupBalance: Number(sub.topupBalance) || 0, topupTotal: total,
    label: sub.usageRowValueLabel || '', subtitle: sub.statusSubtitle || '', checkedAt: Date.now()
  };
}

class MusePage {
  constructor(chrome, opts = {}) {
    this.chrome = chrome;
    this.provider = opts.provider || 'muse';
    this.getAccount = typeof opts.account === 'function' ? opts.account : (() => null);
  }

  // Tài khoản đã xoá → không bao giờ mở lại Chrome (vòng dò đăng nhập cũ còn chạy sẽ mở Chrome mồ côi, tắt app cũng không đóng)
  async ready() {
    if (this.removed) throw new Error('Tài khoản đã bị xoá');
    if (!this.chrome.running) await this.chrome.start();
  }

  async call(name, ...args) {
    await this.ready();
    // send chờ Muse chuẩn bị máy (waitForReadiness) → cho tới 3 phút
    return this.chrome.evaluate(`(window.__mss || ${PAGE_SCRIPT})[${JSON.stringify(name)}](...${JSON.stringify(args)})`, name === 'send' ? 180e3 : undefined);
  }

  async login() {
    if (this.provider === 'seedance') {
      const acc = this.getAccount();
      if (acc?.apiKey && acc.apiKey.trim()) {
        return { loggedIn: true, http: 200, status: 'api_ready', vm: null };
      }
      try {
        await this.ready();
        // Hỏi API tài khoản BytePlus: đăng nhập → 200 không lỗi; chưa đăng nhập → 401 NotLogin.
        const res = await this.chrome.evaluate(`(async () => {
          const href = location.href.toLowerCase();
          if (href.includes('login') || href.includes('signin') || href.includes('passport')) return false;
          // Đóng thông báo cookie / khuyến mãi nếu đang che
          document.querySelectorAll('button.acknowledgeButton_ef9fd, button[aria-label="Close special offer"]').forEach(b => { try { b.click(); } catch (_) {} });
          try {
            const r = await fetch('https://console.byteplus.com/api/passport/account/queryUser', { credentials: 'include' });
            const j = await r.json().catch(() => ({}));
            const err = j && j.ResponseMetadata && j.ResponseMetadata.Error;
            if (r.status === 200 && !err) return true;
            if (r.status === 401 || (err && err.Code === 'NotLogin')) return false;
          } catch (_) {}
          // API trả lạ → xem trang (không coi khung Playground là đã đăng nhập: khách cũng thấy)
          const signInBtn = document.querySelector('[data-testid="topbar-sign-in"], [data-testid="sidebar-sign-in"], button[class*="signInPill"]');
          if (signInBtn) return false;
          return Boolean(document.querySelector('[data-testid="topbar-user"], [data-testid="user-dropdown-menu"], [class*="userProfile"]'));
        })()`);
        return { loggedIn: Boolean(res), http: 200, status: null, vm: null };
      } catch (e) {
        return { loggedIn: false, http: 0, status: null, vm: null };
      }
    }

    if (this.provider === 'google_flow') {
      try {
        await this.ready();
        const res = await this.chrome.evaluate(`(() => {
          if (location.href.includes('accounts.google.com')) return false;
          if (location.href.includes('/about')) {
            const btn = Array.from(document.querySelectorAll('button, a')).find(el => /create with.*flow/i.test(el.textContent || '') || el.getAttribute('aria-label') === 'Sign in');
            if (btn) btn.click();
            return false;
          }
          const hasSignInBtn = Array.from(document.querySelectorAll('button, a')).some(el => /^sign in$/i.test((el.textContent || '').trim()) || el.getAttribute('aria-label') === 'Sign in');
          if (hasSignInBtn) return false;
          const hasStudio = Boolean(document.querySelector('div.ProseMirror, a[href*="/project/"], mat-sidenav-container, flow-sidenav-top, [class*="prompt"], [class*="sidenav"]'));
          const hasAvatar = Boolean(document.querySelector('img[src*="googleusercontent.com"], a[href*="SignOutOptions"], [aria-label*="Google Account"], button[aria-label*="Google"]'));
          const onFlowHost = location.hostname.includes('flow.google') || location.hostname.includes('labs.google');
          return Boolean(onFlowHost && (hasStudio || hasAvatar));
        })()`);
        return { loggedIn: Boolean(res), http: 200, status: null, vm: null };
      } catch (e) {
        return { loggedIn: false, http: 0, status: null, vm: null };
      }
    }

    if (this.provider === 'dola') {
      try {
        await this.ready();
        // Dola cho dùng chế độ KHÁCH (vẫn có ô soạn thảo) → không dựa vào giao diện. Hỏi API tài khoản ByteDance:
        // đăng nhập → message 'success' + user_id; chưa đăng nhập / hết phiên → message 'error', error_code 1.
        const res = await this.chrome.evaluate(`(async () => {
          try {
            const r = await fetch('/passport/web/account/info/', { credentials: 'include' });
            const j = await r.json();
            if (j && j.message === 'success' && j.data && (j.data.user_id || j.data.user_id_str)) return true;
            if (j && j.message === 'error') return false;
          } catch (_) {}
          // API trả lạ → xem trang: còn nút Log In là chưa đăng nhập
          const loginBtn = [...document.querySelectorAll('button, a')].some(e => /^(log ?in|sign ?in|đăng nhập)$/i.test((e.textContent || '').trim()));
          return !loginBtn && Boolean(document.querySelector('[class*="avatar" i]'));
        })()`);
        return { loggedIn: Boolean(res), http: 200, status: null, vm: null };
      } catch (e) {
        return { loggedIn: false, http: 0, status: null, vm: null };
      }
    }

    return this.call('login');
  }

  // Không thấy client chat → về trang chủ Muse rồi gửi lại 1 lần (trang lạ/kẹt sau khi người dùng bấm lung tung)
  // thread = sessionId chat cũ: gửi tiếp vào chat đó (không tạo chat mới, không chuyển trang)
  async send(text, atts, thread = '') {
    const r = await this.call('send', text, atts, thread);
    if (!/^not_ready/.test(r?.reason || '')) return r;
    await this.chrome.cmd('Page.navigate', { url: this.chrome.url }, this.chrome.sessionId);
    return this.call('send', text, atts, thread);
  }
  status(sid) { return this.call('status', sid); }
  async result(sid) { return parseResult(await this.call('result', sid)); }
  cancel(sid) { return this.call('cancel', sid); }
  async quota() {
    if (this.provider !== 'muse') {
      const tier = this.provider === 'google_flow' ? 'Google Flow Pro' : this.provider === 'dola' ? 'Dola Daily Credits' : 'Seedance 2.5';
      return { pct: 0, resetsAt: null, status: 'ACTIVE', tier, paid: this.provider === 'google_flow', topupLeft: null, topupBalance: 0, topupTotal: 0, label: 'Sẵn sàng', subtitle: this.provider === 'dola' ? 'Miễn phí theo ngày' : '', checkedAt: Date.now() };
    }
    return parseQuota(await this.call('quota'));
  }

  async readFile(path) {
    const { id, size } = await this.call('open', path);
    try {
      const parts = [];
      for (let i = 0; i * CHUNK < size; i++) parts.push(Buffer.from(await this.call('slice', id, i), 'base64'));
      return Buffer.concat(parts);
    } finally {
      await this.call('closeFile', id).catch(() => {});
    }
  }

  async show() {
    await this.ready();
    await this.chrome.show();
    if (this.provider === 'seedance') {
      // Nếu mở cửa sổ để đăng nhập Seedance mà đang ở trang Playground chưa đăng nhập, tự bấm nút Sign in mở khung đăng nhập
      await this.chrome.evaluate(`(() => {
        const signInBtn = document.querySelector('[data-testid="topbar-sign-in"], button[class*="signInPill"], [data-testid="sidebar-sign-in"]');
        if (signInBtn) { try { signInBtn.click(); } catch (_) {} }
      })()`).catch(() => {});
    }
  }
  async hide() { if (this.chrome?.running) await this.chrome.hide(); }
  // Nạp cookie từ file (đã đổi sang dạng CDP). Cách EM BÔNG #236: về about:blank để tab cũ không ghi lại phiên,
  // xoá cookie + dữ liệu trang cũ của profile, nạp cookie mới rồi mở lại trang dịch vụ.
  async importCookies(cookies, origins = []) {
    await this.ready();
    const c = this.chrome;
    await c.cmd('Page.navigate', { url: 'about:blank' }, c.sessionId).catch(() => {});
    await c.cmd('Storage.clearCookies');
    for (const origin of origins) await c.cmd('Storage.clearDataForOrigin', { origin, storageTypes: 'all' }).catch(() => {});
    await c.cmd('Storage.setCookies', { cookies });
    await c.cmd('Page.navigate', { url: c.url }, c.sessionId);
  }
  async logout() {
    await this.ready();
    if (this.provider === 'google_flow') {
      await this.chrome.clearSiteData('https://google.com');
    } else if (this.provider === 'seedance') {
      await this.chrome.clearSiteData('https://ai.byteplus.com');
    } else if (this.provider === 'dola') {
      await this.chrome.clearSiteData('https://dola.com');
    } else {
      await this.chrome.clearSiteData('https://muse.ai');
    }
  }
}

module.exports = { MusePage, parseResult, parseQuota, PAGE_SCRIPT, CHUNK };

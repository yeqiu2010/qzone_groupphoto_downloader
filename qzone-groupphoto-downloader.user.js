// ==UserScript==
// @name         QQ群相册批量下载器
// @namespace    https://github.com/yeqiu2010
// @version      1.0.0
// @description  在 h5.qzone.qq.com 群相册页面列出全部相册，支持「整册 ZIP 打包下载」（官方接口）与「逐张原图下载」，可勾选/全选相册、断点续传
// @author       yeqiu2010
// @homepage     https://github.com/yeqiu2010/qzone-groupphoto-downloader
// @homepageURL  https://github.com/yeqiu2010/qzone-groupphoto-downloader
// @supportURL   https://github.com/yeqiu2010/qzone-groupphoto-downloader/issues
// @downloadURL  https://raw.githubusercontent.com/yeqiu2010/qzone-groupphoto-downloader/main/qzone-groupphoto-downloader.user.js
// @updateURL    https://raw.githubusercontent.com/yeqiu2010/qzone-groupphoto-downloader/main/qzone-groupphoto-downloader.user.js
// @license      MIT
// @match        https://h5.qzone.qq.com/groupphoto/index*
// @match        https://h5.qzone.qq.com/groupphoto/album*
// @run-at       document-idle
// @grant        GM_download
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @grant        GM_setClipboard
// @connect      qzone.qq.com
// @connect      h5.qzone.qq.com
// @connect      u.photo.qzone.qq.com
// @connect      app.photo.qq.com
// @connect      photo.store.qq.com
// @connect      photocdn.qzone.qq.com
// @connect      qzonestyle.gtimg.cn
// @connect      *
// ==/UserScript==

(function () {
  'use strict';

  /* =========================================================================
   * 0. 配置
   * =======================================================================*/
  const CFG = {
    albumPageSize: 1000,   // 相册列表每页
    zipDelayMs: 1500,      // 每个相册 ZIP 之间的间隔（打包接口有频率限制）
    photoPageSize: 100,    // 逐张模式每页照片数
    concurrency: 3,        // 逐张模式并发
    delayMs: 350,          // 逐张模式间隔
    retry: 3               // 单文件失败重试
  };

  const qs = (name) => {
    const m = location.search.substring(1).match(new RegExp('(^|&)' + name + '=([^&]*)(&|$)', 'i'));
    return m ? decodeURIComponent(m[2]) : '';
  };
  const groupId = qs('groupId');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /* =========================================================================
   * 1. 身份与票据（优先复用页面自身的 PSY / g_qzonetoken，拿不到再自己算）
   * =======================================================================*/
  function cookieGet(name) {
    const m = document.cookie.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : '';
  }
  function getGTK(skey) {                 // 腾讯系通用 g_tk 算法
    let hash = 5381;
    for (let i = 0; i < skey.length; i++) hash += (hash << 5) + skey.charCodeAt(i);
    return hash & 0x7fffffff;
  }
  function token() {
    try { if (window.PSY && window.PSY.user && window.PSY.user.token) return String(window.PSY.user.token()); } catch (e) {}
    return String(getGTK(cookieGet('p_skey') || cookieGet('skey') || ''));
  }
  function loginUin() {
    try { if (window.PSY && window.PSY.user && window.PSY.user.getLoginUin) return String(window.PSY.user.getLoginUin()); } catch (e) {}
    return cookieGet('uin').replace(/^o0*/, '') || cookieGet('loginuin').replace(/^o0*/, '');
  }
  // qzonetoken：页面全局 -> 父窗口/iframe -> PSY/QZONE 对象 -> 页面 HTML 正则
  function qzonetoken() {
    const wins = [];
    const push = (w) => { try { if (w) wins.push(w); } catch (e) {} };
    push(window);
    try { if (window.parent !== window) push(window.parent); } catch (e) {}
    try { if (window.top !== window) push(window.top); } catch (e) {}
    document.querySelectorAll('iframe').forEach((f) => { try { push(f.contentWindow); } catch (e) {} });

    for (const w of wins) {
      try {
        if (w.g_qzonetoken) return String(w.g_qzonetoken);
        if (w.PSY && w.PSY.data && w.PSY.data.qzonetoken) return String(w.PSY.data.qzonetoken);
        if (w.QZONE && w.QZONE.data && w.QZONE.data.qzonetoken) return String(w.QZONE.data.qzonetoken);
        if (w.PSY && w.PSY.user && w.PSY.user.qzonetoken) return String(w.PSY.user.qzonetoken);
      } catch (e) {}
    }
    // 从页面源码里抠
    try {
      const html = document.documentElement.outerHTML;
      const m = html.match(/g_qzonetoken\s*[:=]\s*["']([^"']{8,})["']/);
      if (m) return m[1];
    } catch (e) {}
    return '';
  }

  const API = {
    ALBUM_LIST: 'https://h5.qzone.qq.com/proxy/domain/u.photo.qzone.qq.com/cgi-bin/upp/qun_list_album_v2',
    ARCH_PHOTO: 'https://h5.qzone.qq.com/proxy/domain/app.photo.qq.com/cgi-bin/app/cgi_arch_photo_v2',
    ARCH_DIRECT: 'https://app.photo.qq.com/cgi-bin/app/cgi_arch_photo_v2'
  };

  const COMMON = {
    inCharset: 'utf-8', outCharset: 'utf-8', platform: 'qzone', source: 'qzone', format: 'json'
  };

  // 永不抛异常：返回 { status, text, data }
  async function request(url, opt) {
    try {
      const res = await fetch(url, Object.assign({ credentials: 'include', headers: { Referer: location.href } }, opt || {}));
      const text = await res.text();
      let data = null;
      try { data = JSON.parse(text); } catch (e) {
        const m = text.trim().match(/^\s*\w*\s*\(\s*([\s\S]*)\s*\)\s*;?\s*$/);   // JSONP 兜底
        if (m) { try { data = JSON.parse(m[1]); } catch (e2) {} }
      }
      return { status: res.status, text, data };
    } catch (e) {
      return { status: -1, text: '网络错误：' + ((e && e.message) || e), data: null };
    }
  }
  async function getJSON(url, opt) {
    return (await request(url, opt)).data;
  }

  /* =========================================================================
   * 2. 相册列表（真实接口：qun_list_album_v2?cmd=qunGetAlbumList）
   * =======================================================================*/
  async function fetchAlbumPage(start) {
    const p = new URLSearchParams();
    p.append('g_tk', token());
    p.append('qzonetoken', qzonetoken());
    p.append('qunId', groupId);
    p.append('uin', loginUin());
    p.append('start', String(start));
    p.append('num', String(CFG.albumPageSize));
    Object.entries(COMMON).forEach(([k, v]) => p.append(k, v));
    p.append('cmd', 'qunGetAlbumList');
    return await getJSON(API.ALBUM_LIST + '?' + p.toString());
  }

  async function scanAlbums(log) {
    const first = await fetchAlbumPage(0);
    if (!first || !first.data) {
      log('✘ 相册列表接口未返回数据（code=' + (first && (first.code || first.ret)) + '）');
      return [];
    }
    const list = [].concat(first.data.album || first.data.albumList || []);
    const total = Number(first.data.total || list.length);
    log('✔ 相册接口 OK，共 ' + total + ' 个相册');
    for (let page = 1; page * CFG.albumPageSize < total; page++) {
      await sleep(800);
      const next = await fetchAlbumPage(page * CFG.albumPageSize);
      const arr = (next && next.data && (next.data.album || next.data.albumList)) || [];
      if (!arr.length) break;
      list.push(...arr);
      log('  已读取 ' + list.length + '/' + total);
    }
    // 归一化
    return list.map((a) => ({
      id: String(a.id || a.albumid || a.albumId || ''),
      title: (a.title || a.name || a.albumname || ('相册' + (a.id || ''))).trim(),
      count: Number(a.picnum || a.total || a.count || 0)
    })).filter((a) => a.id);
  }

  /* =========================================================================
   * 3. 整册打包下载链接（真实接口：cgi_arch_photo_v2，POST）
   * =======================================================================*/
  async function getAlbumZipUrl(album, log) {
    const say = (m) => { if (log) log(m); };

    const q = new URLSearchParams();          // 仅放票据（参考实现：票据在 URL，业务参数在 body）
    q.append('g_tk', token());
    q.append('qzonetoken', qzonetoken());

    const b = new URLSearchParams();          // 业务参数
    b.append('uin', loginUin());
    b.append('hostUin', '-1');
    b.append('inCharset', 'utf-8');
    b.append('outCharset', 'utf-8');
    b.append('refer', 'refer');
    b.append('source', 'qzone');
    b.append('platform', 'qzone');
    b.append('format', 'json');
    b.append('appid', '422');
    b.append('selectMode', '1');
    b.append('albumid', album.id);
    b.append('hostid', groupId);
    b.append('albumName', album.title);

    const all = new URLSearchParams(q.toString());   // 票据 + 业务参数放一起的形态
    b.forEach((v, k) => all.append(k, v));

    const pick = (data) => {
      const u = data && ((data.data && data.data.downloadUrl) || data.downloadUrl);
      return u ? String(u).replace(/^http:/, 'https:') : '';
    };
    const brief = (t) => {
      const s = String(t || '').replace(/\s+/g, ' ').slice(0, 150);
      const ti = String(t || '').match(/<title>([^<]*)<\/title>/i);
      return (ti ? '[title=' + ti[1] + '] ' : '') + s;
    };

    const variants = [
      { name: 'POST·票据在URL+参数在body', url: API.ARCH_PHOTO + '?' + q.toString(), opt: { method: 'POST', body: b } },
      { name: 'POST·显式Content-Type', url: API.ARCH_PHOTO + '?' + q.toString(),
        opt: { method: 'POST', body: b.toString(), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } } },
      { name: 'GET·全部参数在URL', url: API.ARCH_PHOTO + '?' + all.toString(), opt: {} },
      { name: 'POST·全部参数在URL', url: API.ARCH_PHOTO + '?' + all.toString(), opt: { method: 'POST', body: '' } },
      { name: 'GM_xhr·直连 app.photo.qq.com', url: API.ARCH_DIRECT + '?' + q.toString(), opt: { method: 'POST', body: b }, gm: true }
    ];

    if (!qzonetoken()) say('  ⚠ 未取到 qzonetoken，打包接口常常会因此被网关拒绝(403)');

    for (const v of variants) {
      const r = v.gm ? await gmRequest(v.url, v.opt) : await request(v.url, v.opt);
      const url = pick(r.data);
      if (url) { say('  ✔ 拿到打包链接（' + v.name + '）'); return url; }
      say('  · ' + v.name + ' → HTTP ' + r.status + ' | ' + brief(r.text));
      await sleep(700);
    }
    return '';
  }

  // GM_xmlhttpRequest 包装（可直连跨域主机，绕过 /proxy/domain 网关）
  function gmRequest(url, opt) {
    return new Promise((resolve) => {
      if (typeof GM_xmlhttpRequest !== 'function') return resolve({ status: -2, text: 'GM_xmlhttpRequest 不可用（请确认脚本授权）', data: null });
      try {
        GM_xmlhttpRequest({
          method: opt.method || 'GET',
          url,
          headers: Object.assign({ 'Content-Type': 'application/x-www-form-urlencoded' }, opt.headers || {}),
          data: opt.body ? String(opt.body) : undefined,
          timeout: 30000,
          onload: (r) => {
            let data = null;
            try { data = JSON.parse(r.responseText); } catch (e) {}
            resolve({ status: r.status, text: r.responseText, data });
          },
          onerror: () => resolve({ status: -3, text: 'GM_xhr 网络错误', data: null }),
          ontimeout: () => resolve({ status: -4, text: 'GM_xhr 超时', data: null })
        });
      } catch (e) { resolve({ status: -5, text: String(e), data: null }); }
    });
  }

  /* =========================================================================
   * 4. 逐张模式：抓照片地址（优先复用页面真实接口，失败则滚动抓 DOM）
   * =======================================================================*/
  const sniffed = [];   // sniff() 填充页面真实调用过的接口

  async function collectPhotosFromDOM(log) {
    log('⚠ 未拿到照片接口，改为滚动页面抓 DOM…');
    const urls = new Map();
    const HOST = /photo\.store\.qq\.com|photocdn\.qzone|qzonestyle\.gtimg|photo\.qzone/i;

    const grab = (root) => {
      let imgs = [];
      try { imgs = root.querySelectorAll('img'); } catch (e) { return; }
      imgs.forEach((img) => {
        // bigsrc 通常是页面标记的原图地址，优先取
        const raw = img.getAttribute('bigsrc') || img.getAttribute('data-bigsrc') ||
          img.getAttribute('data-src') || img.getAttribute('data-original') || img.src || '';
        const u = origUrl(raw);
        if (u && HOST.test(u) && !urls.has(u)) {
          urls.set(u, { url: u, name: sanitize(img.alt || ''), id: u });
        }
      });
    };
    const scrollAll = () => {
      window.scrollTo(0, document.body.scrollHeight || document.documentElement.scrollHeight);
      document.querySelectorAll('div,section,main,ul').forEach((el) => {
        try {
          if (el.scrollHeight - el.clientHeight > 20 && /auto|scroll/.test(getComputedStyle(el).overflowY)) el.scrollTop = el.scrollHeight;
        } catch (e) {}
      });
    };

    let stable = 0, last = 0;
    for (let i = 0; i < 300; i++) {
      scrollAll();
      grab(document);
      document.querySelectorAll('iframe').forEach((f) => {
        try { if (f.contentDocument) grab(f.contentDocument); } catch (e) {}
      });
      await sleep(450);
      if (urls.size === last) { if (++stable >= 8) break; } else { stable = 0; last = urls.size; }
    }
    log('  DOM 收集到 ' + urls.size + ' 张');
    return [...urls.values()];
  }

  /* =========================================================================
   * 5. 通用工具
   * =======================================================================*/
  function sanitize(name) {
    return String(name || '')
      .replace(/[\\/:*?"<>|\r\n\t]+/g, '_')
      .replace(/\s+$/, '')
      .replace(/[._\s]+$/, '')          // 去掉末尾的 . _ 空格，避免难看的后缀
      .slice(0, 80) || 'unnamed';
  }
  function extOf(url) {
    const m = String(url).match(/\.(jpg|jpeg|png|gif|webp|bmp)(\?|\/|$)/i);
    return m ? m[1].toLowerCase().replace('jpeg', 'jpg') : 'jpg';
  }
  // 群相册图片 .../200、/640、/800 等是不同规格，/0 为原图
  function origUrl(u) {
    if (!u) return '';
    return String(u)
      .replace(/[?&](?:tp|spec)=[^&]*/g, '')
      .replace(/\/(?:100|200|320|640|800|1000|1280)(?=\?|$|\/)/, '/0');
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  // 保存文件：优先 GM_download（可跨源、可指定子目录），失败回退 a[download]
  function saveFile(url, filename) {
    return new Promise((resolve) => {
      let done = false;
      const finish = (ok) => { if (!done) { done = true; resolve(ok); } };

      const anchorFallback = () => {
        const a = document.createElement('a');
        a.href = url; a.download = filename; a.target = '_blank'; a.rel = 'noopener';
        a.style.display = 'none';
        document.body.appendChild(a); a.click();
        setTimeout(() => { a.remove(); finish(true); }, 800);
      };

      try {
        if (typeof GM_download === 'function') {
          GM_download({
            url, name: filename, saveAs: false,
            onload: () => finish(true),
            onerror: () => anchorFallback(),
            ontimeout: () => anchorFallback()
          });
          setTimeout(() => finish(true), 120000);   // 大 ZIP 最多等 120s
          return;
        }
      } catch (e) {}
      anchorFallback();
    });
  }

  async function pool(tasks, onOne, shouldStop) {
    let idx = 0, ok = 0, fail = 0;
    const worker = async () => {
      while (idx < tasks.length) {
        if (shouldStop && shouldStop()) return;
        const t = tasks[idx++];
        let success = false;
        for (let r = 0; r < CFG.retry && !success; r++) {
          success = await saveFile(t.url, t.filename);
          if (!success) await sleep(800 * (r + 1));
        }
        success ? ok++ : fail++;
        onOne(t, success, ok, fail);
        await sleep(CFG.delayMs);
      }
    };
    await Promise.all(Array.from({ length: Math.min(CFG.concurrency, tasks.length) }, worker));
    return { ok, fail };
  }

  /* =========================================================================
   * 6. 界面
   * =======================================================================*/
  GM_addStyle(`
    #qzgp-panel{position:fixed;right:18px;bottom:18px;width:370px;max-height:80vh;z-index:2147483647;
      background:#1f2430;color:#e8eaed;border:1px solid #3a4252;border-radius:10px;
      box-shadow:0 8px 28px rgba(0,0,0,.45);font:13px/1.5 -apple-system,"Microsoft YaHei",sans-serif;overflow:hidden}
    #qzgp-panel.hidden #qzgp-body{display:none}
    #qzgp-head{display:flex;align-items:center;gap:8px;padding:10px 12px;background:#2a3140;cursor:move;user-select:none}
    #qzgp-head b{flex:1;font-size:14px}
    #qzgp-head span{cursor:pointer;opacity:.7;padding:0 4px}
    #qzgp-body{padding:10px 12px 12px;overflow:auto;max-height:68vh}
    .qzgp-row{display:flex;align-items:center;gap:6px;margin-bottom:8px;flex-wrap:wrap}
    #qzgp-albums{max-height:230px;overflow:auto;border:1px solid #3a4252;border-radius:6px;padding:6px;margin-bottom:8px}
    #qzgp-albums label{display:flex;align-items:center;gap:6px;padding:3px 2px;cursor:pointer}
    #qzgp-albums label:hover{background:#2a3140}
    #qzgp-albums .t{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .qzgp-btn{background:#4a7cf7;color:#fff;border:0;border-radius:6px;padding:6px 12px;cursor:pointer;font-size:13px}
    .qzgp-btn:hover{background:#5b8bff}
    .qzgp-btn:disabled{background:#4a5160;cursor:not-allowed}
    .qzgp-btn.ghost{background:#394052}
    .qzgp-bar{height:8px;background:#394052;border-radius:5px;overflow:hidden;margin:6px 0}
    .qzgp-bar i{display:block;height:100%;width:0;background:#4a7cf7;transition:width .2s}
    #qzgp-log{max-height:150px;overflow:auto;background:#151922;border-radius:6px;padding:6px;
      font:12px/1.6 Consolas,monospace;white-space:pre-wrap;color:#a9b2c3}
    #qzgp-panel input[type=number]{width:52px;background:#151922;color:#e8eaed;border:1px solid #3a4252;border-radius:4px;padding:3px 4px}
    .qzgp-tip{font-size:11px;color:#6f7887;margin-top:6px}
  `);

  const panel = document.createElement('div');
  panel.id = 'qzgp-panel';
  panel.innerHTML = `
    <div id="qzgp-head"><b>QQ群相册批量下载器</b><span id="qzgp-toggle" title="折叠/展开">—</span></div>
    <div id="qzgp-body">
      <div class="qzgp-row">
        <button class="qzgp-btn" id="qzgp-scan">① 扫描相册</button>
        <button class="qzgp-btn" id="qzgp-start" disabled>② 开始下载</button>
        <button class="qzgp-btn ghost" id="qzgp-stop" disabled>停止</button>
      </div>
      <div class="qzgp-row" style="font-size:12px;color:#9aa4b5">
        <label><input type="radio" name="qzgp-mode" value="zip" checked> 整册打包 ZIP</label>
        <label><input type="radio" name="qzgp-mode" value="photo"> 逐张原图</label>
        <label style="margin-left:6px"><input type="checkbox" id="qzgp-skip" checked> 跳过已下载</label>
      </div>
      <div class="qzgp-row" style="font-size:12px;color:#9aa4b5">
        并发 <input type="number" id="qzgp-cc" value="${CFG.concurrency}" min="1" max="8">
        间隔(ms) <input type="number" id="qzgp-dl" value="${CFG.delayMs}" min="0" step="50">
        <button class="qzgp-btn ghost" id="qzgp-copy" style="padding:3px 8px">复制ZIP链接</button>
        <button class="qzgp-btn ghost" id="qzgp-clear" style="padding:3px 8px">清空进度</button>
      </div>
      <div class="qzgp-row" style="font-size:12px;color:#9aa4b5">
        <button class="qzgp-btn ghost" id="qzgp-all" style="padding:3px 8px">全选</button>
        <button class="qzgp-btn ghost" id="qzgp-none" style="padding:3px 8px">取消全选</button>
        <button class="qzgp-btn ghost" id="qzgp-invert" style="padding:3px 8px">反选</button>
        <span id="qzgp-selcount" style="color:#8b94a3">尚未扫描</span>
      </div>
      <div id="qzgp-albums"><div style="color:#8b94a3">点击「扫描相册」获取列表…</div></div>
      <div class="qzgp-bar"><i id="qzgp-bar-i"></i></div>
      <div id="qzgp-status" style="font-size:12px;color:#9aa4b5">就绪</div>
      <div id="qzgp-log"></div>
      <div class="qzgp-tip">群号 ${groupId || '未识别'}｜保存到浏览器下载目录的「QZone群相册/群号/」下（整册模式为每相册一个 ZIP）。首次批量下载浏览器会询问「是否允许下载多个文件」，请点允许。<br>「逐张原图」模式需在<b>相册详情页</b>使用（点进某个相册后再扫描下载）；整册 ZIP 在本页即可用。</div>
    </div>`;
  document.documentElement.appendChild(panel);

  // 拖动
  (function () {
    const head = panel.querySelector('#qzgp-head');
    let dragging = false, ox = 0, oy = 0, l = 0, t = 0;
    head.addEventListener('mousedown', (e) => {
      if (e.target.id === 'qzgp-toggle') return;
      dragging = true;
      const r = panel.getBoundingClientRect();
      l = r.left; t = r.top; ox = e.clientX; oy = e.clientY;
      panel.style.right = 'auto'; panel.style.bottom = 'auto';
      panel.style.left = l + 'px'; panel.style.top = t + 'px';
      e.preventDefault();
    });
    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      panel.style.left = Math.max(0, Math.min(innerWidth - 60, l + e.clientX - ox)) + 'px';
      panel.style.top = Math.max(0, Math.min(innerHeight - 30, t + e.clientY - oy)) + 'px';
    });
    document.addEventListener('mouseup', () => { dragging = false; });
  })();

  const $ = (s) => panel.querySelector(s);
  const logEl = $('#qzgp-log'), statusEl = $('#qzgp-status'), barEl = $('#qzgp-bar-i'), albumBox = $('#qzgp-albums');
  function log(msg) {
    logEl.textContent += `[${new Date().toTimeString().slice(0, 8)}] ${msg}\n`;
    logEl.scrollTop = logEl.scrollHeight;
  }
  function status(msg, pct) {
    statusEl.textContent = msg;
    if (pct !== undefined) barEl.style.width = Math.max(0, Math.min(100, pct)) + '%';
  }
  const mode = () => (panel.querySelector('input[name=qzgp-mode]:checked') || {}).value || 'zip';

  $('#qzgp-toggle').onclick = () => panel.classList.toggle('hidden');
  $('#qzgp-clear').onclick = () => { doneSet.clear(); saveProgress(); log('已清空「已下载」记录'); };

  /* ---- 相册列表：全选 / 取消全选 / 反选 ---- */
  const albumChecks = () => panel.querySelectorAll('.qzgp-a');
  function updateSelCount() {
    const all = albumChecks();
    if (!all.length) { $('#qzgp-selcount').textContent = '尚未扫描'; return; }
    const n = [...all].filter((c) => c.checked).length;
    $('#qzgp-selcount').textContent = `已选 ${n}/${all.length} 个相册`;
  }
  $('#qzgp-all').onclick = () => { albumChecks().forEach((c) => { c.checked = true; }); updateSelCount(); };
  $('#qzgp-none').onclick = () => { albumChecks().forEach((c) => { c.checked = false; }); updateSelCount(); };
  $('#qzgp-invert').onclick = () => { albumChecks().forEach((c) => { c.checked = !c.checked; }); updateSelCount(); };
  // 手动勾选时也同步计数（事件委托，列表重建后依然有效）
  albumBox.addEventListener('change', (e) => { if (e.target && e.target.classList.contains('qzgp-a')) updateSelCount(); });
  albumBox.addEventListener('click', (e) => { if (e.target && e.target.classList.contains('qzgp-a')) updateSelCount(); });

  /* =========================================================================
   * 7. 主流程
   * =======================================================================*/
  let albums = [];
  let stopped = false;
  const progressKey = 'qzgp_done_' + groupId;
  const doneSet = new Set(GM_getValue(progressKey, []));
  const saveProgress = () => GM_setValue(progressKey, [...doneSet].slice(-20000));

  const selected = () => [...panel.querySelectorAll('.qzgp-a:checked')].map((c) => albums[Number(c.value)]);

  $('#qzgp-scan').onclick = async () => {
    const btn = $('#qzgp-scan');
    btn.disabled = true;
    albumBox.innerHTML = '<div style="color:#8b94a3">扫描中…</div>';
    status('正在扫描相册…', 5);
    log('开始扫描，群号 ' + (groupId || '(未识别)') + '，token=' + (token() || '(无)'));
    if (!token()) log('⚠ 未取到 g_tk，请先登录 QQ 空间后刷新页面');

    albums = await scanAlbums(log);

    if (!albums.length) {
      albumBox.innerHTML = '<div style="color:#e06c75">未取到相册。请确认：已登录、当前在群相册页、群号正确。<br>（可打开控制台 F12 查看详细日志）</div>';
      status('扫描失败'); btn.disabled = false; return;
    }

    albumBox.innerHTML = albums.map((a, i) =>
      `<label><input type="checkbox" class="qzgp-a" value="${i}" checked>
        <span class="t">${escapeHtml(a.title)}</span>
        <span style="color:#8b94a3">${a.count ? '(' + a.count + '张)' : ''}</span></label>`).join('');
    $('#qzgp-start').disabled = false;
    updateSelCount();
    btn.disabled = false;
    log('✔ 共 ' + albums.length + ' 个相册');
    status('扫描完成：' + albums.length + ' 个相册', 0);
  };

  $('#qzgp-stop').onclick = () => { stopped = true; log('⏸ 正在停止…'); };

  // 兜底：任何未捕获的 Promise 异常都写进面板日志，不再污染控制台
  window.addEventListener('unhandledrejection', (e) => {
    try {
      const r = e && e.reason;
      log('⚠ 未捕获异常：' + ((r && (r.message || r.statusText)) || r));
    } catch (x) {}
    e.preventDefault && e.preventDefault();
  });

  $('#qzgp-copy').onclick = async () => {
    try {
    const picked = selected();
    if (!picked.length) { log('请先扫描并勾选相册'); return; }
    log('qzonetoken=' + (qzonetoken() ? qzonetoken().slice(0, 12) + '…（已取到）' : '(空)') + '，g_tk=' + token());
    const urls = [];
    for (const a of picked) {
      log('→ 请求打包链接：' + a.title);
      const u = await getAlbumZipUrl(a, log);
      if (u) urls.push(u); else log('  ✘ 失败：' + a.title);
      await sleep(1000);
    }
    if (!urls.length) {
      log('✘ 全部失败。请把上方以「·」开头的几行（含 HTTP 状态和返回内容）发给我，或改用「逐张原图」模式。');
      return;
    }
    const text = urls.join('\n');
    try { if (typeof GM_setClipboard === 'function') GM_setClipboard(text); else throw 0; }
    catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'absolute'; ta.style.opacity = 0;
      document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
    }
    log('✔ 已复制 ' + urls.length + ' 个 ZIP 链接到剪贴板（可粘贴到迅雷/IDM 批量下载）');
    } catch (e) {
      log('✘ 复制链接出错：' + ((e && e.message) || e));
    }
  };

  $('#qzgp-start').onclick = async () => {
    const scanBtn = $('#qzgp-scan'), startBtn = $('#qzgp-start'), stopBtn = $('#qzgp-stop');
    scanBtn.disabled = startBtn.disabled = true; stopBtn.disabled = false;
    stopped = false;

    CFG.concurrency = Math.max(1, Math.min(8, Number($('#qzgp-cc').value) || 3));
    CFG.delayMs = Math.max(0, Number($('#qzgp-dl').value) || 0);
    const skipDone = $('#qzgp-skip').checked;

    const picked = selected();
    if (!picked.length) {
      log('未选择相册'); scanBtn.disabled = false; startBtn.disabled = false; stopBtn.disabled = true; return;
    }

    const gname = sanitize('群' + (groupId || 'unknown'));

    /* ---------- 模式 A：整册打包 ZIP ---------- */
    if (mode() === 'zip') {
      let ok = 0, fail = 0;
      log('qzonetoken=' + (qzonetoken() ? qzonetoken().slice(0, 12) + '…（已取到）' : '(空)') + '，g_tk=' + token());
      for (let i = 0; i < picked.length; i++) {
        if (stopped) break;
        const a = picked[i];
        if (skipDone && doneSet.has('zip:' + a.id)) { log('  跳过（已下载）：' + a.title); ok++; continue; }
        status(`获取打包链接 ${i + 1}/${picked.length}：${a.title}`, (i / picked.length) * 100);
        const url = await getAlbumZipUrl(a, log);
        if (!url) {
          log('  ✘ 打包失败：' + a.title + '（改用「逐张原图」模式，或把上方 HTTP 状态那几行发我）');
          fail++; await sleep(CFG.zipDelayMs); continue;
        }
        log('  ↓ 开始下载：' + a.title);
        const okd = await saveFile(url, `${gname}/${sanitize(a.title)}.zip`);
        if (okd) { ok++; doneSet.add('zip:' + a.id); saveProgress(); log('  ✔ 完成：' + a.title); }
        else { fail++; log('  ✘ 下载失败：' + a.title); }
        await sleep(CFG.zipDelayMs);
      }
      status(`全部完成：成功 ${ok}，失败 ${fail}`, 100);
      log(`🎉 完成：成功 ${ok}，失败 ${fail}（共 ${picked.length} 个相册）`);
      scanBtn.disabled = false; startBtn.disabled = false; stopBtn.disabled = true;
      return;
    }

    /* ---------- 模式 B：逐张原图 ---------- */
    let totalOk = 0, totalFail = 0;
    for (const a of picked) {
      if (stopped) break;
      const aname = sanitize(a.title);
      log('▶ 相册：' + aname);
      // 逐张模式需要进入相册详情页才能拿到照片流；这里引导 + DOM 抓取
      const photos = await collectPhotosFromDOM(log);
      if (!photos.length) { log('  （未取到照片，跳过。建议在相册详情页使用该模式）'); continue; }

      const tasks = [], used = new Map();
      photos.forEach((p, i) => {
        const key = 'p:' + p.id;
        if (skipDone && doneSet.has(key)) return;
        let base = String(i + 1).padStart(4, '0') + (p.name && p.name !== 'unnamed' ? '_' + p.name : '');
        const n = used.get(base) || 0; used.set(base, n + 1);
        const fname = n ? base + '_' + n : base;
        tasks.push({ url: p.url, filename: `${gname}/${aname}/${fname}.${extOf(p.url)}`, key });
      });
      log('  待下载 ' + tasks.length + ' 张' + (tasks.length < photos.length ? `（跳过已下载 ${photos.length - tasks.length} 张）` : ''));

      const r = await pool(tasks, (t, success, o, f) => {
        if (success) doneSet.add(t.key);
        status(`${aname}：${o + f}/${tasks.length}（成功 ${o}·失败 ${f}）`, ((o + f) / tasks.length) * 100);
      }, () => stopped);
      totalOk += r.ok; totalFail += r.fail;
      saveProgress();
      log(`  ✔ ${aname} 完成：成功 ${r.ok}，失败 ${r.fail}`);
    }
    status(`全部完成：成功 ${totalOk}，失败 ${totalFail}`, 100);
    log(`🎉 完成：成功 ${totalOk}，失败 ${totalFail}`);
    if (totalFail) log('提示：失败多为限速，可降低并发、加大间隔后重跑（已下载会自动跳过）。');
    scanBtn.disabled = false; startBtn.disabled = false; stopBtn.disabled = true;
  };

  /* =========================================================================
   * 8. 接口侦察：把页面真实调用的接口打印到控制台，便于接口变更时自行适配
   * =======================================================================*/
  (function sniff() {
    const KEY = /qun_list_album|cgi_arch_photo|getPhotoList|getAlbumList|photolist/i;
    const report = (kind, url, text) => {
      if (!url || !KEY.test(url)) return;
      if (!sniffed.some((s) => s.url.split('?')[0] === url.split('?')[0])) sniffed.push({ url });
      console.log('[QZ-GP] ' + kind, url, text ? String(text).slice(0, 300) : '');
    };
    const _open = XMLHttpRequest.prototype.open, _send = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (m, url) { this.__url = url; return _open.apply(this, arguments); };
    XMLHttpRequest.prototype.send = function () {
      this.addEventListener('load', function () {
        try { report('XHR←', this.__url || this.responseURL, this.responseText); } catch (e) {}
      });
      return _send.apply(this, arguments);
    };
    const _fetch = window.fetch;
    window.fetch = function (input, init) {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      return _fetch.apply(this, arguments).then((res) => {
        if (res && res.ok && res.clone) res.clone().text().then((t) => report('FETCH←', url, t)).catch(() => {});
        return res;
      });
    };
    console.log('[QZ-GP] 接口侦察已开启：操作页面后可在控制台(F12)看到真实接口地址与返回样例。');
  })();

  log('脚本已就绪（群号 ' + (groupId || '未识别') + '）。点「扫描相册」开始，推荐用「整册打包 ZIP」。');
})();

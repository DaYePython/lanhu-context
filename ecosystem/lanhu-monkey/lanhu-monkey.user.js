// ==UserScript==
// @name         蓝湖 lanhu-context 助手
// @namespace    https://github.com/DaYePython/lanhu-context
// @version      0.1.2
// @description  在蓝湖设计稿详情页与画布页复制设计稿链接与登录 Cookie，配合 lanhu-context CLI 使用。
// @license      MIT
// @icon         https://raw.githubusercontent.com/DaYePython/lanhu-context/main/ecosystem/browser-extension/public/icons/icon48.png
// @match        https://lanhuapp.com/web/*
// @connect      127.0.0.1
// @grant        GM_cookie
// @grant        GM_setClipboard
// @grant        GM_xmlhttpRequest
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const ITEM_ATTR = "data-lanhu-ext-item";
  function injectInto(dialog, specs, adapter) {
    const list = dialog.querySelector(adapter.listSelector);
    if (!list) return false;
    if (list.querySelector(`[${ITEM_ATTR}]`)) return false;
    adapter.insert(list, specs);
    return true;
  }
  function installMenuInjector(root, specs, adapters) {
    let disposed = false;
    let scheduled = false;
    const sweep = () => {
      for (const adapter of adapters) {
        for (const dialog of root.querySelectorAll(
          adapter.dialogSelector
        )) {
          injectInto(dialog, specs, adapter);
        }
      }
    };
    const schedule = () => {
      if (scheduled || disposed) return;
      scheduled = true;
      queueMicrotask(() => {
        scheduled = false;
        if (!disposed) sweep();
      });
    };
    sweep();
    const observer = new MutationObserver(schedule);
    observer.observe(root, { childList: true, subtree: true });
    return () => {
      disposed = true;
      observer.disconnect();
    };
  }
  const DIALOG_SELECTOR = ".detail_context_menu_dialog";
  const LIST_SELECTOR = ".mu-menu-list";
  const WRAPPER_CLASS = "mu-menu-item-wrapper";
  const RIPPLE_CLASS = "mu-ripple-wrapper";
  const ITEM_CLASS = "mu-menu-item";
  const TITLE_BOX_CLASS = "mu-menu-item-title";
  const TITLE_CLASS = "menu-item-title";
  const BADGE_BOX_CLASS = "key-icon";
  const BADGE_CLASS = "hotkey";
  const WRAPPER_STYLE = "user-select: none; outline: none; cursor: pointer; appearance: none;";
  const ITEM_FLAG = "lanhuExtItem";
  function buildDetailRow(spec) {
    const row = document.createElement("div");
    row.dataset[ITEM_FLAG] = spec.id;
    const wrapper = document.createElement("div");
    wrapper.className = WRAPPER_CLASS;
    wrapper.tabIndex = 0;
    wrapper.setAttribute("role", "menuitem");
    wrapper.setAttribute("style", WRAPPER_STYLE);
    const inner = document.createElement("div");
    const ripple = document.createElement("div");
    ripple.className = RIPPLE_CLASS;
    const item = document.createElement("div");
    item.className = ITEM_CLASS;
    const titleBox = document.createElement("div");
    titleBox.className = TITLE_BOX_CLASS;
    const title = document.createElement("span");
    title.className = TITLE_CLASS;
    title.textContent = spec.label;
    titleBox.append(title);
    const afterBox = document.createElement("div");
    if (spec.badge) {
      const keyIcon = document.createElement("span");
      keyIcon.className = BADGE_BOX_CLASS;
      const hotkey = document.createElement("span");
      hotkey.className = BADGE_CLASS;
      hotkey.textContent = spec.badge;
      keyIcon.append(hotkey);
      afterBox.append(keyIcon);
    }
    item.append(titleBox, afterBox);
    inner.append(ripple, item);
    wrapper.append(inner);
    row.append(wrapper);
    row.addEventListener("mouseup", (event) => event.stopPropagation());
    row.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    row.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      spec.onSelect();
    });
    return row;
  }
  const detailMenuAdapter = {
    dialogSelector: DIALOG_SELECTOR,
    listSelector: LIST_SELECTOR,
    insert(list, specs) {
      for (const spec of specs) list.append(buildDetailRow(spec));
    }
  };
  function correctedTop(box, viewportHeight, margin = 8) {
    const overflow = box.top + box.height + margin - viewportHeight;
    if (overflow <= 0) return null;
    return Math.max(margin, box.top - overflow);
  }
  const STAGE_DIALOG_SELECTOR = "#contextMenuWrap";
  const STAGE_LIST_SELECTOR = "ul.operate-list";
  const STAGE_ITEM_CLASS = "operate-item";
  const STAGE_LABEL_PREFIX = "lanhu-ext-";
  const STAGE_DESIGN_MENU_MARKER = "ul.operate-list p.shareImg";
  const STAGE_TREE_CURRENT_SELECTOR = "#navTreeRoot .l-tree-node.is-current.is-leafstate[node-id]";
  const STAGE_TREE_ID_ATTR = "node-id";
  function closeHostMenu() {
    document.body.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  }
  function buildStageRow(spec) {
    const row = document.createElement("li");
    row.className = STAGE_ITEM_CLASS;
    row.setAttribute(ITEM_ATTR, spec.id);
    const label = document.createElement("p");
    label.className = `${STAGE_LABEL_PREFIX}${spec.id}`;
    label.textContent = spec.label;
    label.style.whiteSpace = "nowrap";
    label.style.overflow = "hidden";
    label.style.textOverflow = "ellipsis";
    row.append(label);
    row.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      spec.onSelect();
      closeHostMenu();
    });
    return row;
  }
  function insertStageRows(list, specs) {
    const hostLast = list.lastElementChild;
    const rows = specs.map(buildStageRow);
    const first = rows[0];
    if (first && hostLast && !hostLast.querySelector("hr")) {
      first.prepend(document.createElement("hr"));
    }
    list.append(...rows);
    keepMenuInViewport(list.closest(STAGE_DIALOG_SELECTOR));
  }
  function keepMenuInViewport(dialog) {
    if (!(dialog instanceof HTMLElement)) return;
    const box = dialog.getBoundingClientRect();
    const top = correctedTop({ top: box.top, height: box.height }, innerHeight);
    if (top === null) return;
    dialog.style.top = `${top}px`;
    dialog.style.bottom = "unset";
  }
  const stageMenuAdapter = {
    dialogSelector: STAGE_DIALOG_SELECTOR,
    listSelector: STAGE_LIST_SELECTOR,
    insert: insertStageRows
  };
  function readStageImageId(root) {
    if (!root.querySelector(STAGE_DESIGN_MENU_MARKER)) return null;
    const rows = root.querySelectorAll(STAGE_TREE_CURRENT_SELECTOR);
    if (rows.length !== 1) return null;
    const id = rows[0]?.getAttribute(STAGE_TREE_ID_ATTR)?.trim();
    return id ? id : null;
  }
  const DEFAULT_BRIDGE_PORT = 7623;
  const BRIDGE_PATH = "/token";
  const LANHU_ORIGIN = "https://lanhuapp.com";
  const DESIGN_DETAIL_PATH = "item/project/detailDetach";
  const PLACEHOLDERS = new Set(["", "undefined", "null"]);
  function clean(value) {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return PLACEHOLDERS.has(trimmed) ? null : trimmed;
  }
  function parseHashParams(href) {
    const hashIndex = href.indexOf("#");
    if (hashIndex === -1) return null;
    const fragment = href.slice(hashIndex + 1);
    const queryIndex = fragment.indexOf("?");
    if (queryIndex === -1) return null;
    return new URLSearchParams(fragment.slice(queryIndex + 1));
  }
  function resolveDesignRefParts(href, storage, imageIdOverride) {
    const params = parseHashParams(href);
    const fromUrl = (...keys) => {
      if (!params) return null;
      for (const key of keys) {
        const value = clean(params.get(key));
        if (value) return value;
      }
      return null;
    };
    const fromStorage = (key) => {
      try {
        return clean(storage.getItem(key));
      } catch {
        return null;
      }
    };
    return {
      teamId: fromUrl("tid", "teamId", "team_id") ?? fromStorage("team_id"),
      projectId: fromUrl("pid", "project_id") ?? fromStorage("pid"),

imageId: clean(imageIdOverride) ?? fromUrl("image_id", "docId")
    };
  }
  function buildDesignUrl(ref) {
    const params = new URLSearchParams({
      tid: ref.teamId,
      pid: ref.projectId,
      project_id: ref.projectId,
      image_id: ref.imageId
    });
    return `${LANHU_ORIGIN}/web/#/${DESIGN_DETAIL_PATH}?${params.toString()}`;
  }
  const TOAST_ATTR = "data-lanhu-ext-toast";
  function toast(message) {
    const el = document.createElement("div");
    el.setAttribute(TOAST_ATTR, "");
    el.textContent = message;
    el.style.cssText = [
      "position:fixed",
      "z-index:99999",
      "left:50%",
      "top:24px",
      "transform:translateX(-50%)",
      "padding:8px 16px",
      "border-radius:4px",
      "background:rgba(0,0,0,.82)",
      "color:#fff",
      "font-size:13px",
      "pointer-events:none"
    ].join(";");
    document.body.append(el);
    setTimeout(() => el.remove(), 2400);
  }
  const PARAM_LABELS = {
    teamId: "tid",
    projectId: "pid",
    imageId: "image_id"
  };
  async function copyDesignUrl(platform) {
    const parts = resolveDesignRefParts(
      location.href,
      localStorage,
      readStageImageId(document)
    );
    const missing = Object.keys(PARAM_LABELS).filter((key) => !parts[key]);
    if (missing.length > 0) {
      toast(
        `未识别到设计稿参数：缺少 ${missing.map((key) => PARAM_LABELS[key]).join(" / ")}`
      );
      return;
    }
    const url = buildDesignUrl({
      teamId: parts.teamId,
      projectId: parts.projectId,
      imageId: parts.imageId
    });
    const ok = await platform.copyText(url);
    toast(ok ? "已复制设计稿链接" : "复制失败，请检查剪贴板权限");
  }
  async function copyCookies(platform) {
    const result = await platform.readCookieHeader();
    if (!result.ok) {
      toast(`获取 Cookie 失败：${result.error}`);
      return;
    }
    const ok = await platform.copyText(result.token);
    if (!ok) {
      toast("复制失败");
      return;
    }
    const base = "已复制 Cookie，可粘贴到 lanhu auth set";
    toast(result.note ? `${base}；${result.note}` : base);
  }
  async function sendCookies(platform) {
    const result = await platform.sendCookieHeader();
    if (!result.ok) {
      toast(`发送失败：${result.error}`);
      return;
    }
    const base = "已发送到本机 lanhu auth listen";
    toast(result.note ? `${base}；${result.note}` : base);
  }
  function installLanhuContextMenu(root, platform) {
    const specs = [
      {
        id: "copy-design-url",
        label: "复制选中设计稿链接",
        badge: "CLI",
        onSelect: () => void copyDesignUrl(platform)
      },
      {
        id: "copy-cookies",
        label: "复制 cookies",
        badge: "CLI",
        onSelect: () => void copyCookies(platform)
      },
      {
        id: "send-cookies",
        label: "发送 cookies 到本机",
        badge: "CLI",
        onSelect: () => void sendCookies(platform)
      }
    ];
    return installMenuInjector(root, specs, [
      detailMenuAdapter,
      stageMenuAdapter
    ]);
  }
  function sortCookies(cookies) {
    return [...cookies].sort(
      (a, b) => (b.path ?? "/").length - (a.path ?? "/").length
    );
  }
  function formatCookieHeader(cookies) {
    return sortCookies(cookies).filter((cookie) => cookie.name.length > 0).map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
  }
  function mergeCookies(privileged, fromPage) {
    const seen = new Set(privileged.map((cookie) => cookie.name));
    return [...privileged, ...fromPage.filter((cookie) => !seen.has(cookie.name))];
  }
  async function collectCookieHeader(api, fromPage = []) {
    const cookies = await api.getAll({ domain: "lanhuapp.com" });
    const header = formatCookieHeader(mergeCookies(cookies, fromPage));
    if (!header) throw new Error("NO_COOKIES");
    return header;
  }
  async function sendCookieHeader$1(fetchFn, port, token, extraHeaders) {
    try {
      const response = await fetchFn(`http://127.0.0.1:${port}${BRIDGE_PATH}`, {
        method: "POST",
        headers: { "content-type": "application/json", ...extraHeaders },
        body: JSON.stringify({ lanhuToken: token })
      });
      return { ok: response.ok, status: response.status };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
  async function copyText$1(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return copyViaTextarea(text);
    }
  }
  function copyViaTextarea(text) {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.append(textarea);
    textarea.select();
    try {
      return document.execCommand("copy");
    } catch {
      return false;
    } finally {
      textarea.remove();
    }
  }
  function parseDocumentCookie(raw) {
    const cookies = [];
    for (const part of raw.split(";")) {
      const pair = part.trim();
      if (!pair) continue;
      const eq = pair.indexOf("=");
      if (eq <= 0) continue;
      cookies.push({ name: pair.slice(0, eq), value: pair.slice(eq + 1) });
    }
    return cookies;
  }
  var _GM_cookie = (() => typeof GM_cookie != "undefined" ? GM_cookie : void 0)();
  var _GM_setClipboard = (() => typeof GM_setClipboard != "undefined" ? GM_setClipboard : void 0)();
  var _GM_xmlhttpRequest = (() => typeof GM_xmlhttpRequest != "undefined" ? GM_xmlhttpRequest : void 0)();
  const NO_COOKIE_ERROR = "未找到 lanhuapp.com 的 Cookie，请先登录";
  const HTTP_ONLY_NOTE = "本次未含 HttpOnly Cookie（Tampermonkey 需在 设置 → Security → Allow scripts to access cookies 选 All）；若 lanhu auth test 失败请改用浏览器扩展";
  function listGmCookies(domain) {
    return new Promise((resolve, reject) => {
      try {
        _GM_cookie.list({ domain }, (cookies, error) => {
          if (error) reject(new Error(String(error)));
          else resolve(cookies ?? []);
        });
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }
  async function readCookieHeader() {
    try {
      const token = await collectCookieHeader(
        { getAll: ({ domain }) => listGmCookies(domain) },
        parseDocumentCookie(document.cookie)
      );
      return { ok: true, token };
    } catch {
    }
    const header = formatCookieHeader(parseDocumentCookie(document.cookie));
    if (!header) return { ok: false, error: NO_COOKIE_ERROR };
    return { ok: true, token: header, note: HTTP_ONLY_NOTE };
  }
  const gmFetch = (url, init) => new Promise((resolve, reject) => {
    _GM_xmlhttpRequest({
      url,
      method: "POST",
      headers: init.headers,
      data: init.body,
      onload: (response) => resolve({
        ok: response.status >= 200 && response.status < 300,
        status: response.status
      }),
      onerror: () => reject(new Error("无法连接本机接收端（请先运行 lanhu auth listen）")),
      ontimeout: () => reject(new Error("连接本机接收端超时"))
    });
  });
  async function sendCookieHeader() {
    const read = await readCookieHeader();
    if (!read.ok) return { ok: false, error: read.error };
    const result = await sendCookieHeader$1(
      gmFetch,
      DEFAULT_BRIDGE_PORT,
      read.token,
      {
        "x-lanhu-bridge": "lanhu-monkey"
      }
    );
    if (!result.ok) {
      return {
        ok: false,
        error: result.error ?? `本机接收端返回 ${result.status}（请先运行 lanhu auth listen）`
      };
    }
    return read.note ? { ok: true, note: read.note } : { ok: true };
  }
  async function copyText(text) {
    try {
      _GM_setClipboard(text, "text");
      return true;
    } catch {
      return copyText$1(text);
    }
  }
  const gmPlatform = {
    copyText,
    readCookieHeader,
    sendCookieHeader
  };
  installLanhuContextMenu(document.body, gmPlatform);

})();
(function () {
  "use strict";

  const STORAGE_KEY = "rbx-bulk-unfriend-page-size";
  const API_MAX_LIMIT = 50;
  const PAGE_SIZE_OPTIONS = [20, 50, 100];
  const DEFAULT_PAGE_SIZE = 50;
  const UNFRIEND_DELAY_MS = 1500;
  const RATE_LIMIT_FALLBACK_SEC = 30;
  const RATE_LIMIT_MIN_SEC = 15;
  const RATE_LIMIT_MAX_SEC = 180;
  const RATE_LIMIT_MAX_RETRIES = 12;
  const TOAST_DURATION_MS = 3800;
  const ROOT_ID = "rbx-bulk-unfriend-root";
  const STYLE_ID = "rbx-bulk-unfriend-style";
  const TOAST_HOST_ID = "rbx-bulk-toast-host";
  const MODAL_ID = "rbx-bulk-modal-root";

  /** @type {{ id: number, name?: string, displayName?: string, imageUrl?: string, isFollowing?: boolean }[]} */
  let currentFriends = [];
  /** @type {Set<number>} */
  let selectedIds = new Set();
  let pageCursor = "";
  let nextCursor = null;
  /** @type {string[]} */
  let prevCursorStack = [];
  let currentPage = 1;
  let totalFriendsCount = 0;
  let busy = false;
  let initialLoadStarted = false;
  let menuOutsideBound = false;

  function isFriendsPage() {
    return /\/users\/friends/i.test(location.pathname);
  }

  function isFriendsTab() {
    if (!isFriendsPage()) return false;
    const hash = (location.hash || "").toLowerCase();
    if (!hash || hash === "#" || hash === "#!") return true;
    if (hash.includes("friend-request")) return false;
    if (hash.includes("following")) return false;
    if (hash.includes("followers")) return false;
    return hash.includes("friends");
  }

  function getPageSize() {
    const raw = Number(localStorage.getItem(STORAGE_KEY));
    if (PAGE_SIZE_OPTIONS.includes(raw)) return raw;
    return DEFAULT_PAGE_SIZE;
  }

  function setPageSize(value) {
    const n = Number(value);
    const size = PAGE_SIZE_OPTIONS.includes(n) ? n : DEFAULT_PAGE_SIZE;
    localStorage.setItem(STORAGE_KEY, String(size));
    return size;
  }

  function getMyUserId() {
    const id = window.Roblox?.CurrentUser?.userId;
    if (id) return String(id);
    const meta = document.querySelector('meta[name="user-data"]');
    if (meta?.dataset?.userid) return String(meta.dataset.userid);
    throw new Error("Could not find your user ID (are you logged in?)");
  }

  function getCsrfToken() {
    if (window.Roblox?.XsrfToken?.getToken) {
      return window.Roblox.XsrfToken.getToken();
    }
    const meta = document.querySelector('meta[name="csrf-token"]');
    return meta?.content || "";
  }

  function setCsrfToken(token) {
    if (token && window.Roblox?.XsrfToken?.setToken) {
      window.Roblox.XsrfToken.setToken(token);
    }
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function friendLabel(friend) {
    return friend?.displayName || friend?.name || (friend?.id != null ? String(friend.id) : "Unknown");
  }

  function ensureToastHost() {
    let host = document.getElementById(TOAST_HOST_ID);
    if (host) return host;
    host = document.createElement("div");
    host.id = TOAST_HOST_ID;
    document.body.appendChild(host);
    return host;
  }

  /**
   * @param {string} message
   * @param {"success"|"error"|"info"} [type]
   * @param {number} [durationMs]
   */
  function showToast(message, type = "info", durationMs = TOAST_DURATION_MS) {
    const host = ensureToastHost();
    const toast = document.createElement("div");
    toast.className = `rbx-bulk-toast rbx-bulk-toast-${type}`;
    toast.setAttribute("role", "status");

    const icon = document.createElement("span");
    icon.className = "rbx-bulk-toast-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = type === "success" ? "\u2713" : type === "error" ? "!" : "i";

    const msg = document.createElement("div");
    msg.className = "rbx-bulk-toast-msg";
    msg.textContent = message;

    toast.append(icon, msg);
    host.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add("show"));

    const hideMs = Math.max(1400, durationMs);
    window.setTimeout(() => {
      toast.classList.remove("show");
      toast.classList.add("hide");
      window.setTimeout(() => toast.remove(), 320);
    }, hideMs);
  }

  /**
   * Custom confirm modal.
   * @param {{ title: string, message: string, confirmText?: string, cancelText?: string, danger?: boolean }} opts
   * @returns {Promise<boolean>}
   */
  function showConfirm(opts) {
    const {
      title,
      message,
      confirmText = "Confirm",
      cancelText = "Cancel",
      danger = false,
    } = opts;

    return new Promise((resolve) => {
      const existing = document.getElementById(MODAL_ID);
      if (existing) existing.remove();

      const root = document.createElement("div");
      root.id = MODAL_ID;
      root.innerHTML = `
        <div class="rbx-bulk-modal-backdrop" data-action="cancel"></div>
        <div class="rbx-bulk-modal" role="dialog" aria-modal="true" aria-labelledby="rbx-bulk-modal-title">
          <div class="rbx-bulk-modal-accent ${danger ? "danger" : ""}"></div>
          <h3 id="rbx-bulk-modal-title" class="rbx-bulk-modal-title"></h3>
          <p class="rbx-bulk-modal-message"></p>
          <div class="rbx-bulk-modal-actions">
            <button type="button" class="rbx-bulk-modal-cancel" data-action="cancel"></button>
            <button type="button" class="rbx-bulk-modal-confirm ${danger ? "danger" : ""}" data-action="confirm"></button>
          </div>
        </div>
      `;

      root.querySelector(".rbx-bulk-modal-title").textContent = title;
      root.querySelector(".rbx-bulk-modal-message").textContent = message;
      root.querySelector(".rbx-bulk-modal-cancel").textContent = cancelText;
      root.querySelector(".rbx-bulk-modal-confirm").textContent = confirmText;

      const finish = (value) => {
        root.classList.add("closing");
        window.setTimeout(() => {
          root.remove();
          document.removeEventListener("keydown", onKey);
          resolve(value);
        }, 180);
      };

      const onKey = (e) => {
        if (e.key === "Escape") finish(false);
        if (e.key === "Enter") finish(true);
      };

      root.addEventListener("click", (e) => {
        const action = e.target?.closest?.("[data-action]")?.dataset?.action;
        if (action === "cancel") finish(false);
        if (action === "confirm") finish(true);
      });

      document.addEventListener("keydown", onKey);
      document.body.appendChild(root);
      requestAnimationFrame(() => root.classList.add("open"));
      root.querySelector(".rbx-bulk-modal-confirm")?.focus();
    });
  }

  function setStatus(text, isError) {
    const el = document.querySelector("#rbx-bulk-status");
    if (!el) return;
    el.textContent = text || "";
    el.classList.toggle("is-error", !!isError);
  }

  function parseRetryAfterSeconds(res) {
    const raw = res.headers.get("retry-after") || res.headers.get("Retry-After");
    if (raw) {
      const asInt = Number(raw);
      if (Number.isFinite(asInt) && asInt >= 0) {
        // Roblox sometimes sends milliseconds (e.g. 5000) instead of seconds
        if (asInt > 1000 && asInt < 600000) return Math.ceil(asInt / 1000);
        return Math.ceil(asInt);
      }
      const asDate = Date.parse(raw);
      if (!Number.isNaN(asDate)) {
        return Math.max(1, Math.ceil((asDate - Date.now()) / 1000));
      }
    }

    const reset =
      res.headers.get("x-ratelimit-reset") ||
      res.headers.get("ratelimit-reset") ||
      res.headers.get("x-rate-limit-reset");
    if (reset) {
      const n = Number(reset);
      if (Number.isFinite(n)) {
        // unix seconds vs ms
        const resetMs = n > 1e12 ? n : n * 1000;
        const sec = Math.ceil((resetMs - Date.now()) / 1000);
        if (sec > 0) return sec;
      }
    }

    return null;
  }

  /**
   * @param {Response} res
   * @param {number} attempt 1-based retry count
   */
  function computeRateLimitWaitSeconds(res, attempt) {
    const fromHeader = parseRetryAfterSeconds(res);
    const exponential = Math.min(
      RATE_LIMIT_MAX_SEC,
      RATE_LIMIT_FALLBACK_SEC * Math.pow(2, Math.max(0, attempt - 1))
    );
    // Prefer the longer wait \u2014 short Retry-After values often keep failing on Roblox
    const wait = Math.max(RATE_LIMIT_MIN_SEC, fromHeader || 0, exponential);
    return Math.min(RATE_LIMIT_MAX_SEC, wait);
  }

  /**
   * @param {Response} res
   * @param {string} [context]
   * @param {number} [attempt]
   */
  async function waitForRetryAfter(res, context, attempt = 1) {
    let seconds = computeRateLimitWaitSeconds(res, attempt);
    const prefix = context ? `${context} \u2014 ` : "";
    while (seconds > 0) {
      setStatus(`${prefix}429 rate limited, waiting ${seconds}s\u2026`, true);
      await sleep(1000);
      seconds -= 1;
    }
    setStatus(`${prefix}Retrying\u2026`);
  }

  function getTotalPages() {
    const size = getPageSize();
    if (!totalFriendsCount || size < 1) return Math.max(1, currentPage);
    return Math.max(1, Math.ceil(totalFriendsCount / size));
  }

  function updatePagerUi() {
    const totalPages = getTotalPages();
    const label = `Page ${currentPage} of ${totalPages}`;
    document.querySelectorAll(".rbx-bulk-page-label").forEach((el) => {
      el.textContent = label;
    });
    const canPrev = !busy && prevCursorStack.length > 0;
    const canNext = !busy && !!nextCursor;
    document.querySelectorAll(".rbx-bulk-prev").forEach((btn) => {
      btn.disabled = !canPrev;
    });
    document.querySelectorAll(".rbx-bulk-next").forEach((btn) => {
      btn.disabled = !canNext;
    });
  }

  function updateSelectionUi() {
    const countEl = document.querySelector("#rbx-bulk-selected-count");
    const btn = document.querySelector("#rbx-bulk-unfriend-btn");
    const n = selectedIds.size;
    if (countEl) countEl.textContent = String(n);
    if (btn) {
      btn.textContent = `Unfriend selected (${n})`;
      btn.disabled = busy || n === 0;
    }
    updatePagerUi();
  }

  function syncPageSizeButtons() {
    const size = getPageSize();
    document.querySelectorAll(".rbx-bulk-size-btn").forEach((btn) => {
      btn.classList.toggle("active", Number(btn.dataset.size) === size);
    });
  }

  async function apiFetch(url, options = {}) {
    return fetch(url, {
      credentials: "include",
      ...options,
      headers: {
        Accept: "application/json",
        ...(options.headers || {}),
      },
    });
  }

  async function apiFetchWith429(url, options = {}, context = "API") {
    let retries429 = 0;
    while (true) {
      const res = await apiFetch(url, options);
      if (res.status !== 429) return res;
      if (retries429 >= RATE_LIMIT_MAX_RETRIES) return res;
      retries429 += 1;
      await waitForRetryAfter(res, context, retries429);
    }
  }

  async function fetchFriendsCount(userId) {
    const res = await apiFetchWith429(
      `https://friends.roblox.com/v1/users/${userId}/friends/count`,
      {},
      "Friends count"
    );
    if (!res.ok) throw new Error(`Failed to load friends count (HTTP ${res.status})`);
    const data = await res.json();
    return Number(data.count ?? data.Count ?? 0) || 0;
  }

  async function fetchFriendsPage(userId, startCursor, pageSize) {
    const items = [];
    let cursor = startCursor || "";
    let lastNext = null;
    let remaining = pageSize;

    while (remaining > 0) {
      const batch = Math.min(API_MAX_LIMIT, remaining);
      const url =
        `https://friends.roblox.com/v1/users/${userId}/friends/find` +
        `?limit=${batch}&cursor=${encodeURIComponent(cursor)}&userSort=1`;
      const res = await apiFetchWith429(url, {}, "Loading friends");
      if (!res.ok) throw new Error(`Failed to load friends (HTTP ${res.status})`);
      const data = await res.json();
      const pageItems = data.PageItems || data.pageItems || data.data || [];
      for (const item of pageItems) {
        const id = Number(item.id ?? item.Id);
        if (Number.isFinite(id)) items.push({ id });
      }
      lastNext = data.NextCursor ?? data.nextCursor ?? null;
      if (!lastNext || pageItems.length === 0) {
        lastNext = null;
        break;
      }
      cursor = lastNext;
      remaining = pageSize - items.length;
      if (pageItems.length < batch) break;
    }

    return { items, nextCursor: lastNext };
  }

  async function enrichUsers(ids) {
    if (!ids.length) return {};
    /** @type {Record<number, { name?: string, displayName?: string, imageUrl?: string }>} */
    const map = {};

    for (let i = 0; i < ids.length; i += 100) {
      const chunk = ids.slice(i, i + 100);
      try {
        const res = await apiFetch("https://users.roblox.com/v1/users", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userIds: chunk, excludeBannedUsers: false }),
        });
        if (!res.ok) continue;
        const data = await res.json();
        for (const u of data.data || []) {
          map[u.id] = {
            ...(map[u.id] || {}),
            name: u.name,
            displayName: u.displayName || u.name,
          };
        }
      } catch (err) {
        console.warn("[rbx-bulk] enrich users failed", err);
      }
    }

    for (let i = 0; i < ids.length; i += 100) {
      const chunk = ids.slice(i, i + 100);
      try {
        const qs = chunk.map((id) => `userIds=${id}`).join("&");
        const url =
          `https://thumbnails.roblox.com/v1/users/avatar-headshot?${qs}` +
          `&size=150x150&format=Png&isCircular=false`;
        const res = await apiFetch(url);
        if (!res.ok) continue;
        const data = await res.json();
        for (const t of data.data || []) {
          if (t.targetId && t.imageUrl) {
            map[t.targetId] = { ...(map[t.targetId] || {}), imageUrl: t.imageUrl };
          }
        }
      } catch (err) {
        console.warn("[rbx-bulk] enrich thumbnails failed", err);
      }
    }

    return map;
  }

  async function applyCsrfRetry(doPost, res) {
    if (res.status !== 403) return res;
    const fresh = res.headers.get("x-csrf-token");
    if (!fresh) return res;
    setCsrfToken(fresh);
    return doPost(fresh);
  }

  async function postFriendsAction(pathSuffix, targetUserId, actionLabel) {
    const doPost = async (token) =>
      apiFetch(`https://friends.roblox.com/v1/users/${targetUserId}/${pathSuffix}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-TOKEN": token || "",
        },
        body: "{}",
      });

    let res = await doPost(getCsrfToken());
    res = await applyCsrfRetry(doPost, res);

    let retries429 = 0;
    while (res.status === 429 && retries429 < RATE_LIMIT_MAX_RETRIES) {
      retries429 += 1;
      await waitForRetryAfter(res, actionLabel, retries429);
      res = await doPost(getCsrfToken());
      res = await applyCsrfRetry(doPost, res);
    }

    if (res.status === 429) {
      throw new Error(
        `${actionLabel} still rate-limited after ${RATE_LIMIT_MAX_RETRIES} retries. Try again in a few minutes.`
      );
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`${actionLabel} failed (HTTP ${res.status})${text ? `: ${text.slice(0, 100)}` : ""}`);
    }
  }

  async function unfriendOne(targetUserId, displayLabel) {
    const label = displayLabel || `user ${targetUserId}`;
    await postFriendsAction("unfriend", targetUserId, `Unfriending ${label}`);
  }

  async function unfollowOne(targetUserId, displayLabel) {
    const label = displayLabel || `user ${targetUserId}`;
    await postFriendsAction("unfollow", targetUserId, `Unfollowing ${label}`);
  }

  async function followOne(targetUserId, displayLabel) {
    const label = displayLabel || `user ${targetUserId}`;
    await postFriendsAction("follow", targetUserId, `Following ${label}`);
  }

  /** @returns {Promise<Record<number, boolean>>} */
  async function fetchFollowingMap(ids) {
    /** @type {Record<number, boolean>} */
    const map = {};
    if (!ids.length) return map;

    for (let i = 0; i < ids.length; i += 100) {
      const chunk = ids.slice(i, i + 100);
      try {
        const doPost = async (token) =>
          apiFetch("https://friends.roblox.com/v1/user/following-exists", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-CSRF-TOKEN": token || "",
            },
            body: JSON.stringify({ targetUserIds: chunk }),
          });

        let res = await doPost(getCsrfToken());
        res = await applyCsrfRetry(doPost, res);
        if (res.status === 429) {
          await waitForRetryAfter(res, "Follow status", 1);
          res = await doPost(getCsrfToken());
          res = await applyCsrfRetry(doPost, res);
        }
        if (!res.ok) continue;
        const data = await res.json();
        for (const row of data.followings || []) {
          map[row.userId] = !!row.isFollowing;
        }
      } catch (err) {
        console.warn("[rbx-bulk] following-exists failed", err);
      }
    }
    return map;
  }

  function hideNativeFriendsUi() {
    document
      .querySelectorAll(
        "ul.hlist.avatar-cards, .friends-content .container-header, .friends-content .friends-subtitle, .friends-content .chip-filters-container, .friends-content .friends-filter"
      )
      .forEach((el) => {
        if (el.closest(`#${ROOT_ID}`)) return;
        el.style.setProperty("display", "none", "important");
        el.setAttribute("data-rbx-bulk-hidden", "1");
      });
  }

  function restoreNativeFriendsUi() {
    document.querySelectorAll("[data-rbx-bulk-hidden]").forEach((el) => {
      el.style.removeProperty("display");
      el.removeAttribute("data-rbx-bulk-hidden");
    });
  }

  function ensureStyles() {
    const existing = document.getElementById(STYLE_ID);
    if (existing) existing.remove();
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      #${TOAST_HOST_ID} {
        position: fixed;
        top: 80px;
        right: 24px;
        z-index: 2147483646;
        display: flex;
        flex-direction: column;
        gap: 8px;
        pointer-events: none;
        max-width: min(340px, calc(100vw - 32px));
      }
      .rbx-bulk-toast {
        pointer-events: auto;
        display: flex;
        gap: 8px;
        align-items: center;
        padding: 8px 12px;
        border-radius: 10px;
        color: #fff;
        border: none;
        box-shadow: 0 10px 28px rgba(0,0,0,.35);
        opacity: 0;
        transform: translateX(12px) scale(.98);
        transition: opacity .22s ease, transform .22s ease;
        overflow: hidden;
      }
      .rbx-bulk-toast.show {
        opacity: 1;
        transform: translateX(0) scale(1);
      }
      .rbx-bulk-toast.hide {
        opacity: 0;
        transform: translateX(10px) scale(.98);
      }
      .rbx-bulk-toast-icon {
        flex-shrink: 0;
        width: 18px;
        height: 18px;
        border-radius: 50%;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-size: 11px;
        font-weight: 700;
        background: rgba(255,255,255,.22);
        color: #fff;
      }
      .rbx-bulk-toast-msg {
        min-width: 0;
        flex: 1;
        font-size: 13px;
        line-height: 1.25;
        font-weight: 600;
        color: #fff;
      }
      .rbx-bulk-toast-success { background: #1f9d63; }
      .rbx-bulk-toast-error { background: #d64555; }
      .rbx-bulk-toast-info { background: #3b7ddd; }

      #${MODAL_ID} {
        position: fixed;
        inset: 0;
        z-index: 2147483647;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 20px;
        opacity: 0;
        transition: opacity .2s ease;
      }
      #${MODAL_ID}.open { opacity: 1; }
      #${MODAL_ID}.closing { opacity: 0; }
      #${MODAL_ID} .rbx-bulk-modal-backdrop {
        position: absolute;
        inset: 0;
        background: rgba(6, 8, 12, 0.72);
        backdrop-filter: blur(6px);
        -webkit-backdrop-filter: blur(6px);
      }
      #${MODAL_ID} .rbx-bulk-modal {
        position: relative;
        width: min(420px, 100%);
        padding: 22px 22px 18px;
        border-radius: 18px;
        background: linear-gradient(165deg, #232a35 0%, #171b22 100%);
        border: 1px solid rgba(255,255,255,.08);
        box-shadow: 0 24px 80px rgba(0,0,0,.55);
        color: #f4f6f8;
        transform: translateY(10px) scale(.98);
        transition: transform .22s ease;
        overflow: hidden;
      }
      #${MODAL_ID}.open .rbx-bulk-modal { transform: translateY(0) scale(1); }
      #${MODAL_ID} .rbx-bulk-modal-accent {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        height: 3px;
        background: linear-gradient(90deg, #6aa8ff, #3dd68c);
      }
      #${MODAL_ID} .rbx-bulk-modal-accent.danger {
        background: linear-gradient(90deg, #ff6b7a, #ff9f43);
      }
      #${MODAL_ID} .rbx-bulk-modal-title {
        margin: 4px 0 8px;
        font-size: 18px;
        font-weight: 700;
        letter-spacing: .01em;
      }
      #${MODAL_ID} .rbx-bulk-modal-message {
        margin: 0 0 20px;
        font-size: 14px;
        line-height: 1.5;
        color: #b8c0cc;
        white-space: pre-wrap;
      }
      #${MODAL_ID} .rbx-bulk-modal-actions {
        display: flex;
        justify-content: flex-end;
        gap: 10px;
      }
      #${MODAL_ID} .rbx-bulk-modal-cancel,
      #${MODAL_ID} .rbx-bulk-modal-confirm {
        padding: 10px 16px;
        border-radius: 11px;
        border: 1px solid rgba(255,255,255,.1);
        background: rgba(255,255,255,.04);
        color: #f4f6f8;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
      }
      #${MODAL_ID} .rbx-bulk-modal-cancel:hover {
        background: rgba(255,255,255,.08);
      }
      #${MODAL_ID} .rbx-bulk-modal-confirm {
        background: #4ea1ff;
        border-color: transparent;
        color: #081018;
      }
      #${MODAL_ID} .rbx-bulk-modal-confirm:hover {
        filter: brightness(1.06);
      }
      #${MODAL_ID} .rbx-bulk-modal-confirm.danger {
        background: #ff5c6c;
        color: #fff;
      }
      #${ROOT_ID} {
        --bulk-bg: transparent;
        --bulk-panel: rgba(255, 255, 255, 0.04);
        --bulk-card: rgba(255, 255, 255, 0.045);
        --bulk-card-hover: rgba(255, 255, 255, 0.08);
        --bulk-border: rgba(255, 255, 255, 0.1);
        --bulk-text: #f0f2f5;
        --bulk-muted: #9aa3af;
        --bulk-accent: #4ea1ff;
        --bulk-danger: #ef5350;
        --bulk-menu-bg: #1c1f26;
        position: relative;
        z-index: 5;
        margin: 4px 0 20px;
        padding: 12px 4px 8px;
        border: none;
        border-radius: 0;
        background: transparent;
        color: var(--bulk-text);
        font-family: inherit;
        box-shadow: none;
      }
      #${ROOT_ID} .rbx-bulk-toolbar,
      #${ROOT_ID} .rbx-bulk-pager {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        align-items: center;
      }
      #${ROOT_ID} .rbx-bulk-toolbar {
        margin-bottom: 14px;
        padding: 12px;
        padding-bottom: 12px;
        border: 1px solid var(--bulk-border);
        border-radius: 12px;
        background: rgba(255, 255, 255, 0.03);
      }
      #${ROOT_ID} .rbx-bulk-title {
        font-size: 16px;
        font-weight: 700;
        margin-right: 6px;
      }
      #${ROOT_ID} .rbx-bulk-size-group {
        display: inline-flex;
        border: 1px solid var(--bulk-border);
        border-radius: 10px;
        overflow: hidden;
      }
      #${ROOT_ID} .rbx-bulk-size-btn {
        border: none;
        border-radius: 0;
        border-right: 1px solid var(--bulk-border);
        background: var(--bulk-panel);
        color: var(--bulk-muted);
        min-width: 48px;
      }
      #${ROOT_ID} .rbx-bulk-size-btn:last-child { border-right: none; }
      #${ROOT_ID} .rbx-bulk-size-btn.active {
        background: var(--bulk-accent);
        color: #0b1220;
        font-weight: 700;
      }
      #${ROOT_ID} button {
        padding: 7px 12px;
        border-radius: 9px;
        border: 1px solid var(--bulk-border);
        background: var(--bulk-panel);
        color: var(--bulk-text);
        cursor: pointer;
        font-size: 13px;
        transition: border-color .15s, background .15s, opacity .15s;
      }
      #${ROOT_ID} button:hover:not(:disabled) { border-color: var(--bulk-accent); }
      #${ROOT_ID} button:disabled { opacity: 0.45; cursor: not-allowed; }
      #${ROOT_ID} #rbx-bulk-unfriend-btn {
        background: var(--bulk-danger);
        border-color: #c62828;
        color: #fff;
      }
      #${ROOT_ID} .rbx-bulk-meta { color: var(--bulk-muted); font-size: 13px; }
      #${ROOT_ID} #rbx-bulk-status {
        width: 100%;
        font-size: 12px;
        min-height: 1.2em;
        color: var(--bulk-muted);
      }
      #${ROOT_ID} #rbx-bulk-status.is-error { color: #ff8a80; }
      #${ROOT_ID} .rbx-bulk-pager {
        justify-content: center;
        gap: 12px;
        padding: 10px 0;
      }
      #${ROOT_ID} .rbx-bulk-pager.top { padding-top: 0; }
      #${ROOT_ID} .rbx-bulk-page-label {
        min-width: 110px;
        text-align: center;
        font-weight: 600;
        font-size: 13px;
      }
      #${ROOT_ID} .rbx-bulk-grid {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
        gap: 10px;
        overflow: visible;
      }
      #${ROOT_ID} .rbx-bulk-card {
        position: relative;
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 10px 12px;
        background: var(--bulk-card);
        border: 1px solid var(--bulk-border);
        border-radius: 12px;
        transition: background .15s, border-color .15s;
        overflow: visible;
      }
      #${ROOT_ID} .rbx-bulk-card:hover {
        background: var(--bulk-card-hover);
        border-color: #4a5565;
      }
      #${ROOT_ID} .rbx-bulk-card.selected {
        border-color: var(--bulk-accent);
        background: rgba(78, 161, 255, 0.12);
        box-shadow: inset 0 0 0 1px rgba(78,161,255,.2);
      }
      #${ROOT_ID} .rbx-bulk-card input[type="checkbox"] {
        width: 18px;
        height: 18px;
        flex-shrink: 0;
        accent-color: var(--bulk-accent);
        cursor: pointer;
      }
      #${ROOT_ID} .rbx-bulk-avatar-link {
        flex-shrink: 0;
        display: block;
        border-radius: 50%;
        overflow: hidden;
        width: 52px;
        height: 52px;
        outline: 2px solid transparent;
        transition: outline-color .15s;
      }
      #${ROOT_ID} .rbx-bulk-avatar-link:hover { outline-color: var(--bulk-accent); }
      #${ROOT_ID} .rbx-bulk-avatar-link img {
        width: 52px;
        height: 52px;
        display: block;
        object-fit: cover;
        background: #111;
      }
      #${ROOT_ID} .rbx-bulk-card .meta {
        min-width: 0;
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      #${ROOT_ID} .rbx-bulk-card .name-link,
      #${ROOT_ID} .rbx-bulk-card .user-link {
        text-decoration: none;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 100%;
      }
      #${ROOT_ID} .rbx-bulk-card .name-link {
        font-weight: 650;
        font-size: 14px;
        color: var(--bulk-text);
      }
      #${ROOT_ID} .rbx-bulk-card .name-link:hover { color: var(--bulk-accent); }
      #${ROOT_ID} .rbx-bulk-card .user-link {
        font-size: 12px;
        color: var(--bulk-muted);
      }
      #${ROOT_ID} .rbx-bulk-card .user-link:hover { color: #c5ccd6; }
      #${ROOT_ID} .rbx-bulk-menu-wrap {
        position: relative;
        flex-shrink: 0;
        z-index: 1;
        /* Keep pointer over wrap while moving into the menu */
        padding-bottom: 0;
      }
      #${ROOT_ID} .rbx-bulk-menu-wrap.open { z-index: 100000; }
      #${ROOT_ID} .rbx-bulk-menu-btn {
        width: 34px;
        height: 34px;
        padding: 0;
        border-radius: 9px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-size: 18px;
        line-height: 1;
        letter-spacing: 1px;
        color: var(--bulk-muted);
        background: transparent;
      }
      #${ROOT_ID} .rbx-bulk-menu-btn:hover {
        color: var(--bulk-text);
        background: rgba(255,255,255,.06);
      }
      #${ROOT_ID} .rbx-bulk-menu {
        display: none;
        position: absolute;
        /* Overlap button so there is no dead gap */
        top: calc(100% - 2px);
        right: 0;
        min-width: 196px;
        padding: 6px;
        border-radius: 12px;
        border: 1px solid var(--bulk-border);
        background: var(--bulk-menu-bg);
        box-shadow: 0 12px 40px rgba(0,0,0,.55);
        z-index: 100001;
      }
      /* Invisible bridge above the menu panel */
      #${ROOT_ID} .rbx-bulk-menu::before {
        content: "";
        position: absolute;
        left: 0;
        right: 0;
        top: -12px;
        height: 14px;
      }
      #${ROOT_ID} .rbx-bulk-menu-wrap.open .rbx-bulk-menu { display: block; }
      #${ROOT_ID} .rbx-bulk-menu button {
        width: 100%;
        text-align: left;
        border: none;
        background: transparent;
        border-radius: 8px;
        padding: 9px 10px;
        color: var(--bulk-text);
        font-size: 13px;
      }
      #${ROOT_ID} .rbx-bulk-menu button:hover {
        background: rgba(78,161,255,.14);
        border-color: transparent;
      }
      #${ROOT_ID} .rbx-bulk-menu button.danger { color: #ff8a80; }
      #${ROOT_ID} .rbx-bulk-menu button.danger:hover {
        background: rgba(239,83,80,.16);
      }
      #${ROOT_ID} .rbx-bulk-menu-sep {
        height: 1px;
        margin: 4px 6px;
        background: var(--bulk-border);
      }
    `;
    document.head.appendChild(style);
  }

  /**
   * Mount ONLY inside the Friends tab body (under "My Friends" + tabs).
   * Never prepend to #content \u2014 that puts the panel above the page header.
   */
  function findMountPoint() {
    const friendsContent =
      document.querySelector("#friends .friends-content.section") ||
      document.querySelector("#friends .friends-content") ||
      document.querySelector(".tab-pane.active .friends-content.section") ||
      document.querySelector(".tab-pane.active .friends-content") ||
      document.querySelector(".friends-content.section") ||
      document.querySelector(".friends-content");
    if (friendsContent) return friendsContent;

    // Active friends tab pane itself
    const friendsTab =
      document.querySelector("#friends.tab-pane") ||
      document.querySelector("#friends") ||
      document.querySelector('.rbx-tab-content .tab-pane.active');
    if (friendsTab) return friendsTab;

    return null;
  }

  function isCorrectlyMounted(root) {
    if (!root || !root.parentElement) return false;
    const parent = root.parentElement;
    // Must live under friends-content or the friends tab pane \u2014 not as sibling of page-header
    if (parent.classList?.contains("friends-content")) return true;
    if (parent.id === "friends") return true;
    if (parent.classList?.contains("tab-pane") && parent.querySelector(".friends-content")) {
      return true;
    }
    // Wrong: direct child of #content / page-content / friends-web-app
    if (parent.id === "content" || parent.id === "friends-web-app") return false;
    if (parent.classList?.contains("page-content")) return false;
    return false;
  }

  /** Place root as first child of the friends list area (under header/tabs). */
  function placeRoot(root) {
    const point = findMountPoint();
    if (!point) return false;

    // Prefer after native header block inside friends-content, still under My Friends page
    const nativeHeader =
      point.querySelector(":scope > .container-header") ||
      point.querySelector(":scope > div > .container-header")?.parentElement;

    if (nativeHeader && nativeHeader.parentElement === point) {
      if (root.parentElement !== point || root.previousElementSibling !== nativeHeader) {
        nativeHeader.after(root);
      }
    } else if (root.parentElement !== point || point.firstElementChild !== root) {
      point.prepend(root);
    }
    return true;
  }

  function profileUrl(userId) {
    return `https://www.roblox.com/users/${userId}/profile`;
  }

  function closeAllMenus() {
    document.querySelectorAll(`#${ROOT_ID} .rbx-bulk-menu-wrap.open`).forEach((el) => {
      el.classList.remove("open");
    });
  }

  async function copyText(text, label) {
    try {
      await navigator.clipboard.writeText(text);
      showToast(`${label} copied.`, "success");
    } catch (err) {
      console.error(err);
      showToast(`Could not copy ${label.toLowerCase()}.`, "error");
    }
  }

  async function openChatWithUser(userId) {
    const ok = await showConfirm({
      title: "Start chat?",
      message: "Open a chat conversation with this user?",
      confirmText: "Open chat",
      cancelText: "Cancel",
    });
    if (!ok) return;

    try {
      const chat = window.Roblox?.Chat;
      if (chat?.startConversationWithUserId) {
        chat.startConversationWithUserId(userId);
        showToast("Chat opened.", "success");
        return;
      }
      if (chat?.Conversations?.startNewConversation) {
        chat.Conversations.startNewConversation(userId);
        showToast("Chat opened.", "success");
        return;
      }

      const body = JSON.stringify({ participantUserId: Number(userId) });
      let res = await apiFetch("https://chat.roblox.com/v2/start-one-to-one-conversation", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-TOKEN": getCsrfToken() || "",
        },
        body,
      });
      if (res.status === 403) {
        const fresh = res.headers.get("x-csrf-token");
        if (fresh) {
          setCsrfToken(fresh);
          res = await apiFetch("https://chat.roblox.com/v2/start-one-to-one-conversation", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-CSRF-TOKEN": fresh,
            },
            body,
          });
        }
      }
      if (res.status === 429) {
        await waitForRetryAfter(res, "Chat");
        res = await apiFetch("https://chat.roblox.com/v2/start-one-to-one-conversation", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-CSRF-TOKEN": getCsrfToken() || "",
          },
          body,
        });
      }

      const chatContainer = document.querySelector("#chat-container, .chat-container");
      if (chatContainer) {
        chatContainer.classList.remove("collapsed");
        chatContainer.classList.add("chat-open");
      }

      if (!res.ok) {
        throw new Error(`Chat request failed (HTTP ${res.status})`);
      }
      showToast("Chat started \u2014 check the chat panel.", "success");
    } catch (err) {
      console.error(err);
      showToast(err.message || "Could not open chat.", "error");
    }
  }

  async function unfriendFromMenu(friend) {
    const label = friendLabel(friend);
    const ok = await showConfirm({
      title: "Unfriend?",
      message: `You are about to unfriend ${label}.\n\nThis cannot be undone.`,
      confirmText: "Unfriend",
      cancelText: "Cancel",
      danger: true,
    });
    if (!ok) return;
    try {
      setStatus(`Unfriending ${label}\u2026`);
      await unfriendOne(friend.id, label);
      selectedIds.delete(friend.id);
      showToast(`You unfriended ${label}.`, "success");
      setStatus("");
      await loadPage("reload-same");
    } catch (err) {
      console.error(err);
      showToast(err.message || `Failed to unfriend ${label}.`, "error");
      setStatus(err.message || String(err), true);
    }
  }

  async function unfollowFromMenu(friend) {
    const label = friendLabel(friend);
    const ok = await showConfirm({
      title: "Unfollow?",
      message: `Stop following ${label}?`,
      confirmText: "Unfollow",
      cancelText: "Cancel",
      danger: true,
    });
    if (!ok) return;
    try {
      setStatus(`Unfollowing ${label}\u2026`);
      await unfollowOne(friend.id, label);
      friend.isFollowing = false;
      showToast(`You unfollowed ${label}.`, "success");
      setStatus("");
      renderCards();
    } catch (err) {
      console.error(err);
      showToast(err.message || `Failed to unfollow ${label}.`, "error");
      setStatus(err.message || String(err), true);
    }
  }

  async function followFromMenu(friend) {
    const label = friendLabel(friend);
    const ok = await showConfirm({
      title: "Follow?",
      message: `Follow ${label}?`,
      confirmText: "Follow",
      cancelText: "Cancel",
    });
    if (!ok) return;
    try {
      setStatus(`Following ${label}\u2026`);
      await followOne(friend.id, label);
      friend.isFollowing = true;
      showToast(`You followed ${label}.`, "success");
      setStatus("");
      renderCards();
    } catch (err) {
      console.error(err);
      showToast(err.message || `Failed to follow ${label}.`, "error");
      setStatus(err.message || String(err), true);
    }
  }

  function pagerHtml(extraClass) {
    return `
      <div class="rbx-bulk-pager ${extraClass || ""}">
        <button type="button" class="rbx-bulk-prev">\u2190 Previous</button>
        <span class="rbx-bulk-page-label">Page 1 of 1</span>
        <button type="button" class="rbx-bulk-next">Next \u2192</button>
      </div>
    `;
  }

  function renderCards() {
    const list = document.querySelector("#rbx-bulk-list");
    if (!list) return;
    closeAllMenus();
    list.innerHTML = "";

    const placeholder =
      "data:image/svg+xml," +
      encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="52" height="52"><rect fill="#333" width="52" height="52"/></svg>'
      );

    for (const friend of currentFriends) {
      const li = document.createElement("li");
      li.className = "rbx-bulk-card" + (selectedIds.has(friend.id) ? " selected" : "");
      li.dataset.userId = String(friend.id);

      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.title = "Select";
      cb.checked = selectedIds.has(friend.id);
      cb.addEventListener("change", () => {
        if (cb.checked) selectedIds.add(friend.id);
        else selectedIds.delete(friend.id);
        li.classList.toggle("selected", cb.checked);
        updateSelectionUi();
      });

      const avatarLink = document.createElement("a");
      avatarLink.className = "rbx-bulk-avatar-link";
      avatarLink.href = profileUrl(friend.id);
      avatarLink.title = "Open profile";
      const img = document.createElement("img");
      img.alt = friendLabel(friend);
      img.src = friend.imageUrl || placeholder;
      avatarLink.appendChild(img);

      const meta = document.createElement("div");
      meta.className = "meta";
      const nameLink = document.createElement("a");
      nameLink.className = "name-link";
      nameLink.href = profileUrl(friend.id);
      nameLink.textContent = friendLabel(friend);
      const userLink = document.createElement("a");
      userLink.className = "user-link";
      userLink.href = profileUrl(friend.id);
      userLink.textContent = friend.name ? `@${friend.name}` : `#${friend.id}`;
      meta.append(nameLink, userLink);

      const menuWrap = document.createElement("div");
      menuWrap.className = "rbx-bulk-menu-wrap";

      const menuBtn = document.createElement("button");
      menuBtn.type = "button";
      menuBtn.className = "rbx-bulk-menu-btn";
      menuBtn.setAttribute("aria-label", "Actions");
      menuBtn.title = "Actions";
      menuBtn.textContent = "\u22EF";
      menuBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const wasOpen = menuWrap.classList.contains("open");
        closeAllMenus();
        if (!wasOpen) menuWrap.classList.add("open");
      });

      const menu = document.createElement("div");
      menu.className = "rbx-bulk-menu";
      menu.setAttribute("role", "menu");

      const addItem = (label, onClick, className) => {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = label;
        if (className) b.className = className;
        b.addEventListener("click", async (e) => {
          e.preventDefault();
          e.stopPropagation();
          closeAllMenus();
          try {
            await onClick();
          } catch (err) {
            console.error(err);
            showToast(err.message || "Action failed.", "error");
          }
        });
        menu.appendChild(b);
      };

      addItem("Open profile", async () => {
        const ok = await showConfirm({
          title: "Open profile?",
          message: `Go to ${friendLabel(friend)}'s profile?`,
          confirmText: "Open",
          cancelText: "Cancel",
        });
        if (!ok) return;
        location.assign(profileUrl(friend.id));
      });
      addItem("Chat", () => openChatWithUser(friend.id));
      addItem("Copy username", async () => {
        const ok = await showConfirm({
          title: "Copy username?",
          message: `Copy @${friend.name || friend.id} to clipboard?`,
          confirmText: "Copy",
          cancelText: "Cancel",
        });
        if (!ok) return;
        await copyText(friend.name || String(friend.id), "Username");
      });
      addItem("Copy user ID", async () => {
        const ok = await showConfirm({
          title: "Copy user ID?",
          message: `Copy user ID ${friend.id} to clipboard?`,
          confirmText: "Copy",
          cancelText: "Cancel",
        });
        if (!ok) return;
        await copyText(String(friend.id), "User ID");
      });
      addItem("Copy profile link", async () => {
        const ok = await showConfirm({
          title: "Copy profile link?",
          message: `Copy the profile URL for ${friendLabel(friend)}?`,
          confirmText: "Copy",
          cancelText: "Cancel",
        });
        if (!ok) return;
        await copyText(profileUrl(friend.id), "Profile link");
      });

      const sep = document.createElement("div");
      sep.className = "rbx-bulk-menu-sep";
      menu.appendChild(sep);

      if (friend.isFollowing) {
        addItem("Unfollow", () => unfollowFromMenu(friend));
      } else {
        addItem("Follow", () => followFromMenu(friend));
      }
      addItem("Unfriend", () => unfriendFromMenu(friend), "danger");

      let closeTimer = null;
      menuWrap.addEventListener("mouseenter", () => {
        if (closeTimer) {
          clearTimeout(closeTimer);
          closeTimer = null;
        }
      });
      menuWrap.addEventListener("mouseleave", () => {
        closeTimer = window.setTimeout(() => {
          menuWrap.classList.remove("open");
          closeTimer = null;
        }, 180);
      });

      menuWrap.append(menuBtn, menu);
      li.append(cb, avatarLink, meta, menuWrap);
      list.appendChild(li);
    }
  }

  /** @param {"reset"|"next"|"prev"|"reload-same"} [direction] */
  async function loadPage(direction) {
    if (busy) return;
    busy = true;
    updateSelectionUi();
    setStatus("Loading friends\u2026");

    try {
      const userId = getMyUserId();
      const pageSize = getPageSize();
      syncPageSizeButtons();

      let cursor = pageCursor;
      if (direction === "next") {
        if (!nextCursor) {
          setStatus("No next page.");
          showToast("You're already on the last page.", "info");
          return;
        }
        prevCursorStack.push(pageCursor);
        cursor = nextCursor;
        currentPage += 1;
      } else if (direction === "prev") {
        if (!prevCursorStack.length) {
          setStatus("First page.");
          showToast("You're already on the first page.", "info");
          return;
        }
        cursor = prevCursorStack.pop() || "";
        currentPage = Math.max(1, currentPage - 1);
      } else if (direction === "reload-same") {
        cursor = pageCursor;
      } else {
        prevCursorStack = [];
        cursor = "";
        currentPage = 1;
        selectedIds.clear();
      }

      const { items, nextCursor: nxt } = await fetchFriendsPage(userId, cursor, pageSize);
      pageCursor = cursor;
      nextCursor = nxt;

      try {
        totalFriendsCount = await fetchFriendsCount(userId);
      } catch (countErr) {
        console.warn("[rbx-bulk] friends count", countErr);
        // Fallback estimate from current page if count fails
        if (!totalFriendsCount) {
          totalFriendsCount = (currentPage - 1) * pageSize + items.length + (nxt ? pageSize : 0);
        }
      }

      const ids = items.map((x) => x.id);
      const [enrich, followingMap] = await Promise.all([
        enrichUsers(ids),
        fetchFollowingMap(ids),
      ]);
      currentFriends = items.map((item) => ({
        id: item.id,
        name: enrich[item.id]?.name,
        displayName: enrich[item.id]?.displayName,
        imageUrl: enrich[item.id]?.imageUrl,
        isFollowing: !!followingMap[item.id],
      }));

      const visible = new Set(ids);
      selectedIds = new Set([...selectedIds].filter((id) => visible.has(id)));

      renderCards();
      setStatus(
        `${currentFriends.length} friends on page ${currentPage} of ${getTotalPages()} \u00B7 ${totalFriendsCount} total`
      );
    } catch (err) {
      console.error("[rbx-bulk-unfriend]", err);
      const msg = err.message || String(err);
      setStatus(msg, true);
      showToast(msg, "error");
    } finally {
      busy = false;
      updateSelectionUi();
    }
  }

  async function bulkUnfriend() {
    if (busy || selectedIds.size === 0) return;
    const ids = [...selectedIds];
    const ok = await showConfirm({
      title: "Unfriend selected?",
      message: `Unfriend ${ids.length} friend${ids.length === 1 ? "" : "s"}?\n\nThis cannot be undone.`,
      confirmText: ids.length === 1 ? "Unfriend" : `Unfriend ${ids.length}`,
      cancelText: "Cancel",
      danger: true,
    });
    if (!ok) return;

    busy = true;
    updateSelectionUi();
    let done = 0;
    let failed = 0;
    /** @type {string[]} */
    const failedNames = [];

    for (const id of ids) {
      const friend = currentFriends.find((f) => f.id === id);
      const label = friendLabel(friend || { id });
      setStatus(`Unfriending ${label}\u2026 (${done + failed + 1}/${ids.length})`);
      try {
        await unfriendOne(id, label);
        selectedIds.delete(id);
        done++;
      } catch (err) {
        console.error(err);
        failed++;
        failedNames.push(label);
        showToast(`Failed to unfriend ${label}: ${err.message || "unknown error"}`, "error");
        await sleep(Math.max(UNFRIEND_DELAY_MS, 3000));
      }
      await sleep(UNFRIEND_DELAY_MS);
    }

    busy = false;
    updateSelectionUi();

    if (done > 0) {
      showToast(
        done === 1 ? "1 friend removed." : `${done} friends removed.`,
        "success",
        4500
      );
    }
    if (failed > 0) {
      showToast(
        `${failed} unfriend${failed === 1 ? "" : "s"} failed${failedNames.length ? `: ${failedNames.slice(0, 3).join(", ")}${failedNames.length > 3 ? "\u2026" : ""}` : "."}`,
        "error",
        5000
      );
    }

    setStatus(
      done || failed
        ? `Done: ${done} removed${failed ? `, ${failed} failed` : ""}.`
        : ""
    );
    await loadPage("reload-same");
  }

  function buildUi() {
    let root = document.getElementById(ROOT_ID);
    if (root) {
      if (!isCorrectlyMounted(root)) placeRoot(root);
      return;
    }

    if (!findMountPoint()) return;

    const sizeButtons = PAGE_SIZE_OPTIONS.map(
      (n) => `<button type="button" class="rbx-bulk-size-btn" data-size="${n}">${n}</button>`
    ).join("");

    root = document.createElement("div");
    root.id = ROOT_ID;
    root.innerHTML = `
      <div class="rbx-bulk-toolbar">
        <span class="rbx-bulk-title">Friends list</span>
        <span class="rbx-bulk-meta">Per page</span>
        <div class="rbx-bulk-size-group">${sizeButtons}</div>
        <button type="button" id="rbx-bulk-select-all">Select all</button>
        <button type="button" id="rbx-bulk-select-none">Clear selection</button>
        <button type="button" id="rbx-bulk-unfriend-btn">Unfriend selected (0)</button>
        <span class="rbx-bulk-meta">Selected: <span id="rbx-bulk-selected-count">0</span></span>
        <div id="rbx-bulk-status"></div>
      </div>
      ${pagerHtml("top")}
      <ul id="rbx-bulk-list" class="rbx-bulk-grid"></ul>
      ${pagerHtml("bottom")}
    `;

    if (!placeRoot(root)) {
      root.remove();
      return;
    }
    ensureToastHost();

    if (!menuOutsideBound) {
      menuOutsideBound = true;
      document.addEventListener(
        "click",
        (e) => {
          if (!e.target.closest(`#${ROOT_ID} .rbx-bulk-menu-wrap`)) closeAllMenus();
        },
        true
      );
    }

    root.querySelectorAll(".rbx-bulk-size-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        try {
          setPageSize(btn.dataset.size);
          syncPageSizeButtons();
          loadPage("reset");
        } catch (err) {
          showToast(err.message || "Could not change page size.", "error");
        }
      });
    });
    root.querySelector("#rbx-bulk-select-all").addEventListener("click", () => {
      for (const f of currentFriends) selectedIds.add(f.id);
      renderCards();
      updateSelectionUi();
    });
    root.querySelector("#rbx-bulk-select-none").addEventListener("click", () => {
      selectedIds.clear();
      renderCards();
      updateSelectionUi();
    });
    root.querySelectorAll(".rbx-bulk-prev").forEach((btn) => {
      btn.addEventListener("click", () => loadPage("prev"));
    });
    root.querySelectorAll(".rbx-bulk-next").forEach((btn) => {
      btn.addEventListener("click", () => loadPage("next"));
    });
    root.querySelector("#rbx-bulk-unfriend-btn").addEventListener("click", () => {
      bulkUnfriend().catch((err) => {
        console.error(err);
        showToast(err.message || "Bulk unfriend failed.", "error");
      });
    });

    syncPageSizeButtons();
    updateSelectionUi();
  }

  function mount() {
    if (!isFriendsTab()) {
      unmount();
      return;
    }
    if (!findMountPoint()) return;

    ensureStyles();
    hideNativeFriendsUi();
    buildUi();

    const root = document.getElementById(ROOT_ID);
    if (root && !isCorrectlyMounted(root)) placeRoot(root);

    if (!initialLoadStarted && document.getElementById(ROOT_ID)) {
      initialLoadStarted = true;
      loadPage("reset");
    }
  }

  function unmount() {
    const root = document.getElementById(ROOT_ID);
    if (root) root.remove();
    restoreNativeFriendsUi();
    initialLoadStarted = false;
    currentFriends = [];
    currentPage = 1;
    totalFriendsCount = 0;
  }

  function syncVisibility() {
    if (isFriendsTab()) mount();
    else unmount();
  }

  const observer = new MutationObserver(() => {
    if (!isFriendsTab()) return;
    hideNativeFriendsUi();
    const root = document.getElementById(ROOT_ID);
    if (!root) {
      mount();
      return;
    }
    if (!isCorrectlyMounted(root) && findMountPoint()) {
      placeRoot(root);
    }
  });

  function start() {
    if (!isFriendsPage()) return;
    try {
      ensureStyles();
      ensureToastHost();
      syncVisibility();
      observer.observe(document.body, { childList: true, subtree: true });
      window.addEventListener("hashchange", () => {
        initialLoadStarted = false;
        syncVisibility();
      });
    } catch (err) {
      console.error("[rbx-bulk-unfriend] start failed", err);
      try {
        ensureStyles();
        showToast(err.message || "Friends script failed to start.", "error");
      } catch (_) {}
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();

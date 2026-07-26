// ==UserScript==
// @name         Roblox Util
// @namespace    https://github.com/SiSchu/robloxutil
// @version      1.0.4
// @description  Loader for Roblox Util scripts (friends bulk unfriend + home game stats)
// @author       SiSchu
// @homepageURL  https://github.com/SiSchu/robloxutil
// @supportURL   https://github.com/SiSchu/robloxutil/issues
// @downloadURL  https://raw.githubusercontent.com/SiSchu/robloxutil/main/robloxutil.user.js
// @updateURL    https://raw.githubusercontent.com/SiSchu/robloxutil/main/robloxutil.meta.js
// @match        https://www.roblox.com/users/friends*
// @match        https://www.roblox.com/*/users/friends*
// @match        https://www.roblox.com/home*
// @match        https://www.roblox.com/*/home*
// @match        https://web.roblox.com/users/friends*
// @match        https://web.roblox.com/*/users/friends*
// @match        https://web.roblox.com/home*
// @match        https://web.roblox.com/*/home*
// @run-at       document-idle
// @grant        none
// @require      https://raw.githubusercontent.com/SiSchu/robloxutil/main/modules/bulk-unfriend.js?v=1.0.4
// @require      https://raw.githubusercontent.com/SiSchu/robloxutil/main/modules/home-game-stats.js?v=1.0.4
// ==/UserScript==

(function () {
  "use strict";

  const INSTALL_URL =
    "https://raw.githubusercontent.com/SiSchu/robloxutil/main/robloxutil.user.js";
  const META_URL =
    "https://raw.githubusercontent.com/SiSchu/robloxutil/main/robloxutil.meta.js";
  const BANNER_ID = "rbx-util-update-banner";
  const LOCAL_VERSION =
    typeof GM_info !== "undefined" && GM_info?.script?.version
      ? String(GM_info.script.version)
      : "1.0.4";

  console.info("[robloxutil] loader ready", LOCAL_VERSION, location.pathname);

  /**
   * @param {string} a
   * @param {string} b
   * @returns {number} 1 if a>b, -1 if a<b, 0 if equal
   */
  function cmpVersion(a, b) {
    const parts = (v) =>
      String(v)
        .split(/[.+-]/)
        .map((x) => {
          const n = parseInt(x, 10);
          return Number.isFinite(n) ? n : 0;
        });
    const pa = parts(a);
    const pb = parts(b);
    const n = Math.max(pa.length, pb.length);
    for (let i = 0; i < n; i++) {
      const da = pa[i] || 0;
      const db = pb[i] || 0;
      if (da > db) return 1;
      if (da < db) return -1;
    }
    return 0;
  }

  /**
   * @param {string} text
   * @returns {string|null}
   */
  function parseVersion(text) {
    const m = String(text).match(/\/\/\s*@version\s+(\S+)/);
    return m ? m[1] : null;
  }

  /**
   * @param {string} remoteVersion
   * @param {string} dismissKey
   */
  function showUpdatePrompt(remoteVersion, dismissKey) {
    if (document.getElementById(BANNER_ID)) return;

    const style = document.createElement("style");
    style.textContent = `
      #${BANNER_ID} {
        position: fixed;
        z-index: 2147483646;
        right: 16px;
        bottom: 16px;
        max-width: min(360px, calc(100vw - 32px));
        padding: 12px 14px;
        border-radius: 8px;
        background: #1e1e22;
        color: #e8e8ec;
        border: 1px solid rgba(255,255,255,0.12);
        box-shadow: 0 8px 28px rgba(0,0,0,0.35);
        font: 600 13px/1.35 "Builder Sans", "Helvetica Neue", Arial, sans-serif;
      }
      #${BANNER_ID} p {
        margin: 0 0 10px;
        font-weight: 500;
        opacity: 0.92;
      }
      #${BANNER_ID} .rbx-util-actions {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }
      #${BANNER_ID} a,
      #${BANNER_ID} button {
        appearance: none;
        border: 0;
        border-radius: 6px;
        padding: 7px 10px;
        font: inherit;
        cursor: pointer;
        text-decoration: none;
      }
      #${BANNER_ID} a {
        background: #00a2ff;
        color: #fff;
      }
      #${BANNER_ID} button {
        background: rgba(255,255,255,0.08);
        color: #e8e8ec;
      }
    `;
    document.documentElement.appendChild(style);

    const banner = document.createElement("div");
    banner.id = BANNER_ID;
    banner.innerHTML = `
      <p>Roblox Util <strong>${remoteVersion}</strong> is available (you have ${LOCAL_VERSION}).</p>
      <div class="rbx-util-actions">
        <a href="${INSTALL_URL}" target="_blank" rel="noopener">Update</a>
        <button type="button" data-action="later">Later</button>
      </div>
    `;
    banner.querySelector('[data-action="later"]')?.addEventListener("click", () => {
      try {
        localStorage.setItem(dismissKey, "1");
      } catch (_) {}
      banner.remove();
    });
    document.documentElement.appendChild(banner);
  }

  async function checkForUpdate() {
    try {
      const res = await fetch(`${META_URL}?t=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) return;
      const remote = parseVersion(await res.text());
      if (!remote || cmpVersion(remote, LOCAL_VERSION) <= 0) return;
      const dismissKey = `rbx-util-update-dismissed:${remote}`;
      try {
        if (localStorage.getItem(dismissKey)) return;
      } catch (_) {}
      showUpdatePrompt(remote, dismissKey);
    } catch (err) {
      console.debug("[robloxutil] update check skipped", err);
    }
  }

  checkForUpdate();
})();

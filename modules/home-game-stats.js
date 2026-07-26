(function () {
  "use strict";

  const STYLE_ID = "rbx-home-game-stats-style";
  const MARK_ATTR = "data-rbx-home-stats";
  const BATCH_SIZE = 100;
  const DEBOUNCE_MS = 400;
  const GAMES_API = "https://games.roblox.com/v1/games";

  /** @type {Map<number, { playing: number, visits: number }>} */
  const cache = new Map();
  /** @type {Set<number>} */
  const inflight = new Set();
  let debounceTimer = 0;
  let observerStarted = false;

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .rbx-home-visits-label,
      .rbx-home-playing-label {
        white-space: nowrap;
      }
      .rbx-home-stats-sep {
        opacity: 0.55;
        margin: 0 1px;
        font-weight: 600;
      }
      .game-card-info .rbx-home-visits-label,
      .wide-game-tile-metadata .rbx-home-visits-label,
      .hover-metadata .rbx-home-visits-label {
        font-weight: 500;
      }
    `;
    document.documentElement.appendChild(style);
  }

  /**
   * @param {number} n
   * @returns {string}
   */
  function formatAbbrev(n) {
    const num = Number(n);
    if (!Number.isFinite(num) || num < 0) return "\u2014";
    if (num < 1000) return String(Math.round(num));
    const units = [
      { v: 1e9, s: "B" },
      { v: 1e6, s: "M" },
      { v: 1e3, s: "K" },
    ];
    for (const u of units) {
      if (num >= u.v) return (num / u.v).toFixed(2) + u.s;
    }
    return String(Math.round(num));
  }

  /**
   * @param {string} href
   * @returns {number|null}
   */
  function universeIdFromHref(href) {
    try {
      const u = new URL(href, location.origin);
      const fromQuery = u.searchParams.get("universeId");
      if (fromQuery && /^\d+$/.test(fromQuery)) return Number(fromQuery);
    } catch {
      /* ignore */
    }
    return null;
  }

  /**
   * @param {HTMLAnchorElement} link
   * @returns {number|null}
   */
  function getUniverseId(link) {
    const fromHref = universeIdFromHref(link.href || "");
    if (fromHref) return fromHref;
    if (link.id && /^\d+$/.test(link.id)) return Number(link.id);
    return null;
  }

  /**
   * @param {HTMLElement} info
   * @param {{ playing: number, visits: number }} stats
   */
  function applyStatsToInfo(info, stats) {
    let playingLabel =
      info.querySelector(".playing-counts-label") ||
      info.querySelector(".rbx-home-playing-label");
    if (!playingLabel) {
      if (!info.querySelector(".icon-playing-counts-gray")) {
        const icon = document.createElement("span");
        icon.className = "info-label icon-playing-counts-gray";
        icon.setAttribute("aria-hidden", "true");
        info.appendChild(icon);
      }
      playingLabel = document.createElement("span");
      playingLabel.className = "info-label playing-counts-label rbx-home-playing-label";
      info.appendChild(playingLabel);
    }
    playingLabel.textContent = formatAbbrev(stats.playing);
    playingLabel.title = `${stats.playing.toLocaleString()} playing`;
    playingLabel.setAttribute(MARK_ATTR, "1");

    let sep = info.querySelector(".rbx-home-stats-sep");
    if (!sep) {
      sep = document.createElement("span");
      sep.className = "info-label rbx-home-stats-sep";
      sep.setAttribute("aria-hidden", "true");
      sep.textContent = "\u00B7";
      info.appendChild(sep);
    }

    let visitsLabel = info.querySelector(".rbx-home-visits-label");
    if (!visitsLabel) {
      visitsLabel = document.createElement("span");
      visitsLabel.className = "info-label rbx-home-visits-label";
      info.appendChild(visitsLabel);
    }
    visitsLabel.textContent = formatAbbrev(stats.visits);
    visitsLabel.title = `${stats.visits.toLocaleString()} visits`;
    visitsLabel.setAttribute(MARK_ATTR, "1");
    info.setAttribute(MARK_ATTR, "1");
  }

  /**
   * @param {HTMLAnchorElement} link
   * @param {{ playing: number, visits: number }} stats
   */
  function applyStatsToLink(link, stats) {
    /** @type {HTMLElement[]} */
    const infos = [];
    const direct = link.querySelector(".game-card-info");
    if (direct) infos.push(/** @type {HTMLElement} */ (direct));

    const meta = link.querySelector(".wide-game-tile-metadata");
    if (meta) {
      const base =
        meta.querySelector(".base-metadata .game-card-info") ||
        meta.querySelector(".game-card-info");
      if (base) infos.push(/** @type {HTMLElement} */ (base));
      let hover = meta.querySelector(".hover-metadata");
      if (!hover) {
        hover = document.createElement("div");
        hover.className = "hover-metadata";
        meta.appendChild(hover);
      }
      let hoverInfo = hover.querySelector(".game-card-info");
      if (!hoverInfo) {
        hoverInfo = document.createElement("div");
        hoverInfo.className = "game-card-info";
        hoverInfo.setAttribute("data-testid", "game-tile-stats-extra");
        hover.appendChild(hoverInfo);
      }
      infos.push(/** @type {HTMLElement} */ (hoverInfo));
    }

    if (!infos.length) {
      const fallback = document.createElement("div");
      fallback.className = "game-card-info";
      fallback.setAttribute("data-testid", "game-tile-stats");
      link.appendChild(fallback);
      infos.push(fallback);
    }

    for (const info of infos) applyStatsToInfo(info, stats);
    link.setAttribute(MARK_ATTR, String(stats.playing) + ":" + String(stats.visits));
  }

  /**
   * @param {number[]} universeIds
   */
  async function fetchGames(universeIds) {
    const missing = universeIds.filter((id) => !cache.has(id) && !inflight.has(id));
    if (!missing.length) return;

    for (const id of missing) inflight.add(id);

    try {
      for (let i = 0; i < missing.length; i += BATCH_SIZE) {
        const chunk = missing.slice(i, i + BATCH_SIZE);
        const url = `${GAMES_API}?universeIds=${chunk.join(",")}`;
        const res = await fetch(url, {
          credentials: "include",
          headers: { Accept: "application/json" },
        });
        if (!res.ok) continue;
        const json = await res.json();
        const rows = Array.isArray(json?.data) ? json.data : [];
        for (const row of rows) {
          const id = Number(row.id);
          if (!Number.isFinite(id)) continue;
          cache.set(id, {
            playing: Number(row.playing) || 0,
            visits: Number(row.visits) || 0,
          });
        }
      }
    } finally {
      for (const id of missing) inflight.delete(id);
    }
  }

  async function enrichVisibleTiles() {
    ensureStyles();
    /** @type {HTMLAnchorElement[]} */
    const links = [...document.querySelectorAll("a.game-card-link")].filter(
      (a) => a instanceof HTMLAnchorElement
    );

    /** @type {Map<number, HTMLAnchorElement[]>} */
    const byUniverse = new Map();
    for (const link of links) {
      const uid = getUniverseId(link);
      if (!uid) continue;
      const list = byUniverse.get(uid) || [];
      list.push(link);
      byUniverse.set(uid, list);
    }

    const ids = [...byUniverse.keys()];
    if (!ids.length) return;

    await fetchGames(ids);

    for (const [uid, linkList] of byUniverse) {
      const stats = cache.get(uid);
      if (!stats) continue;
      for (const link of linkList) {
        const mark = link.getAttribute(MARK_ATTR);
        const next = `${stats.playing}:${stats.visits}`;
        if (mark === next && link.querySelector(".rbx-home-visits-label")) continue;
        applyStatsToLink(link, stats);
      }
    }
  }

  function scheduleEnrich() {
    window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(() => {
      enrichVisibleTiles().catch(() => {});
    }, DEBOUNCE_MS);
  }

  function startObserver() {
    if (observerStarted) return;
    observerStarted = true;
    const obs = new MutationObserver(() => scheduleEnrich());
    obs.observe(document.body, { childList: true, subtree: true });
  }

  function isHomePage() {
    return /\/home(?:\/|$)/i.test(location.pathname);
  }

  function boot() {
    if (!isHomePage()) return;
    const run = () => {
      if (!document.body) {
        window.setTimeout(run, 50);
        return;
      }
      console.info("[robloxutil] home game stats active", location.pathname);
      ensureStyles();
      startObserver();
      scheduleEnrich();
      window.setTimeout(scheduleEnrich, 1200);
      window.setTimeout(scheduleEnrich, 3000);
      window.setTimeout(scheduleEnrich, 6000);
    };
    run();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();

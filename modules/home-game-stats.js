(function () {
  "use strict";

  const STYLE_ID = "rbx-home-game-stats-style";
  const MARK_ATTR = "data-rbx-home-stats";
  // Roblox returns 400 "Too many universe IDs were requested" above ~50.
  const BATCH_SIZE = 50;
  const DEBOUNCE_MS = 400;
  const GAMES_API = "https://games.roblox.com/v1/games";
  const STORAGE_KEY = "rbx-home-game-stats-cache-v1";
  const CACHE_TTL_MS = 60_000;

  /**
   * In-memory cache for this page load. Hydrated from localStorage once.
   * Within a page load we never refetch an ID we already have (even past TTL).
   * @type {Map<number, { playing: number, visits: number, fetchedAt: number }>}
   */
  const cache = new Map();
  /** @type {Set<number>} */
  const inflight = new Set();
  let debounceTimer = 0;
  let observerStarted = false;
  let persistTimer = 0;

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
      .wide-game-tile-metadata .rbx-home-visits-label {
        font-weight: 500;
      }
    `;
    document.documentElement.appendChild(style);
  }

  function hydrateCacheFromStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return;
      const now = Date.now();
      for (const [key, value] of Object.entries(parsed)) {
        const id = Number(key);
        if (!Number.isFinite(id) || !value || typeof value !== "object") continue;
        const fetchedAt = Number(value.fetchedAt) || 0;
        if (now - fetchedAt > CACHE_TTL_MS) continue;
        cache.set(id, {
          playing: Number(value.playing) || 0,
          visits: Number(value.visits) || 0,
          fetchedAt,
        });
      }
    } catch {
      /* ignore corrupt cache */
    }
  }

  function schedulePersistCache() {
    window.clearTimeout(persistTimer);
    persistTimer = window.setTimeout(() => {
      try {
        /** @type {Record<string, { playing: number, visits: number, fetchedAt: number }>} */
        const out = {};
        const now = Date.now();
        for (const [id, entry] of cache) {
          if (now - entry.fetchedAt > CACHE_TTL_MS) continue;
          out[String(id)] = entry;
        }
        localStorage.setItem(STORAGE_KEY, JSON.stringify(out));
      } catch {
        /* quota / private mode */
      }
    }, 250);
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
   * Visible base stats only — never write into .hover-metadata (avoids doubled hover stats).
   * @param {HTMLAnchorElement} link
   * @returns {HTMLElement[]}
   */
  function collectInfoTargets(link) {
    /** @type {Set<HTMLElement>} */
    const infos = new Set();

    const wide = link.querySelector(".wide-game-tile-metadata");
    if (wide) {
      const baseInfo =
        wide.querySelector(".base-metadata .game-card-info") ||
        wide.querySelector(":scope > .base-metadata .game-card-info");
      if (baseInfo instanceof HTMLElement) infos.add(baseInfo);
    }

    for (const el of link.querySelectorAll(".game-card-info")) {
      if (!(el instanceof HTMLElement)) continue;
      if (el.closest(".hover-metadata")) continue;
      infos.add(el);
    }

    if (!infos.size) {
      const fallback = document.createElement("div");
      fallback.className = "game-card-info";
      fallback.setAttribute("data-testid", "game-tile-stats");
      link.appendChild(fallback);
      infos.add(fallback);
    }

    return [...infos];
  }

  /**
   * @param {HTMLAnchorElement} link
   * @param {{ playing: number, visits: number }} stats
   */
  function applyStatsToLink(link, stats) {
    for (const info of collectInfoTargets(link)) applyStatsToInfo(info, stats);
    link.setAttribute(MARK_ATTR, String(stats.playing) + ":" + String(stats.visits));
  }

  /**
   * @param {number[]} chunk
   */
  async function fetchGamesChunk(chunk) {
    if (!chunk.length) return;
    const url = `${GAMES_API}?universeIds=${chunk.join(",")}`;
    const res = await fetch(url, {
      credentials: "include",
      headers: { Accept: "application/json" },
    });
    if (res.ok) {
      const json = await res.json();
      const rows = Array.isArray(json?.data) ? json.data : [];
      const now = Date.now();
      for (const row of rows) {
        const id = Number(row.id);
        if (!Number.isFinite(id)) continue;
        cache.set(id, {
          playing: Number(row.playing) || 0,
          visits: Number(row.visits) || 0,
          fetchedAt: now,
        });
      }
      schedulePersistCache();
      return;
    }
    // Adaptive split if Roblox tightens the limit further.
    if (res.status === 400 && chunk.length > 1) {
      const mid = Math.ceil(chunk.length / 2);
      await fetchGamesChunk(chunk.slice(0, mid));
      await fetchGamesChunk(chunk.slice(mid));
      return;
    }
    console.warn("[robloxutil] games API failed", res.status, chunk.length);
  }

  /**
   * @param {number[]} universeIds
   */
  async function fetchGames(universeIds) {
    // Page-load cache: once we have an entry in memory, never refetch until reload.
    const missing = universeIds.filter((id) => !cache.has(id) && !inflight.has(id));
    if (!missing.length) return;

    for (const id of missing) inflight.add(id);

    try {
      for (let i = 0; i < missing.length; i += BATCH_SIZE) {
        await fetchGamesChunk(missing.slice(i, i + BATCH_SIZE));
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
      hydrateCacheFromStorage();
      console.info(
        "[robloxutil] home game stats active",
        location.pathname,
        `cached=${cache.size}`
      );
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

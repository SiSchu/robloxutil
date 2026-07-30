## Learned User Preferences
- Prefers one Tampermonkey loader that bundles related Roblox util scripts instead of installing each script separately.
- Often communicates in German for this project.
- Home game stats should persist across refreshes (~1 min cache) and only refetch on full page load; do not duplicate stats on hover tiles.
- Wants friend presence/status (Online, Offline, In Game, etc.) visible and clickable on the friends UI.

## Learned Workspace Facts
- This workspace is the SiSchu/robloxutil Tampermonkey project (GitHub: https://github.com/SiSchu/robloxutil).
- Entry point is `robloxutil.user.js`, which loads `modules/bulk-unfriend.js` and `modules/home-game-stats.js` via `@require` from GitHub raw.
- Tampermonkey `@require` should point at plain `.js` modules, not other `.user.js` files (those are often treated as separate scripts and fail to load).
- Modules use pathname guards so friends and home logic only run on their matching pages under the shared loader `@match` rules.
- On releases, bump `@version` in both `robloxutil.user.js` and `robloxutil.meta.js`, and bump the `?v=` cache-buster on `@require` URLs so modules reload.
- Install/update only the loader; keep legacy standalone `roblox-*.user.js` scripts disabled to avoid double-running.
- Prefer `\uXXXX` escapes for non-ASCII UI strings in modules to avoid encoding/mojibake issues from shell exports.

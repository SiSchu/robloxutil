// ==UserScript==
// @name         Roblox Util
// @namespace    https://github.com/SiSchu/robloxutil
// @version      1.0.1
// @description  Loader for Roblox Util scripts (friends bulk unfriend + home game stats)
// @author       SiSchu
// @homepageURL  https://github.com/SiSchu/robloxutil
// @supportURL   https://github.com/SiSchu/robloxutil/issues
// @match        https://www.roblox.com/users/friends*
// @match        https://www.roblox.com/*/users/friends*
// @match        https://www.roblox.com/home*
// @match        https://www.roblox.com/*/home*
// @run-at       document-idle
// @grant        none
// @require      https://raw.githubusercontent.com/SiSchu/robloxutil/main/modules/bulk-unfriend.js
// @require      https://raw.githubusercontent.com/SiSchu/robloxutil/main/modules/home-game-stats.js
// ==/UserScript==

// Code lives in modules/ via @require. Install only this script (or individual
// wrappers). Bump @version when modules change so Tampermonkey re-fetches them.
console.info("[robloxutil] loader ready");

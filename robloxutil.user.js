// ==UserScript==
// @name         Roblox Util
// @namespace    https://github.com/SiSchu/robloxutil
// @version      1.0.2
// @description  Loader for Roblox Util scripts (friends bulk unfriend + home game stats)
// @author       SiSchu
// @homepageURL  https://github.com/SiSchu/robloxutil
// @supportURL   https://github.com/SiSchu/robloxutil/issues
// @downloadURL  https://raw.githubusercontent.com/SiSchu/robloxutil/main/robloxutil.user.js
// @updateURL    https://raw.githubusercontent.com/SiSchu/robloxutil/main/robloxutil.user.js
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
// @require      https://raw.githubusercontent.com/SiSchu/robloxutil/main/modules/bulk-unfriend.js?v=1.0.2
// @require      https://raw.githubusercontent.com/SiSchu/robloxutil/main/modules/home-game-stats.js?v=1.0.2
// ==/UserScript==

// Code lives in modules/ via @require. Install only this script.
// Bump @version and ?v= on @require when modules change (cache bust).
console.info("[robloxutil] loader ready", location.pathname);

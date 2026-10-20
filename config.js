/* ============================================================
   THE ONLY FILE YOU NORMALLY EDIT
   ============================================================
   API_URL : your PUBLIC Apps Script web-app address (it ends with /exec).
             Apps Script -> Deploy -> New deployment -> Web app ->
             "Execute as: Me" and "Who has access: Anyone"   (NOT the Admin deployment!)
   LOGO_URL: optional https:// link to your logo (or set "logo_url" later in Admin -> Site settings).
   SW_URL  : keep 'sw.js' to enable the installable-app / offline support.
             Set it to '' to switch the service worker off.

   After editing on GitHub, wait ~1 minute for Pages to redeploy. If you still see the old
   address, hard-refresh (Ctrl+Shift+R) or bump CACHE_VERSION in sw.js.
*/
window.HUB_CONFIG = {
  API_URL: 'PASTE_YOUR_PUBLIC_WEB_APP_URL_HERE/exec',
  LOGO_URL: '',
  SW_URL: 'sw.js'
};

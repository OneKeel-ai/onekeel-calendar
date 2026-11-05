/*
 * Gmail content script. Adds "Meeting times" to compose/reply, opens the Calendar app's
 * /schedule?gmail=1 popup and inserts the HTML the app posts back. Never sends mail, never reads
 * the mailbox, loads no remote code, talks only to the popup it opened.
 */
(function () {
  "use strict";
  var B = globalThis.OneKeelBridge;
  var C = globalThis.OneKeelCompose;
  var STORAGE_KEY = "calendarAppUrl";
  var appUrl = B.DEFAULT_APP_URL;
  var session = null; // {nonce, popup, appOrigin, body, range}

  function loadSettings() {
    try {
      chrome.storage.sync.get(STORAGE_KEY, function (items) {
        if (items && typeof items[STORAGE_KEY] === "string") appUrl = items[STORAGE_KEY];
      });
      chrome.storage.onChanged.addListener(function (changes, area) {
        if (area === "sync" && changes[STORAGE_KEY]) appUrl = changes[STORAGE_KEY].newValue || B.DEFAULT_APP_URL;
      });
    } catch (e) {
      // Extension context gone (reloaded): keep default.
    }
  }

  function reply(message) {
    if (session && session.popup && !session.popup.closed) session.popup.postMessage(message, session.appOrigin);
  }

  function open(body) {
    var appOrigin = B.normalizeAppUrl(appUrl);
    if (!appOrigin) {
      C.toast(document, "Set a valid Calendar app URL in the OneKeel Meeting Times extension settings.");
      return;
    }
    if (session && session.popup && !session.popup.closed) session.popup.close();
    var nonce = B.createNonce();
    var range = C.captureSelection(window, body);
    var popup = window.open(B.scheduleUrl(appOrigin, nonce), "onekeel-meeting-" + nonce, "popup=yes,width=560,height=820");
    if (!popup) {
      C.toast(document, "The browser blocked the popup. Allow popups for Gmail and try again.");
      return;
    }
    session = { nonce: nonce, popup: popup, appOrigin: appOrigin, body: body, range: range };
  }

  window.addEventListener("message", function (event) {
    if (!session) return;
    var v = B.validateAppMessage(event, session);
    if (!v.ok) return; // anything else on the page is not ours: ignore silently
    if (v.message.type === "hello") {
      reply(B.buildReady(session.nonce));
      return;
    }
    var html = B.sanitizeHtml(v.message.html);
    if (!html) {
      reply(B.buildResult(session.nonce, v.message.requestId, false, "empty"));
      return;
    }
    var res = C.insertHtml(window, session.body, session.range, html);
    if (res.ok) {
      session.range = null; // later inserts go to the caret/end
      reply(B.buildResult(session.nonce, v.message.requestId, true));
    } else {
      reply(B.buildResult(session.nonce, v.message.requestId, false, "no-compose"));
    }
  });

  var scanTimer = null;
  function scan() {
    scanTimer = null;
    C.findBodies(document).forEach(function (body) {
      C.injectControl(body, open);
    });
  }
  function schedule() {
    if (!scanTimer) scanTimer = setTimeout(scan, 300);
  }

  loadSettings();
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  scan();
})();

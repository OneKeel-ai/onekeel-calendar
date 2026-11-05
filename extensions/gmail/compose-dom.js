/*
 * DOM helpers for Gmail compose/reply windows. Everything takes the document/window as an
 * argument so extensions/gmail/test/harness.html can drive it against a fake compose in any page.
 * Gmail's markup is not a public API: selectors are kept in one place and used defensively.
 * Publishes globalThis.OneKeelCompose.
 */
(function (root) {
  "use strict";

  var BODY_SELECTOR = [
    'div[role="textbox"][g_editable="true"]',
    'div[aria-label="Message Body"][contenteditable]',
    'div[aria-label="Message body"][contenteditable]',
    'div[contenteditable="true"][data-onekeel-test-body]',
  ].join(",");
  var SEND_SELECTOR = '[role="button"][data-tooltip^="Send"],[role="button"][aria-label^="Send"],[data-onekeel-test-send]';
  var MARK = "data-onekeel-meeting";

  function findBodies(scope) {
    return Array.prototype.slice.call(scope.querySelectorAll(BODY_SELECTOR));
  }

  /** Nearest ancestor of `body` that also holds a Send button: {root, send} or null. */
  function findCompose(body) {
    var node = body.parentElement;
    for (var depth = 0; node && depth < 14; depth++, node = node.parentElement) {
      var send = node.querySelector(SEND_SELECTOR);
      if (send) return { root: node, send: send };
    }
    return null;
  }

  /**
   * Adds a compact "Meeting times" button next to Send, once per compose. `onClick(body, button)`
   * runs on click. Returns the button, or null when already present or there is no toolbar.
   */
  function injectControl(body, onClick) {
    var found = findCompose(body);
    if (!found || found.root.getAttribute(MARK)) return null;
    var doc = body.ownerDocument;
    var button = doc.createElement("button");
    button.type = "button";
    button.textContent = "Meeting times";
    button.title = "Insert meeting times from OneKeel Calendar";
    button.setAttribute("data-onekeel-button", "1");
    button.style.cssText =
      "margin:0 8px;padding:6px 12px;border:1px solid #dadce0;border-radius:16px;background:#fff;color:#1f1f1f;" +
      "font:500 13px/16px 'Google Sans',Roboto,Arial,sans-serif;cursor:pointer;vertical-align:middle;";
    // Keep the caret/selection in the message body while the button is pressed.
    button.addEventListener("mousedown", function (e) {
      e.preventDefault();
    });
    button.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      onClick(body, button);
    });
    var anchor = found.send.closest("td") || found.send;
    anchor.parentNode.insertBefore(button, anchor.nextSibling);
    found.root.setAttribute(MARK, "1");
    return button;
  }

  /** Clone of the current selection range if it sits inside `body`, else null. */
  function captureSelection(win, body) {
    var sel = win.getSelection && win.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    var range = sel.getRangeAt(0);
    return body.contains(range.commonAncestorContainer) ? range.cloneRange() : null;
  }

  /**
   * Inserts sanitized HTML into `body` at the saved range (or the end when none), never sending.
   * Returns {ok, how} with how = "range" | "command"; ok false when body is gone.
   * `html` MUST already be sanitized by OneKeelBridge.sanitizeHtml.
   */
  function insertHtml(win, body, savedRange, html) {
    if (!body || !body.isConnected) return { ok: false, how: "gone" };
    var doc = body.ownerDocument;
    body.focus();
    var sel = win.getSelection();
    var range = savedRange && body.contains(savedRange.commonAncestorContainer) ? savedRange : null;
    if (!range) {
      range = doc.createRange();
      range.selectNodeContents(body);
      range.collapse(false);
    }
    sel.removeAllRanges();
    sel.addRange(range);
    // execCommand keeps Gmail's undo stack and input handlers in the loop; fall back to a Range insert.
    var done = false;
    try {
      done = doc.execCommand("insertHTML", false, html);
    } catch (e) {
      done = false;
    }
    if (done) return { ok: true, how: "command" };
    var tpl = doc.createElement("template");
    tpl.innerHTML = html;
    var frag = tpl.content;
    var last = frag.lastChild;
    range.deleteContents();
    range.insertNode(frag);
    if (last) {
      range.setStartAfter(last);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    }
    body.dispatchEvent(new win.Event("input", { bubbles: true }));
    return { ok: true, how: "range" };
  }

  /** Small self-removing notice in the page corner (no alert() blocking). */
  function toast(doc, message) {
    var el = doc.createElement("div");
    el.setAttribute("role", "status");
    el.textContent = message;
    el.style.cssText =
      "position:fixed;right:16px;bottom:16px;z-index:2147483647;max-width:320px;padding:10px 14px;border-radius:8px;" +
      "background:#202124;color:#fff;font:13px/18px Roboto,Arial,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.3);";
    doc.body.appendChild(el);
    setTimeout(function () {
      el.remove();
    }, 5000);
    return el;
  }

  root.OneKeelCompose = {
    BODY_SELECTOR: BODY_SELECTOR, SEND_SELECTOR: SEND_SELECTOR,
    findBodies: findBodies, findCompose: findCompose, injectControl: injectControl,
    captureSelection: captureSelection, insertHtml: insertHtml, toast: toast,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);

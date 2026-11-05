(function () {
  "use strict";
  var B = globalThis.OneKeelBridge;
  var KEY = "calendarAppUrl";
  var input = document.getElementById("url");
  var status = document.getElementById("status");

  function say(text, isError) {
    status.textContent = text;
    status.className = isError ? "error" : "";
  }

  chrome.storage.sync.get(KEY, function (items) {
    input.value = (items && items[KEY]) || B.DEFAULT_APP_URL;
  });

  document.getElementById("save").addEventListener("click", function () {
    var origin = B.normalizeAppUrl(input.value);
    if (!origin) {
      say("Enter an https:// address (http://localhost is allowed for development).", true);
      return;
    }
    chrome.storage.sync.set({ [KEY]: origin }, function () {
      input.value = origin;
      say("Saved. Reload open Gmail tabs only if the button does not pick it up.");
    });
  });

  document.getElementById("reset").addEventListener("click", function () {
    chrome.storage.sync.remove(KEY, function () {
      input.value = B.DEFAULT_APP_URL;
      say("Reset to default.");
    });
  });
})();

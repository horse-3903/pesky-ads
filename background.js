// Shows a per-tab badge count of overlays neutralized by content.js.

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type !== "pesky-ads:blocked" || !sender.tab?.id) return;
  chrome.action.setBadgeText({ tabId: sender.tab.id, text: String(message.count) });
  chrome.action.setBadgeBackgroundColor({ tabId: sender.tab.id, color: "#c0392b" });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") {
    chrome.action.setBadgeText({ tabId, text: "" });
  }
});

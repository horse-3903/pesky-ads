// Shows a per-tab badge count of overlays/redirects neutralized.
//
// location.href/.assign()/.replace() can't be blocked by overriding JS
// properties (they're spec "unforgeable"), so ad scripts that redirect
// this way have to be caught after the fact: Chrome tags any
// script/meta-refresh-driven navigation with the "client_redirect"
// transition qualifier. If one of those fires shortly after a real
// click and lands on a different domain, treat it as a hijack and bounce
// the tab/frame back to where it was.

const ARM_WINDOW_MS = 2500;
const armedByTab = new Map(); // tabId -> timestamp of last real click
const lastGoodUrlByFrame = new Map(); // "tabId:frameId" -> last non-redirect URL

function hostnameOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function bumpBadge(tabId) {
  chrome.action.getBadgeText({ tabId }, (text) => {
    const count = (parseInt(text, 10) || 0) + 1;
    chrome.action.setBadgeText({ tabId, text: String(count) });
    chrome.action.setBadgeBackgroundColor({ tabId, color: "#c0392b" });
  });
}

chrome.runtime.onMessage.addListener((message, sender) => {
  const tabId = sender.tab?.id;
  if (tabId == null) return;

  if (message?.type === "pesky-ads:blocked") {
    bumpBadge(tabId);
  } else if (message?.type === "pesky-ads:arm") {
    armedByTab.set(tabId, Date.now());
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") {
    chrome.action.setBadgeText({ tabId, text: "" });
  }
});

chrome.webNavigation.onCommitted.addListener((details) => {
  const { tabId, frameId, url, transitionQualifiers } = details;
  const key = `${tabId}:${frameId}`;
  const isClientRedirect = transitionQualifiers?.includes("client_redirect");
  const prevUrl = lastGoodUrlByFrame.get(key);

  if (!isClientRedirect) {
    lastGoodUrlByFrame.set(key, url);
    return;
  }

  const armedAt = armedByTab.get(tabId);
  const withinArmWindow = armedAt && Date.now() - armedAt < ARM_WINDOW_MS;
  const prevHost = prevUrl && hostnameOf(prevUrl);
  const newHost = hostnameOf(url);

  if (!withinArmWindow || !prevUrl || !prevHost || prevHost === newHost) return;

  bumpBadge(tabId);

  if (frameId === 0) {
    chrome.tabs.update(tabId, { url: prevUrl });
    return;
  }

  // Sub-frame hijack (e.g. a video embed redirecting itself to an ad
  // landing page): reset just that iframe from the top frame, which is
  // allowed to rewrite a cross-origin child's location even though it
  // can't read it.
  chrome.scripting.executeScript({
    target: { tabId, frameIds: [0] },
    func: (targetUrl) => {
      for (const frame of document.querySelectorAll("iframe")) {
        if (frame.dataset.peskyOriginalSrc === targetUrl) {
          try {
            frame.contentWindow.location = targetUrl;
          } catch {
            frame.src = targetUrl;
          }
        }
      }
    },
    args: [prevUrl],
  });
});

// Handles the "a new tab/window opens" case: a real <a target="_blank">
// click never calls the JS window.open() function at all, so it can't be
// caught by overriding it in main-world.js. Chrome still reports the new
// tab's creation here regardless of mechanism, so close it immediately
// if it appeared right after a click and points off-site.
chrome.webNavigation.onCreatedNavigationTarget.addListener((details) => {
  const { sourceTabId, tabId, url } = details;
  const armedAt = armedByTab.get(sourceTabId);
  if (!armedAt || Date.now() - armedAt > ARM_WINDOW_MS) return;

  chrome.tabs.get(sourceTabId, (sourceTab) => {
    if (chrome.runtime.lastError || !sourceTab?.url) return;
    const sourceHost = hostnameOf(sourceTab.url);
    const newHost = hostnameOf(url);
    // A blank/empty destination (about:blank, "") is the classic
    // popunder trick: open an empty window first, then navigate it from
    // script a moment later, which dodges blockers that only check the
    // URL at creation time. Treat "not clearly same-site" as suspicious.
    if (sourceHost && newHost && sourceHost === newHost) return;

    chrome.tabs.remove(tabId);
    bumpBadge(sourceTabId);
  });
});

// Runs in the page's own JS context (not the isolated content-script world)
// so it can intercept redirect calls ad scripts make directly.
//
// Note: location.href / .assign() / .replace() are spec-mandated
// "unforgeable" - they live as non-configurable properties on the
// location instance itself, so they cannot be overridden here. Those
// redirects are instead caught at the navigation level in background.js.

(() => {
  const sameOrigin = (url) => {
    try {
      return new URL(url, location.href).hostname === location.hostname;
    } catch {
      return true; // can't parse it, don't block
    }
  };

  const report = (url) => {
    window.postMessage({ source: "pesky-ads", type: "blocked", url }, "*");
  };

  const nativeOpen = window.open;
  window.open = function (url, target, features) {
    if (url && !sameOrigin(url)) {
      report(String(url));
      return null;
    }
    return nativeOpen.call(window, url, target, features);
  };

  // Best-effort extra layer: the Navigation API can cancel some
  // script-initiated navigations (including cross-origin ones) that
  // property overrides can't reach.
  if (window.navigation) {
    window.navigation.addEventListener("navigate", (e) => {
      if (!e.userInitiated && !sameOrigin(e.destination.url)) {
        report(e.destination.url);
        e.preventDefault();
      }
    });
  }
})();

// Runs in the page's own JS context (not the isolated content-script world)
// so it can intercept the redirect calls ad scripts make directly:
// window.open(adUrl, "_self") and location.href/assign/replace to a
// different domain. Same-origin navigation is left untouched.

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

  for (const method of ["assign", "replace"]) {
    const native = Location.prototype[method];
    Location.prototype[method] = function (url) {
      if (url && !sameOrigin(url)) {
        report(String(url));
        return;
      }
      return native.call(this, url);
    };
  }

  try {
    const hrefDescriptor = Object.getOwnPropertyDescriptor(Location.prototype, "href");
    Object.defineProperty(Location.prototype, "href", {
      configurable: true,
      get: hrefDescriptor.get,
      set(url) {
        if (url && !sameOrigin(url)) {
          report(String(url));
          return;
        }
        hrefDescriptor.set.call(this, url);
      },
    });
  } catch {
    // Some browsers don't allow redefining location.href - window.open
    // and assign/replace overrides above still cover most redirect ads.
  }
})();

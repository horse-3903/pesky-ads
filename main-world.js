// Runs in the page's own JS context (not the isolated content-script world),
// which is needed to reach the Navigation API's "navigate" event.
//
// This deliberately does NOT override window.open: doing so unconditionally
// would block every cross-origin popup on every site (OAuth logins, share
// dialogs, payment flows, "open in new tab" links), not just ad hijacks.
// window.open() has no reliable way to tell a wanted popup from an ad one
// from inside this override alone. That distinction - was this popup or
// redirect tied to a real click, and does it go somewhere the user didn't
// ask for - is instead made in background.js, which has ARM_WINDOW_MS of
// context to work with and only acts on tabs/navigations that actually
// appear right after a click.
//
// Note: location.href / .assign() / .replace() are spec-mandated
// "unforgeable" - they live as non-configurable properties on the
// location instance itself, so they cannot be overridden here either.
// Same-tab redirects are also handled in background.js.

(() => {
  const sameOrigin = (url) => {
    try {
      return new URL(url, location.href).hostname === location.hostname;
    } catch {
      return true; // can't parse it, don't block
    }
  };

  // The Navigation API explicitly flags whether a navigation had real user
  // activation behind it (e.userInitiated). This only cancels the ones that
  // didn't - a script redirecting the page cross-origin with no click at
  // all - which a real user action would never trigger, so this carries no
  // risk of blocking anything intentional.
  if (window.navigation) {
    window.navigation.addEventListener("navigate", (e) => {
      if (!e.userInitiated && !sameOrigin(e.destination.url)) {
        window.postMessage({ source: "pesky-ads", type: "blocked", url: e.destination.url }, "*");
        e.preventDefault();
      }
    });
  }
})();

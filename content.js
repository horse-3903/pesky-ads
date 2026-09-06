// Neutralizes invisible click-hijacking overlays: transparent/hidden
// <div>/<a> elements stacked on top of real page content that swallow
// clicks and redirect to ad sites instead of letting the real element
// underneath receive the interaction.

(() => {
  const MIN_SIZE = 24; // px, ignore tiny elements (icons, checkboxes, etc.)
  // Ad-injected hijack layers max this out (often literally 2147483647,
  // INT32_MAX) to guarantee they sit above the host page's own stacking
  // context. No legitimate site CSS uses values in this range - a normal
  // player's own "click anywhere on the video" catcher tops out in the
  // tens/hundreds at most. Keeping this very high is what avoids matching
  // that legitimate pattern.
  const HIGH_ZINDEX = 999999;
  const neutralized = new WeakSet();
  let blockedCount = 0;

  function isTransparentLooking(style) {
    const opacity = parseFloat(style.opacity);
    if (!Number.isNaN(opacity) && opacity <= 0.05) return true;

    const bg = style.backgroundColor;
    const alphaMatch = bg.match(/rgba?\([^)]*?,\s*([\d.]+)\s*\)$/);
    const bgAlpha = alphaMatch ? parseFloat(alphaMatch[1]) : bg === "transparent" ? 0 : 1;
    const bgIsTransparent = bg === "transparent" || bgAlpha <= 0.05;
    const hasBgImage = style.backgroundImage && style.backgroundImage !== "none";
    const hasBorder = style.borderStyle !== "none" && parseFloat(style.borderWidth) > 0;
    const hasShadow = style.boxShadow && style.boxShadow !== "none";

    return bgIsTransparent && !hasBgImage && !hasBorder && !hasShadow;
  }

  function isSuspiciousOverlay(el) {
    if (!el || el === document.documentElement || el === document.body) return false;
    if (neutralized.has(el)) return true;

    // Real UI (video player controls, layout wrappers, etc.) is almost
    // always a container with children rendered on top of it - a
    // hijacking layer is just an empty pane injected to sit in front of
    // everything. This single check is what keeps this from matching
    // legitimate large/transparent/absolutely-positioned wrapper divs,
    // which are extremely common in normal page layouts.
    if (el.children.length > 0) return false;

    // A legitimate player's click-catcher lives deep inside that
    // player's own container structure. Ad scripts inject their
    // hijacking layer standalone, straight onto <body>.
    if (el.parentElement !== document.body) return false;

    const style = getComputedStyle(el);
    if (!["fixed", "absolute", "sticky"].includes(style.position)) return false;
    if (style.pointerEvents === "none") return false;

    const rect = el.getBoundingClientRect();
    if (rect.width < MIN_SIZE || rect.height < MIN_SIZE) return false;
    if (rect.bottom < 0 || rect.top > innerHeight || rect.right < 0 || rect.left > innerWidth) {
      return false;
    }

    const zIndex = parseInt(style.zIndex, 10) || 0;
    const coversBigArea =
      rect.width * rect.height >= innerWidth * innerHeight * 0.25;
    const looksInvisible = isTransparentLooking(style);
    const hasVisibleText = el.innerText && el.innerText.trim().length > 0;

    if (!looksInvisible || hasVisibleText) return false;
    if (zIndex < HIGH_ZINDEX && !coversBigArea) return false;

    // Final check: is it actually sitting in front of real content
    // (genuinely intercepting clicks at its own center), rather than
    // tucked behind something visible?
    const cx = Math.min(Math.max((rect.left + rect.right) / 2, 0), innerWidth - 1);
    const cy = Math.min(Math.max((rect.top + rect.bottom) / 2, 0), innerHeight - 1);
    return document.elementFromPoint(cx, cy) === el;
  }

  function neutralize(el) {
    if (neutralized.has(el)) return;
    neutralized.add(el);
    el.remove();
    blockedCount++;
    chrome.runtime?.sendMessage?.({ type: "pesky-ads:blocked", count: blockedCount });
  }

  function scan(root = document) {
    const candidates = root.querySelectorAll("div, a, span");
    for (const el of candidates) {
      if (isSuspiciousOverlay(el)) neutralize(el);
    }
  }

  // Proactive sweep: catches overlays that block the page (scrolling,
  // hovering) even without ever being clicked.
  function scheduleScan() {
    if (document.body) scan();
  }
  const observer = new MutationObserver(() => scheduleScan());
  function startObserving() {
    scheduleScan();
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }
  if (document.body) startObserving();
  else document.addEventListener("DOMContentLoaded", startObserving, { once: true });

  // Reactive defense: at the moment of a click, find what's actually on
  // top at that point. If it's a hijacking layer, cancel the event, hide
  // the layer, and replay the interaction against the real element below.
  function handlePointerEvent(e) {
    const stack = document.elementsFromPoint(e.clientX, e.clientY);
    if (!stack.length) return;

    const topmost = stack[0];
    if (!isSuspiciousOverlay(topmost)) return;

    e.preventDefault();
    e.stopImmediatePropagation();
    neutralize(topmost);

    const realTarget = document.elementFromPoint(e.clientX, e.clientY);
    if (realTarget && realTarget !== topmost) {
      if (e.type === "click") {
        realTarget.dispatchEvent(
          new MouseEvent("click", {
            bubbles: true,
            cancelable: true,
            clientX: e.clientX,
            clientY: e.clientY,
          })
        );
      }
    }
  }

  for (const type of ["pointerdown", "mousedown", "click"]) {
    document.addEventListener(type, handlePointerEvent, { capture: true });
  }

  // Relay redirects blocked by main-world.js (window.open / location
  // hijacks) into the same badge counter.
  window.addEventListener("message", (e) => {
    if (e.source !== window || e.data?.source !== "pesky-ads" || e.data.type !== "blocked") {
      return;
    }
    blockedCount++;
    chrome.runtime?.sendMessage?.({ type: "pesky-ads:blocked", count: blockedCount });
  });

  // Arm background.js's navigation watchdog on every real click, so a
  // location.href-style redirect that follows shortly after (which can't
  // be blocked by overriding JS properties - see main-world.js) gets
  // bounced back.
  document.addEventListener(
    "click",
    (e) => {
      if (e.isTrusted) chrome.runtime?.sendMessage?.({ type: "pesky-ads:arm" });
    },
    { capture: true }
  );

  // Tag iframes with their original src so background.js can find and
  // reset the right one if it gets hijacked into an ad landing page.
  if (window === window.top) {
    function tagIframes() {
      for (const frame of document.querySelectorAll("iframe[src]:not([data-pesky-original-src])")) {
        frame.dataset.peskyOriginalSrc = frame.src;
      }
    }
    tagIframes();
    new MutationObserver(tagIframes).observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributeFilter: ["src"],
    });
  }
})();

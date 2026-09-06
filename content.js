// Neutralizes invisible click-hijacking overlays: transparent/hidden
// <div>/<a> elements stacked on top of real page content that swallow
// clicks and redirect to ad sites instead of letting the real element
// underneath receive the interaction.

(() => {
  const MIN_SIZE = 24; // px, ignore tiny elements (icons, checkboxes, etc.)
  const HIGH_ZINDEX = 100;
  const neutralized = new WeakSet();
  let blockedCount = 0;

  function isTransparentLooking(style) {
    const opacity = parseFloat(style.opacity);
    if (!Number.isNaN(opacity) && opacity <= 0.05) return true;

    const bg = style.backgroundColor;
    const bgIsTransparent =
      bg === "transparent" || bg === "rgba(0, 0, 0, 0)" || /rgba\([^)]*,\s*0\)$/.test(bg);
    const hasBgImage = style.backgroundImage && style.backgroundImage !== "none";
    const hasBorder = style.borderStyle !== "none" && parseFloat(style.borderWidth) > 0;
    const hasShadow = style.boxShadow && style.boxShadow !== "none";

    return bgIsTransparent && !hasBgImage && !hasBorder && !hasShadow;
  }

  function isSuspiciousOverlay(el) {
    if (!el || el === document.documentElement || el === document.body) return false;
    if (neutralized.has(el)) return true;

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

    // Either it's suspiciously stacked high, or it blankets a large chunk
    // of the viewport while being invisible - both are hallmarks of a
    // click-hijacking layer rather than a legitimate hidden helper element.
    return zIndex >= HIGH_ZINDEX || coversBigArea;
  }

  function neutralize(el) {
    if (neutralized.has(el)) return;
    neutralized.add(el);
    el.style.setProperty("pointer-events", "none", "important");
    el.style.setProperty("display", "none", "important");
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
})();

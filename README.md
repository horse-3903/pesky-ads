<div align="center">

# pesky-ads

A Chrome extension that removes hidden click-hijacking overlays before they can redirect you to an ad site.

![Manifest](https://img.shields.io/badge/Manifest-V3-blue?style=flat-square)
![JavaScript](https://img.shields.io/badge/JavaScript-ES2022-yellow?style=flat-square&logo=javascript)
![Chrome](https://img.shields.io/badge/Chrome-Extension-4285F4?style=flat-square&logo=googlechrome&logoColor=white)
![License](https://img.shields.io/github/license/horse-3903/pesky-ads?style=flat-square)
![Last Commit](https://img.shields.io/github/last-commit/horse-3903/pesky-ads?style=flat-square)

</div>

---

## Overview

**pesky-ads** targets a specific, common pattern on ad-heavy sites: a button that looks clickable but sits behind (or is wrapped by) an invisible element whose only job is to hijack the click and send you to an ad page instead. This shows up most often on free streaming and download sites, where a "Play" or "Download" button is layered under a transparent div, a hidden anchor tag, or a JS-driven popup, so that clicking the visible button also fires an ad redirect. The extension watches the page for these patterns and neutralizes them automatically, without needing a list of known ad domains.

## Features

- **Invisible overlay removal** - detects transparent, high-z-index divs injected directly onto the page that sit on top of real buttons and intercept clicks meant for them.
- **Hidden redirect proxy detection** - finds off-screen or `display: none` anchor tags and iframes that ad scripts trigger programmatically instead of relying on a visible overlay.
- **Click replay** - when an overlay is removed mid-click, the click is replayed against the real element underneath, so the button's actual function (playing a video, submitting a form) still happens.
- **Popup and redirect blocking** - closes ad tabs opened via `window.open` or `target="_blank"`, and reverts script-driven redirects (`location.href`, `location.assign`, `location.replace`) that fire right after a click.
- **False-positive guards** - every check requires the element to be a childless node injected directly onto `<body>`, so legitimate page layouts and video player controls are left alone.

## Tech Stack

![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black)
![Chrome Extension](https://img.shields.io/badge/Chrome_Extension-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white)
![Manifest V3](https://img.shields.io/badge/Manifest_V3-34A853?style=for-the-badge)

---

## Getting Started

### Prerequisites

- Google Chrome or another Chromium-based browser (Edge, Brave) with support for Manifest V3 and `world: "MAIN"` content scripts (Chrome 111+).

### Installation

```bash
git clone https://github.com/horse-3903/pesky-ads.git
```

### Run locally

```bash
# In Chrome, go to:
#   chrome://extensions
# Enable "Developer mode" (top right), then:
#   Load unpacked -> select the pesky-ads folder
```

No build step is required. The extension loads directly from source.

---

## How it works

Ad-hijacking scripts use a few different mechanisms, so the extension layers a few independent checks rather than relying on one:

1. **Overlay divs** - an empty, transparent, absolutely-positioned element with an extreme z-index (often `2147483647`, the maximum 32-bit integer) is injected as a direct child of `<body>` and sits on top of a real button. The extension checks, at both a proactive scan and the moment of a click, whether an element is genuinely on top of the page at that point, invisible, childless, and body-level - and removes it if so.
2. **Hidden redirect proxies** - some ad scripts skip the visible overlay entirely and instead keep a direct reference to a hidden, off-screen `<a>` or `<iframe>`, firing it programmatically on click. The extension scans for these by hidden-ness and an off-site destination, and strips their `href`/`src` so they can't fire even if a script still holds a reference to them.
3. **Popup and navigation hijacks** - `window.open` calls to a different origin are blocked directly. Since `location.href`, `.assign()`, and `.replace()` cannot be overridden (they are unforgeable properties per the HTML spec), the extension instead watches for a script-driven navigation (`client_redirect`) or a new tab opening shortly after a real click, and reverts it.

## Project Structure

```
pesky-ads/
├── manifest.json    # extension manifest: permissions, content script registration
├── content.js       # isolated-world script: overlay/proxy detection and removal
├── main-world.js    # main-world script: window.open override, Navigation API guard
├── background.js    # service worker: popup/redirect watchdog, badge counter
└── LICENSE
```

---

## Limitations

This extension makes reasonable, testable judgment calls about what looks like a hijack versus real page content. It has been tested against Wikipedia, GitHub, CNN, and Amazon with no false positives, and against a live streaming site exhibiting all three hijack patterns described above. It is not a substitute for a full ad-blocking list and will not catch every possible technique, particularly ones that don't match the "invisible element injected onto body" shape described here.

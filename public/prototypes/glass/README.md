# Independent glass study

Open `/prototypes/glass/index.html` on the existing Pi Web server.

This is a throwaway visual prototype, not a replacement theme or a real dashboard.
It imports none of the application's CSS, React components or Liquid Glass engine.
No account data is read, no API is called, and search/bookmark controls only show
local demonstration states. View choices live in this page's URL; typed text does not.

## What is different

- One glass surface, a thin directional edge, no thick white rim or nested panels.
- Search capsule, toolbar and sheet variants; clear, frosted and opaque materials.
- Photo, pale and grid backgrounds; move the surface and disable displacement to compare.
- The background has a known source. A matching **lens-sized crop** is rendered
  behind the foreground controls and refracted with an ordinary SVG `filter`.
  This does not require Chromium-only SVG `backdrop-filter` and does not capture
  or clone the application DOM. It is NOT a general solution for arbitrary
  overlapping content, nested scrolling, video, or an entire app theme.
- The rounded lens uses a smooth inward displacement field and small RGB channel
  offsets. It is an optical approximation, not a physically exact Apple renderer.
- System transparency/contrast preferences remove the effect. Without JavaScript,
  the page still shows a static frosted sample.

## Photo

`lake.jpg` is a locally bundled 1600×1067 image from Unsplash, used as a **demo
backdrop**, not the user's photograph or product content. Original image:

https://images.unsplash.com/photo-1501785888041-af3ef285b470

Download used `w=1600&q=85&fit=crop&fm=jpg`. The crop alignment in `study.js`
uses these dimensions; update them if the image is replaced. The page makes no
requests to the image host at runtime.

Technical references: https://kube.io/blog/liquid-glass-css-svg and
https://aave.com/design/building-glass-for-the-web . This prototype is an
independent implementation of the known-background/SVG-displacement approach.

## Checks

```sh
PLAYWRIGHT_CHANNEL=chrome node --env-file-if-exists=.env.local e2e/glass-prototype.mjs
```

Checks 320, 390, 1440 and 1920px layouts, all component variants, URL state,
keyboard controls, draft preservation, accessibility preferences, no application
API requests, and a pixel comparison with displacement disabled. Screenshots go
to `outputs/glass-from-scratch/` by default.

Actual Safari/iOS rendering and real-device GPU performance still need device
verification. A portable technique is not a claim that every browser was tested.

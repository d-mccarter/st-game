# st-game

Static web app hosted on **GitHub Pages** — same pattern as [Guitar Practice App](https://github.com/d-mccarter/Guitar-Practice-App).

**Live site (after you enable Pages once):** https://d-mccarter.github.io/st-game/

Open that URL on desktop, or on iPhone Safari tap **Share → Add to Home Screen**.

## Enable Pages (one-time — you must click this)

I pushed the site but GitHub blocks the API from turning Pages on. Do this once:

1. Open **https://github.com/d-mccarter/st-game/settings/pages**
2. Under **Build and deployment → Source**, choose **Deploy from a branch**
3. Branch: **`main`** · Folder: **`/` (root)** · **Save**

Wait ~1 minute, then open https://d-mccarter.github.io/st-game/

## What’s in the repo

| File | Role |
| --- | --- |
| `index.html` | Page shell + Apple / PWA meta tags |
| `css/`, `js/` | Styles and app logic |
| `manifest.json` + `icons/` | Install name, icons, standalone display |
| `sw.js` | Service worker cache |
| `.nojekyll` | Tells Pages not to run Jekyll |

No build step. Data stays in the browser via `localStorage`.

## Local development

```bash
npx --yes serve .
```

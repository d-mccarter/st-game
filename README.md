# st-game

Static web app hosted on **GitHub Pages** — same pattern as [Guitar Practice App](https://github.com/d-mccarter/Guitar-Practice-App).

**Live site:** https://d-mccarter.github.io/st-game/

Open that URL on desktop, or on iPhone Safari tap **Share → Add to Home Screen** for a full-screen app icon.

## What’s in the repo

| File | Role |
| --- | --- |
| `index.html` | Page shell + Apple / PWA meta tags |
| `css/`, `js/` | Styles and app logic |
| `manifest.json` + `icons/` | Install name, icons, standalone display |
| `sw.js` | Service worker cache |

No build step. Data stays in the browser via `localStorage`.

## Local development

```bash
npx --yes serve .
```

Then open the printed local URL.

## GitHub Pages

Pages is configured to deploy from branch **`main`**, folder **`/` (root)** — same as the guitar app.

# Repository Guidelines

## Project Structure & Module Organization
- `index.html`: App shell (toolbar, modals, includes).
- `style.css`: Theme variables, layout, components (kebab-case classes).
- `app.js`: Core logic in an IIFE (state, history, quick actions, charts, UI wiring).
- `sw.js`: Service worker (offline cache/versioning). Bump `CACHE_NAME` and keep `ASSETS` accurate after cacheable changes.
- `manifest.json`: PWA metadata (icons, scope, start URL). Static assets are local/inline; no build step.

## Build, Test, and Development Commands
- Serve locally (enables SW/PWA): `python3 -m http.server 5173` then open `http://localhost:5173/`, or `npx http-server -p 5173 .`.
- After changing cacheable assets: update `sw.js` `CACHE_NAME`, verify `ASSETS`, hard‑reload.

## Coding Style & Naming Conventions
- JavaScript: vanilla ES in an IIFE, 2‑space indent, semicolons, camelCase for vars/functions. Keep patches minimal and focused.
- CSS: use provided CSS variables; class names in kebab-case.
- HTML: ids use camelCase; keep markup accessible (`aria-*`, `hidden`).
- Invariants: call `applyDailyRollover()` before mutations; clamp `remaining ≥ 0`; persist, then re-render.

## Testing Guidelines
Manual checks (no framework):
- URL quick actions: `?dec=10`, `?add=2&exercise=Pushups` show toast, clamp ≥ 0, strip query; auto‑close in standalone.
- Daily rollover applies for missed days; decrement/add target updates history correctly.
- History modal: 7/30‑day stats; chart renders with correct theme colors.
- Quick steps: preset buttons apply correct amounts; Custom accepts positive integers only.
- Export/Import: JSON round‑trips; invalid input handled.
- PWA: works offline after first load; after asset changes, bump `CACHE_NAME` and verify cache refresh.

## Commit & Pull Request Guidelines
- Commits: clear, imperative (e.g., "Add history modal chart"); avoid unrelated refactors; reference issues.
- PRs: include description, testing steps, edge cases, and UI screenshots/clips when relevant.
- Offline caching: when adding assets required offline, update `ASSETS` in `sw.js` and bump `CACHE_NAME`.

## Security & Configuration Tips
- State persists in `localStorage` under key `exerciseList`; never store secrets.
- For subpath deploys (e.g., `/pushup/`), set `start_url` and `scope` in `manifest.json`.


# Repository Guidelines

## Project Structure & Module Organization
- `index.html`: App shell (toolbar, modals, includes).
- `style.css`: Theme variables (light/dark), layout, components.
- `app.js`: Core logic (state, history, quick actions, charts, UI wiring).
- `sw.js`: Service worker (offline cache, versioning).
- `manifest.json`: PWA metadata (icons, scope, start URL).
- Static assets are local/inline; no build step.

## Build, Test, and Development Commands
- Serve locally (enables SW/PWA):
  - `python3 -m http.server 5173` → open `http://localhost:5173/`
  - or `npx http-server -p 5173 .`
- No bundler or build pipeline; edit files directly. After changing cacheable assets, bump `CACHE_NAME` in `sw.js` and ensure ASSETS list is accurate.

## Coding Style & Naming Conventions
- JavaScript: vanilla ES in an IIFE, 2-space indent, semicolons, camelCase for vars/functions. Keep patches minimal and focused.
- CSS: rely on provided CSS variables; class names use kebab-case.
- HTML: ids use camelCase; keep markup accessible (aria labels, `hidden`).

## Testing Guidelines
- Manual checks (no test framework yet):
  - URL quick actions: `?dec=10`, `?add=2&exercise=Pushups` show toast, clamp ≥ 0, strip query; auto-close in standalone.
  - Daily rollover applies for missed days; decrement/add target update history correctly.
  - History modal: 7/30 day stats, chart renders, theme colors correct.
  - Quick steps: buttons apply correct amounts; Custom accepts positive integers.
  - Export/Import: JSON round-trips; invalid input handled.
  - PWA: works offline after first load; after asset changes, bump `CACHE_NAME` and reload.

## Commit & Pull Request Guidelines
- Commits: clear, imperative (e.g., "Add history modal chart"). Avoid unrelated refactors. Reference issues.
- PRs: include description, testing steps, edge cases, and UI screenshots/clips when relevant.
- Offline caching: when adding assets required offline, update `sw.js` ASSETS and bump `CACHE_NAME`.

## Security & Configuration Tips
- State persists in `localStorage` under key `exerciseList`; never store secrets.
- For subpath deploys (e.g., `/pushup/`), set `start_url` and `scope` in `manifest.json`.
- Maintain invariants: call `applyDailyRollover()` before mutations; clamp `remaining ≥ 0`; persist, then re-render.

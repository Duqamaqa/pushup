# Repository Guidelines

## Project Structure & Module Organization
- `index.html` hosts the application shell (toolbar, modals, includes).
- `style.css` centralizes theme variables, layout rules, and component classes (kebab-case naming).
- `app.js` runs core logic inside an IIFE: state management, history, quick actions, charts, and UI wiring. Call `applyDailyRollover()` before any state mutation.
- `sw.js` caches offline assets. Bump `CACHE_NAME` and keep `ASSETS` synchronized whenever cacheable files change.
- `manifest.json` defines PWA metadata; adjust `start_url` and `scope` for subpath deployments.

## Build, Test, and Development Commands
- `python3 -m http.server 5173` (or `npx http-server -p 5173 .`) serves the app locally with service worker support. Open `http://localhost:5173/` after starting.
- Hard-reload the browser after asset changes to confirm cache updates.

## Coding Style & Naming Conventions
- JavaScript: vanilla ES, 2-space indent, semicolons, camelCase identifiers. Keep patches focused and minimal.
- CSS: leverage existing CSS variables; class names stay kebab-case.
- HTML: ids in camelCase, ensure accessibility via `aria-*` attributes and proper `hidden` usage.

## Testing Guidelines
- Exercise manual checks: URL quick actions (`?dec=10`, `?add=2&exercise=Pushups`), quick-step presets, custom inputs (positive integers only), and daily rollover correctness.
- Verify history modal stats (7/30-day), chart theme colors, and JSON export/import round-trips with invalid input handling.
- Confirm PWA offline behavior after first load and after updating cached assets.

## Commit & Pull Request Guidelines
- Write imperative commit messages (e.g., "Add history modal chart") and avoid bundling unrelated changes.
- PRs should describe the change, list manual tests, mention edge cases, and include relevant screenshots or clips.

## Security & Configuration Tips
- Persisted state lives in `localStorage` under `exerciseList`; never store secrets.
- Ensure offline-critical assets are listed in `sw.js` `ASSETS` array before release.

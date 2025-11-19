# Repository Guidelines

## Project Structure & Module Organization
The single-page client lives in `index.html`, which wires toolbar controls, modals, and includes. Core logic sits in `app.js` within an IIFE; always call `applyDailyRollover()` before mutating state or history arrays. Styling, layout primitives, and shared variables belong in `style.css`, keeping classes in kebab-case. `sw.js` caches offline assets—bump `CACHE_NAME` and update `ASSETS` whenever HTML, CSS, JS, or icons change. Progressive Web App metadata is defined in `manifest.json`, while `version.json` and `commit.js` provide lightweight release metadata.

## Build, Test, and Development Commands
Run `python3 -m http.server 5173` (or `npx http-server -p 5173 .`) from the repo root for a local preview with service worker support, then open `http://localhost:5173/`. After editing cached files, perform a hard reload (Shift+Reload) to verify the new cache. There is no automated build step; keep patches minimal and browser-ready.

## Coding Style & Naming Conventions
Use vanilla ES with 2-space indentation, semicolons, and camelCase identifiers (`dailyTotals`, `openHistoryModal`). Guard shared mutations with concise helper functions and inline comments only when logic is non-obvious. CSS sticks to existing custom properties and kebab-case class selectors (`history-modal`, `quick-step`). HTML ids stay camelCase and must include `aria-*` attributes or `hidden` flags when toggling visibility.

## Testing Guidelines
Manual verification is required: check URL quick actions such as `?dec=10` or `?add=2&exercise=Pushups`, confirm quick-step presets, and reject non-positive integers in custom inputs. Validate daily rollovers, 7/30-day history stats, chart colors, and JSON export/import flows (including malformed JSON). After any cache-affecting change, confirm offline behavior by revisiting the app in airplane mode.

## Commit & Pull Request Guidelines
Write imperative, single-purpose commit messages (e.g., "Add history modal chart") and avoid bundling unrelated fixes. Pull requests should describe the change, outline manual test steps, call out edge cases, and include screenshots or clips for UI adjustments. Reference related issues when available and ensure `sw.js` updates accompany asset changes.

## Security & Configuration Tips
Persisted data is limited to `localStorage` under the `exerciseList` key—store no credentials or secrets. Keep the offline experience reliable by ensuring every critical asset is listed in `sw.js` and that `manifest.json` `start_url`/`scope` reflect the correct deployment subpath.

## Friends & Leaderboard Notes
- Friend entries are keyed by email (normalized, lowercase) and stored via `getFriendEntries()`/`writeFriendEntries()`. Use `normalizeEmail()`/`isValidEmail()` before persisting or comparing.
- Supabase leaderboard rows now use email identifiers. Always ensure `getSelfEmail()` has a value before calling `upsertScore()`; both parties must add each other’s email for `loadLeaderboard()` to return a row.
- The friends modal embeds the leaderboard via `refreshFriendsLeaderboard()`, so keep UI tweaks within `index.html`/`style.css` rather than the removed standalone modal. Update `style.css` `.friends-*` blocks when adjusting layout.
- Remote payload snapshots include `ownerEmail` so we can query `/rest/v1/user_payloads?payload->>ownerEmail=eq.email`. Friend detail modal logic lives in `viewFriendDetail()`, `fetchFriendPayloadByEmail()`, and related helpers; they expect the payload to contain `friends` arrays for mutual-sharing checks.

# GBrain Observatory

A local interface for reading GBrain source connections and synchronization results. The default route (`/`) opens the source list. The source screen offers an authenticated manual GBrain connection check when the server explicitly enables an audited local connection. Defaults remain unconfigured. Connection success reports version, scope and observation time; source-list integration belongs to Story 1.4. See the [connection operations guide](operations/gbrain-connection.md) for settings, bounded execution and the unresolved live startup side-effect boundary.

## Run locally

Verified with Node **24.14.0** and npm **11.9.0**. The existing Node runtime was not changed.

```sh
npm ci
npm run dev
```

The app binds to `127.0.0.1:3443`. Protected content requires configured owner access through a dedicated Tailscale Serve HTTPS origin; direct backend requests are denied. See the [private-access operations guide](operations/private-access.md) for server settings, port checks and the guarded mapping lifecycle. Existing HTTPS 443/Funnel and port 3000 remain reserved for their current services. To run the production build:

```sh
npm run typecheck
npm run lint
npm run build
npm run start
```

## Languages

English is the default UI language. English and Korean are both supported, including navigation, connection guidance, accessibility labels, document metadata, and date/count formatting. Choose **Language → English / 한국어 → Apply language** to switch; a preference cookie preserves the choice across requests. Missing or unsupported preferences fall back to English. Source data retains its original language.

Interface strings live in typed dictionaries in `src/i18n/messages.ts`. Add both translations whenever changing the UI. Project documentation, code comments, and commit messages use English by default; see [AGENTS.md](AGENTS.md).

## Time zones

Time zone settings are independent of interface language. Choose **Time zone → Automatic (device)** or a supported named zone, then **Apply time zone**. Manual choices persist in an HttpOnly cookie and also work without JavaScript. Automatic mode uses the last validated device detection for server rendering, or UTC when there is none. The first hydrated tree matches that server value; device detection then updates the display. Without JavaScript or available detection, the effective-zone label accurately shows the saved detection or UTC fallback.

Detection uses the browser's own time zone, with no location permissions or external lookup. It checks on mount, focus, visibility, pageshow, and every 60 seconds while visible. Its separate cookie never replaces a manual preference. Invalid settings are rejected with localized feedback and preserve the valid saved preference. Supported IANA aliases remain available when saved.

All source and observation times share the effective zone. Each timestamp's title includes its offset at that instant, including daylight saving transitions; the original `datetime` value stays unchanged. Missing, invalid, offset-free and date-only source values never become invented instants. Date-only data remains a calendar value.

## Versions and initialization

Next.js **16.4.3**, React / React DOM **19.3.1**, Tailwind CSS / its PostCSS plugin **4.3.3**, and TypeScript **5.9.3** are pinned exactly. Use the committed `package-lock.json` with `npm ci` for reproducible installation. Direct dependencies and development tools are also pinned without version ranges.

The exact versions were checked against the official npm registry. A create-next-app **16.4.3** starter was inspected in a temporary directory without overwriting repository files:

```sh
npx --yes create-next-app@16.4.3 /tmp/<temporary-directory>/app \
  --ts --tailwind --eslint --app --src-dir --import-alias '@/*' \
  --use-npm --disable-git --skip-install --yes
```

React was pinned to the required version. Tailwind uses the shared PostCSS configuration. The starter's remote fonts are not used.

## Structure

- `src/app`: source route, localized metadata, global styles, and language preference form.
- `src/i18n`: shared English/Korean messages, strict instant formatting, named-zone validation and server preference resolution.
- `src/contracts`: source display data and query states; synchronization and observation times stay distinct.
- `src/composition`: server-only unconfigured initial state; no live GBrain calls or fixture selection.
- `src/security` and `src/proxy.ts`: validated owner/host/Origin policy, server guards and generic localized private responses.
- `scripts/observatory-serve.mjs`: scoped mapping ownership, collision checks and preservation verification; no automatic deployment or supervisor setup.
- `src/ui`: source list, state messages, and connection guidance. Refresh is available only when a loader exists.
- `public/fonts`: locally served Pretendard Variable and its SIL OFL license; no external font requests.
- `tests/fixtures`: synthetic data hosted separately by Vite, outside production routes.

Guidance distinguishes incomplete setup, query failure, and an unconfirmed cause without displaying raw errors. Refresh preserves the original observation time and labels previously checked results when retaining them.

## Verification

```sh
npm ci
npm run typecheck
npm run lint
npm run build
npx playwright install chromium
npm test
npm run test:operations
```

`npm run verify` runs typecheck, lint, a fixture-environment-injected production build, all browser tests and the operations safeguards together. `npm test` runs browser tests; `npm run test:operations` runs the isolated lifecycle checks.

Playwright starts an isolated Vite fixture host and a test-only Serve-emulating proxy in front of the production backend. Browser origins are centralized in `tests/support/ui.ts`; the fixture host stays separate. Tests cover source states, refresh behavior, keyboard/focus handling, narrow layouts, enlarged text, touch targets, automated accessibility, both languages, language persistence, and production fixture isolation. Captures are written to `test-results/`. See [tests/README.md](tests/README.md).

To check fixture isolation with values injected at build time:

```sh
GBRAIN_FIXTURE=success NEXT_PUBLIC_GBRAIN_FIXTURE=success SOURCE_FIXTURE=success npm run build
npm test -- tests/production.spec.ts
```

Synthetic UI and fake-CLI checks do not establish live tailnet identity, owner PC/mobile reachability, another real user's access, live GBrain integration, or real source permission filtering. Record local live HTTPS checks and remote-device acceptance separately using the operations guide. Automated accessibility and root text enlargement do not replace full WCAG, assistive technology, or browser UI zoom acceptance checks.

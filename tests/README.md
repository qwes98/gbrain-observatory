# Browser verification

Run `npm run verify` for typecheck, lint, a fixture-environment-injected production build, browser tests, and lifecycle safeguards. For browser-only checks, run `npm run build`, then `npm test`. Playwright starts the production Next backend behind a test-only Serve-emulating proxy and an independent Vite fixture host. The browser proxy uses `127.0.0.1:4173`, Next uses `127.0.0.1:4175`, and Vite uses `127.0.0.1:4174`. An invalid-configuration backend/proxy pair uses ports 4176/4177. Browser origins are centralized in `support/ui.ts`; the fixture host stays separate. Install Chromium with `npx playwright install chromium`, or select an existing browser with `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/path/to/chromium`.

The fixture entry is under `tests/fixtures`, outside Next's `src/app` routes. It imports the production UI and contracts directly. Scenario queries and deferred loaders exist only on the Vite host; production composition never reads them. Vite supplies a browser-safe empty `process.env` for Next Link without replacing the production link implementation. No real GBrain process, credentials, or memory mutations are used.

Tests cover loading, returned and empty lists, incomplete setup, failed and unknown queries, duplicate refresh protection, keyboard refresh focus retention without stealing focus after navigation, previous-result notices, independent timestamps, sanitized errors, dialog focus restoration, keyboard navigation, 320px layouts, 200% text, touch targets, and automated accessibility rules. Additional checks cover sidebar scrolling in a short enlarged viewport, invalid/offset-free timestamps, and expanded mobile navigation and guidance.

## Internationalization strategy

The full behavior suite (`sources.spec.ts`) runs once in the default English UI. It checks state transitions, duplicate requests, stale observations, keyboard/focus behavior, timestamp validation, and scrolling. Repeating these language-independent paths for every locale would increase cost without targeting additional language-specific risk.

Common tests use roles and accessible names from the typed translation catalog through `support/ui.ts`, rather than copying translated interface text into each test. Prefer semantic role/label locators; use an explicit test ID only when no meaningful user-facing locator is available. Do not add fake accessibility labels merely to stabilize tests.

`localization.spec.ts` parameterizes representative rendering, accessibility and narrow-layout checks for both supported locales. It also checks switching in both directions, persistence, server-rendered `lang`/metadata, unsupported preference fallback, and switching without JavaScript. These tests explicitly set the application's locale query (isolated fixture host) or preference cookie (production); Playwright's browser `locale` setting alone does not select this application's UI language.

Catalog-derived locators verify that the correct message is wired to each state or control; they do not independently verify translation quality. `support/locale-expectations.ts` therefore retains a small set of fixed English/Korean acceptance examples, independent of the application catalog and formatters. These anchors catch a wrong dictionary or English fallback shared by the UI and its tests. Catalog key parity/nonempty checks and fixed date/count examples supplement the UI checks. Every non-English message is also checked against its English counterpart to reject exact English fallback; intentionally identical text must be explicitly listed in `sharedMessageAllowlist` in the independent expectations file. The allowlist is currently empty, and unknown or obsolete entries fail the check. This detects untranslated fallback, not semantic translation quality. Large counts include locale grouping, and previous-observation notices retain an explicit UTC offset. Translation quality still requires human review.

Source names, paths and supplied status descriptions are data, not UI translations. Shared input in `fixtures/source-data.ts` deliberately contains Korean to verify Unicode and original-content preservation in both UI languages. Korean text belongs in this data and in independent Korean localization expectations, not in the common behavior suite.

## Time zone coverage

Existing source behavior fixtures explicitly select Asia/Seoul, so local browser settings cannot change their fixed expectations. `time-zone.spec.ts` adds independent UTC, Seoul and Los Angeles midnight/winter/summer/fall-back anchors, per-instant offsets and original `datetime` preservation. It covers strict calendar validation, missing/offset-free/date-only values, named aliases, manual/automatic precedence, saved-cookie validation, server-first UTC hydration, device-change events and visible-page intervals, native no-JavaScript persistence, invalid native submissions in both languages, and independence from language. Refresh checks retain original observations, result counts, request concurrency and focus while the shared zone changes.

The production bilingual 320px/200% captures include the time-zone selector, effective-zone status and native controls. Automatic detection is browser-local and saves only the separate detected-zone cookie; the explicit preference remains HttpOnly. Tests use synthetic device changes only on the isolated fixture host and do not add production fixture controls.

This coverage split is a project decision based on [Playwright's user-visible testing guidance](https://playwright.dev/docs/best-practices#test-user-visible-behavior), [semantic locator guidance](https://playwright.dev/docs/locators#locating-elements), [test-level parameterization](https://playwright.dev/docs/test-parameterize#parameterized-tests), and [browser locale emulation](https://playwright.dev/docs/emulation#locale--timezone). Add broader per-locale journeys when a language introduces distinct navigation, validation, bidirectional layout, or other behavior; do not mechanically multiply the entire suite.

Production tests also attempt fixture paths, queries, and runtime environment values, inspect emitted application/client files for synthetic data, and require observed requests to stay on the local origin. Captures are written to `test-results/`.

For build-time environment isolation, run:

```sh
GBRAIN_FIXTURE=success NEXT_PUBLIC_GBRAIN_FIXTURE=success SOURCE_FIXTURE=success npm run build
npm test -- tests/production.spec.ts
```

These synthetic checks do not establish live Tailscale identity, real-device access, live GBrain integration, source permission filtering, or support for a particular upstream response. The 200% check changes the document's root text size; browser UI zoom and assistive technology combinations require separate acceptance. Axe covers automated rules and does not establish full WCAG conformance.

## Private access and operations

`access.spec.ts` exercises the shared access policy and real Next page, RSC, action and API-path rejections, exact configured host/Origin enforcement, proxy spoof stripping, malformed server configuration, and localized denial guidance. The test-only proxy supplies a fixed synthetic owner identity and maps its own browser Origin to the configured HTTPS test origin. It strips incoming identity/forwarding headers before supplying trusted values. There is no production bypass flag. Existing language/time-zone tests continue through the proxy, including independent browser contexts and native forms.

Run the lifecycle checks independently:

```sh
npm run test:operations
```

These tests inject an isolated fake CLI with temporary private filesystem state. They verify install/remove command scope, structurally equivalent preservation of existing 443/Funnel and other mappings, foreground/Service collisions, occupied-port refusal, ownership and endpoint mismatch refusal, preflight races, retained failure evidence and lock protection. They never invoke the installed Tailscale CLI or change real services.

The operations tool requires ports to be free before installation, so manual installation precedes launching the app. See the [operations guide](../operations/private-access.md) for guarded lifecycle commands and distinct simulated, local HTTPS and real PC/mobile/other-user acceptance evidence. Implementation tests do not claim those live acceptance checks.

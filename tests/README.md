# Browser verification

Run `npm run verify` for typecheck, lint, a fixture-environment-injected production build, browser tests, and lifecycle safeguards. For browser-only checks, run `npm run build`, then `npm test`. Playwright starts the production Next backend behind a test-only Serve-emulating proxy and an independent Vite fixture host. The browser proxy uses `127.0.0.1:4173`, Next uses `127.0.0.1:4175`, and Vite uses `127.0.0.1:4174`. An invalid-configuration backend/proxy pair uses ports 4176/4177. Browser origins are centralized in `support/ui.ts`; the fixture host stays separate. Install Chromium with `npx playwright install chromium`, or select an existing browser with `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/path/to/chromium`.

The fixture entry is under `tests/fixtures`, outside Next's `src/app` routes. It imports the production UI and contracts directly. Scenario queries and deferred loaders exist only on the Vite host; production composition never reads them. Source navigation uses native History and semantic anchors, so the fixture host needs no Next router context. No real GBrain process, credentials, or memory mutations are used.

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

## GBrain connection coverage

`connection.spec.ts` exercises a dedicated configured Next backend on 4178 behind the test-only proxy on 4179. Its executable and working directory are temporary fake-CLI files; `support/access-server.mjs` explicitly clears connection settings for the existing unconfigured backends. No production query, form field or environment scenario flag selects fake data. The fake executable reads its scenario from its own temporary operator file, which the sequential connection tests control; application requests cannot select it. Builds launch no GBrain process. Authenticated configured page GETs intentionally perform one bounded three-command source read; each connection test clears recorded initial calls before checking manual-action budgets.

The eleven connection browser tests cover fixed argv despite hostile form/query values, pending duplicate protection, previous timestamps, success/empty/failure/manual retry, actual initial source rows, no raw diagnostics in connection output, actual rendered server-action identity/host/Origin rejection with zero spawns, two-client localized busy refusal and retry, aborted-action recovery, keyboard focus continuity without stealing focus elsewhere, and preserved denial redirects, English/Korean no-JavaScript submissions, independent preferences, narrow/enlarged captures, and axe. Fixed bilingual heading examples supplement catalog-driven locators. Captures are `test-results/connection-{en,ko}-320-enlarged-native.png`.

`operations/gbrain-connection.test.mjs` compiles the actual TypeScript adapter into temporary JavaScript with TypeScript's transpiler and tests it against the same isolated public-CLI double. The registered `test:operations` wildcard runs every operations test file, including configuration/audit gating, safe capability/runtime schema validation, explicit rejection of partial/continuation envelopes, fixed sequential argv, zero/nonzero counts, sanitized failure classification, byte limits, concurrent refusal, descendant cleanup and a real 15-second SIGTERM-resistant timeout followed by a successful lease reuse. No real GBrain executable is used. The [connection guide](../operations/gbrain-connection.md) separates these results from installed CLI/preflight evidence and the remaining live lifecycle limitation.

## Real source-list coverage (Story 1.4)

The configured tests remain in the single serial `connection.spec.ts` group because its fake CLI uses shared operator scenario files. They cover real Next initial reads and refresh transport, duplicate names and original multilingual values, independent missing Folder/Git fields, inert hostile URLs, exact sidebar/table selection, original timestamps, unknown synchronization result/registry coverage, manual single-flight refresh, unsupported and failed previous observations, actual Proxy denial purging table/sidebar/detail, rejection before spawning, and bilingual 320px/200% detail captures with axe. Detail captures are `test-results/source-detail-{en,ko}-320-text200.png`.

The fixture behavior tests add composite identity validation, independent expansion, reload/Back/return focus and position, malformed/wrong-connection/missing selection, denial and successful omission. The operations suite tests the actual list projection, unknown coverage and exact preserved fields, scoped empty/unsupported/failed/permission states, and the shared lease between list reads and count probes in both directions. Existing language/time-zone checks continue to run. Synthetic and installed-interface evidence do not establish physical-device, browser UI zoom, assistive-technology or real per-source authorization acceptance.

Review regressions also cover real language/time-zone submissions overlapping a slow refresh, transient versus authoritative server seeds, old-request suppression after denial/omission, copied/native href expansion bounds, actionable expanded child links, empty-name ID fallback, native GET refresh and unique accessible controls, and stalled transport recovery using Playwright's accelerated clock. Focused bilingual time-zone correction checks start from a reloaded invalid URL, clear the error without losing source navigation, then repeat correction to the already-saved value. The existing language-switch/persistence check guards committed select values after enhanced form resets. Operations assertions verify nonzero page counts and distinct namespaces for different successful executable/cwd configurations.

## Recent Page coverage (Story 1.5)

`pages.spec.ts` exercises production Page presentation with isolated synthetic
data from `fixtures/page-data.ts` and deferred loader controls in the Vite fixture.
It covers keyboard listbox filtering and clearing, original multilingual data,
unknown-date exclusion, append/deduplication and failed-more retention, condition
and effective-zone races, authoritative denial/Source omission and late-response
suppression. Fixed independent UTC/year-rollover/23-hour spring/25-hour fall
examples validate calendar semantics; independent English/Korean examples and key
parity detect shared dictionary fallback. Bilingual 320px/200% text captures and
axe checks cover the selected-Source Page table. Captures are
`test-results/pages-{en,ko}-320-text200.png`.

Configured API/SSR/native Page checks live in the existing serial
`connection.spec.ts` group. Its scenario files are shared, so do not run another
configured scenario file in parallel. These checks validate authentication and
host/Origin before spawning, bounded hostile requests, exact Source revalidation,
private/no-store projection, first ten candidates and manual append/retry, native
filter/preference navigation retention and bilingual narrow captures. Unselected
Source-list requests retain their three-call source acquisition; selected reads
also execute the separate scoped Page acquisition.

`operations/gbrain-pages.test.mjs` transpiles the actual adapter and tests fixed
argv, composite scope, explicit timestamp availability, oversized/failed/partial/
wrong-identity details, body/frontmatter exclusion, end/cap/failure distinctions,
unsafe/duplicate capabilities and shared lease refusal. A shortened actual child
deadline exercises timeout cleanup without waiting 45 seconds; the production
overall deadline is separately asserted. These checks use temporary fake CLI
files and never invoke the installed GBrain executable. Installed Adapter evidence
belongs separately in the story record and never substitutes for synthetic matrix
coverage or physical-device/assistive-technology acceptance.


## Page reading coverage (Story 1.6)

`page-detail.spec.ts` exercises the production Page reader with isolated
`fixtures/page-detail-data.ts` content. It covers exact Page selection,
memories/body/references, verified original-location highlighting, safe raw text,
shared panel/full state, bounded navigation, authority/late-response discards,
keyboard focus and mobile background exclusion. Focused English/Korean checks
use independent fixed translation examples, 320px/200% text and axe. Source
content remains multilingual original data independent of UI translations.

`operations/gbrain-page-detail.test.mjs` runs the actual transpiled adapter
against the public CLI double. It covers catalog safety, fixed exact operations,
public facts-fence parsing, malformed/partial/protected bodies, exact backlink
endpoints and bounded verification, sanitized failures and shared execution
budgets. The configured transport/native settings checks remain in the serial
`connection.spec.ts` group, using its existing operator scenario file. Do not run
another configured suite with independent scenario mutation concurrently.

Run the registered `npm run verify` entry point for integrated checks. Synthetic
positive facts/backlink coverage does not establish positive live samples,
physical-device acceptance, assistive-technology acceptance or full WCAG
conformance. Installed-adapter observations and direct mockup comparisons belong
in the Story 1.6 evidence, with private source text and identifiers excluded.


Story 1.6 review regressions additionally distinguish freshly returned rows from
append carry and require the list request to begin after a Page exclusion. They
cover cached/late cross-Source permission removal, explicit retry of a seeded
error, actual query serialization/settings roundtrips, exact public window text,
failed-reference disclosure, and unoccluded background controls at 1440/958px.
Configured native checks assert hidden full-mode lists remain deferred, refresh
preserves Page/view, and onClick-only location controls are absent without JS.

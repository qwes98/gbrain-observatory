# GBrain Observatory

A local interface for reading GBrain source connections and synchronization results. The default route (`/`) opens the source list. Story 1.1 currently shows connection setup guidance; live GBrain queries, authentication, and synchronization commands belong to later stories.

## Run locally

Verified with Node **24.14.0** and npm **11.9.0**. The existing Node runtime was not changed.

```sh
npm ci
npm run dev
```

Open `http://localhost:3000`. To run the production build:

```sh
npm run typecheck
npm run lint
npm run build
npm run start
```

## Languages

English is the default UI language. English and Korean are both supported, including navigation, connection guidance, accessibility labels, document metadata, and date/count formatting. Choose **Language → English / 한국어 → Apply language** to switch; a preference cookie preserves the choice across requests. Missing or unsupported preferences fall back to English. Source data retains its original language.

Interface strings live in typed dictionaries in `src/i18n/messages.ts`. Add both translations whenever changing the UI. Project documentation, code comments, and commit messages use English by default; see [AGENTS.md](AGENTS.md).

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
- `src/i18n`: shared English/Korean messages and server-side locale resolution.
- `src/contracts`: source display data and query states; synchronization and observation times stay distinct.
- `src/composition`: server-only unconfigured initial state; no live GBrain calls or fixture selection.
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
```

Playwright starts the isolated Vite fixture host at `127.0.0.1:4174` and the production server at `127.0.0.1:4173`. Tests cover source states, refresh behavior, keyboard/focus handling, narrow layouts, enlarged text, touch targets, automated accessibility, both languages, language persistence, and production fixture isolation. Captures are written to `test-results/`. See [tests/README.md](tests/README.md).

To check fixture isolation with values injected at build time:

```sh
GBRAIN_FIXTURE=success NEXT_PUBLIC_GBRAIN_FIXTURE=success SOURCE_FIXTURE=success npm run build
npm test -- tests/production.spec.ts
```

Synthetic UI checks do not establish live GBrain integration, authentication, or real permission filtering. Automated accessibility and root text enlargement do not replace full WCAG, assistive technology, or browser UI zoom acceptance checks.

# GBrain source/Page reads and manual connection checks

The authenticated source screen can check one server-configured local GBrain connection. Authenticated dynamic page requests read the source list once after the owner guard. A page reload or native preference submission can therefore read sources again. Builds never read GBrain. A manual native form POST requires the configured authorized identity, host and external HTTPS Origin again at the action boundary. There is no polling, prefetch, automatic retry, command input or browser credential field.

Connection results are separate from source-list results. A successful probe reports the actual supported version, observation time, local active-source scope and observed count. Zero is successful. The separate source-list read renders actual returned rows in the table and sidebar; the connection check itself still returns count-only evidence. The display uses the shared language and effective time zone. During a new check, a displayed earlier observation keeps its timestamp and is explicitly marked previous. A failure clears that success instead of representing it as current.

## Server settings and audit gate

Missing, relative, invalid or incomplete settings remain unconfigured and launch no child process. Configure all of the following only after the audit below:

| Setting | Meaning |
| --- | --- |
| `OBSERVATORY_GBRAIN_EXECUTABLE` | Absolute path to the approved local public CLI executable or existing wrapper. Never selected by a request. |
| `OBSERVATORY_GBRAIN_CWD` | Fixed absolute working directory for that local configuration. Never selected by a request. |
| `OBSERVATORY_GBRAIN_READ_AUDIT` | Exact opt-in value `local-read-reviewed`; operator attestation that local routing, optional recording/transmission and startup lifecycle have been reviewed. |

The app inherits the server's environment, then fixes `GBRAIN_SKIP_STARTUP_HOOKS=1`, `GBRAIN_SWEEP=0`, `GBRAIN_NO_BANNER=1` and `GBRAIN_NO_RETRY_CONNECT=1` for every invocation. Server startup configuration is trusted; requests cannot choose executable, cwd, environment, command or arguments. No GBrain configuration is changed by Observatory. Configure the app through your existing server process mechanism; this feature does not deploy or restart services.

Before opting in, verify the selected working directory and inherited GBrain configuration refer to the intended **local** installation. GBrain can route the fixed public call through its thin-client configuration. The runtime does not independently enforce locality or inspect the inherited GBrain routing configuration. The local scope reported by this feature therefore depends on the audited inherited server configuration and the operator’s attestation; the opt-in value alone cannot prove locality. Audit that routing and any optional recording, notices, telemetry, provider transmission or background work. The source handler itself reads source registry data and visible-page counts; it does not call search, capture, recall, feedback or ingestion. The source-list projection returns validated source IDs, names, local paths, URLs, supplied metadata and timestamps to the authenticated browser for display. Paths and URLs remain inert text. Raw diagnostics are discarded; the connection-check projection retains only count/version/time. Neither projection caches memory data durably.

**The audit setting is an operator attestation, not proof of zero writes.** The official GBrain CLI may perform normal initialization and management records, including automatic pending schema migrations, retired-marker cleanup, behavior notices and official read-history bookkeeping. These lifecycle effects are permitted for connection checks when the installation's operating policy allows them. Observatory uses the same official CLI and configured local Brain as a terminal invocation while retaining its fixed read allowlist, authentication and execution budgets. Suppressing startup hooks and sweep does not suppress engine lifecycle effects, and exit 0 is not proof of zero writes. The connection-check policy does not permit Observatory-authored GBrain patches, direct DB/schema manipulation, explicit memory-write/ingestion or unrelated maintenance commands, optional capture/telemetry activation, new providers or unrelated configuration changes. Repository defaults still require explicit audited server configuration; secrets and rollback material remain private.

## Fixed public command policy

Source lists and connection checks execute these three commands in order, with `shell:false`:

1. `--version`: require exactly supported `gbrain 0.60.323.0` output.
2. `--tools-json`: validate the public catalog before reading sources. `sources_list` must uniquely advertise read scope, nonmutating/idempotent behavior, no extra required scopes, and the verified optional boolean `include_archived` parameter/schema.
3. `call sources_list {}`: validate the exact supported source envelope and rows, then project either count-only connection evidence or source basic information.

Different versions, malformed JSON, unsafe/missing capability declarations, unexpected rows or partial/continuation envelopes stop the affected operation and request compatibility revalidation. The adapter rejects partial/continuation shapes rather than pretending a sample is complete. It does not follow cursors. Scope is the active sources actually returned by the selected connection, excluding archived sources. The public catalog warns that access filtering can silently withhold rows; registry total and coverage remain unknown, including for an empty list. This returned count is never a global registry total; this does not imply remote OAuth scope, every memory, or an atomic cross-command snapshot.

One global lease per Node process covers the entire operation, shared between source reads and connection checks. Concurrent checks are refused immediately; there is no queue. Run a single production Node process to enforce this limit across requests. Each command has a **15,000ms** execution limit, **1,048,576-byte stdout** cap and **65,536-byte stderr** cap. Output limits count bytes before decoding. A timeout or excess output sends SIGTERM to the process group, then SIGKILL after **250ms**; on every completion, including success, the remaining group is killed before releasing the lease. Active groups are also killed synchronously during Node exit, SIGTERM and SIGINT, while preserving existing server shutdown handlers and Node’s default signal exit behavior. The server waits for child closure/reaping. Thus a three-call check has up to 45 seconds of command execution plus bounded termination/OS scheduling overhead; these are safety budgets, not a response-time SLA. Connection retry suppression also prevents the installed CLI's optional internal connection retry loop. Uncatchable termination such as SIGKILL, a host crash or power loss cannot run JavaScript cleanup; the service supervisor must terminate the entire service process tree/cgroup for that case. This app does not change supervisor settings.

Only confirmed spawn `ENOENT` and `EACCES` produce not-found and permission guidance. ENOENT can refer to the executable, interpreter or working directory. Timeout, output-limit and busy conditions have separate guidance. Other exits remain unknown failures. Nothing infers authentication, network or database causes from stderr text. Raw output, paths, stack traces and secrets are never returned in results.

## Verification evidence and remaining limits

An installed public CLI sample using version **0.60.323.0** measured version 28ms/18 stdout bytes, discovery 167ms/243,872 bytes and source probe 219ms/1,096 bytes, with four active sources and no source content copied. These measurements informed the execution budgets; performance depends on the installation.

An observational preflight using `doctor --only schema_version,behavior_changes --no-migrate --json --budget-ms 5000`, with a separate 8-second outer bound, no shell and hooks/sweep disabled, exited 0 in **312ms** with **371,613 stdout bytes**, **0 stderr bytes** and both selected checks `ok`. No raw report was retained. This establishes only that those checks succeeded in that environment; it does not guarantee a subsequent source call avoids lifecycle writes. Doctor is not part of the runtime adapter allowlist.

Automated verification uses a temporary fake public CLI and a dedicated Next backend, distinct from unconfigured production-isolation backends. It covers fixed argv, discovery ordering, nonempty/empty reads, unsupported partial shapes, schemas, privacy, confirmed and unknown failures, output budgets, SIGTERM-resistant timeout/reaping, descendants and concurrent refusal. Browser checks exercise the identity/Origin boundary, native forms, both locales, independent preferences, previous observation, 320px/enlarged text and automated accessibility. These automated checks establish application behavior with a fake CLI.

## Deployment validation

A deployment validation using the production adapter and GBrain **0.60.323.0** returned four active registered local sources in **387ms** after a local routing and optional-side-effect audit. The validated configuration used loopback PostgreSQL with thin-client routing disabled; GBrain-related environment overrides matched the terminal. This result applies to that configuration and does not establish connectivity for other installations.

Chromium accessed the private Tailscale Serve HTTPS origin. English with JavaScript and Korean native no-JavaScript submissions both succeeded, with version/scope/time/count evidence and no page errors. Language switching, time-zone persistence and manual rechecking also passed. Wrong-Origin execution returned 403 without cookie changes; direct backend access and a synthetic unauthorized identity were denied.

Physical PC/mobile devices, a different real tailnet user, assistive technologies, browser UI zoom and restart supervision remain unverified. Source-table acceptance is separate from connection-check acceptance. A fresh checkout defaults to unconfigured; each installation needs its own audited server settings and deployment validation.

## Source navigation and refresh

The source reference is a structurally encoded pair of a stable connection namespace and the original Source ID. The namespace is SHA-256 over the fixed executable/cwd tuple and exposes neither path. Duplicate names remain distinct. Selection and independent sidebar expansion use URL parameters; Back, reload and list return preserve identity. History retains only navigation identity and position, never source values. Invalid, duplicate or missing selection never falls back to another source. When a successful read omits the selected ID, its detail disappears and a safe list-return link remains.

`POST /api/sources` repeats the identity, configured Host and Origin checks and ignores request bodies/query values. Requests use private/no-store responses; there is no polling, retry, continuation or durable browser/server memory replica. Busy/failed/unsupported reads retain a permissible previous snapshot with its original observation time and a previous-information label. Confirmed execution permission denial and unauthorized refresh discard it, including sidebar/detail content. Silent upstream filtering cannot identify a specific denied source; an omitted selection is only described as unavailable.

Folder and Git are independently nullable. Federated, strategy, page count and original timestamps are shown as supplied, without inventing a service classification. `sources_list` supplies neither a synchronization outcome nor Connector/Provider relationships. Last synchronization and observation are distinct, and even a non-null synchronization timestamp never implies success. `sources_status` is excluded because its clone/ingestion diagnostics do not establish the missing synchronization outcome.

The installed public-interface investigation on 2026-10-30 verified version 0.60.323.0 (31ms), catalog discovery (161ms), and a four-row list (207ms). Only schema/count/timing evidence was retained. Synthetic browser and fake-CLI evidence remains separate from installed-adapter validation and physical-device acceptance.

Review hardening preserves source selection and expansion through both language and time-zone submissions. Enhanced submissions reconcile the existing screen in place; native submissions use validated internal redirects. Transient server results retain a permissible previous observation and a surviving refresh; authoritative results supersede older requests. Source-only navigation limits expansion query data within 1,024 characters; combined Page identity/view navigation remains bounded within 2,048 characters. Native GET refresh uses the same authenticated page; enhanced refresh uses POST with a 60-second client transport deadline, above the server's three-command execution budget. Empty or whitespace-only names use the original Source ID for presentation. Initial reads use ordinary server rendering and browser navigation progress, preserving correct native connection forms in a single acquisition.

Final Story 1.4 verification passed typecheck, lint, production build, 134 synthetic browser checks and 40 operations checks. The final independent follow-up reported no actionable findings. The installed production Adapter separately returned four active sources at 2026-10-30T04:44:55.799Z in 1,224ms, preserving unknown registry coverage and synchronization outcomes. This was an Adapter validation, with no deployment, service restart or setting change; it does not establish physical-device acceptance.

## Recent Pages in an exact Source (Story 1.5)

Selecting a permitted Source reads its recent Page candidates through the public
`list_pages` operation, fixed to `sort: "created_desc"`, ten candidates per batch
and raw offsets below 100. The adapter repeats version/catalog/current-source
validation for every acquisition under the shared process lease. It never accepts
request-provided commands, executable paths, environment or arbitrary URLs.
`POST /api/pages` authenticates before reading the bounded JSON request, accepts
only the exact structural Source reference and allowed offset, and returns
private/no-store results. Unselected Source-list loads do not read Pages.

Exact `get_page` requests enrich each candidate's timestamps with `fuzzy: false`.
Only verified detail `created_at` becomes added time, meaning Brain-row creation,
not original authorship or first ingestion. Modification remains independent.
Missing, invalid, failed, unsupported, partial or changed-identity detail never
fabricates creation time. Bodies and frontmatter are discarded before projection.
The ordinary official CLI lifecycle/read-history policy above also applies to
these detail reads; this does not authorize explicit writes or upstream patches.

A Page acquisition has one 45-second overall deadline within the existing child
timeout/byte/cleanup budgets. Source lists, connection checks and Page batches
share the immediate-refusal lease. There is no polling or automatic retry.
Additional-read failures retain permitted prior rows and their original
observations; denial or successful Source omission removes them. Page failure
does not alter Source synchronization status.

The UI's All/Today/Yesterday filters apply only to the loaded range in the shared
effective time zone. Unknown creation dates are excluded from day filters. Native
initial Page results, filters and refresh work without JavaScript. Additional-results
append requires JavaScript; native refresh starts again with the first batch.
Native filter and preference submissions preserve validated Source/condition
navigation; enhanced filter controls preserve keyboard focus. Composite identity prevents
equal slugs from merging across Sources. Raw offset advances independently of
deduplication. Observed end, the 100-candidate application cap and failure remain
distinct, with explicit unknown coverage and concurrent-offset drift disclosures.
Page bodies are excluded from list results. The separate detail acquisition below owns Page reading.

`tests/operations/gbrain-pages.test.mjs` and the Page browser tests use isolated
synthetic CLI/fixture data. Executed results and separately sanitized installed
Adapter evidence are recorded in Story 1.5's Implementation Notes. Test presence,
historical live samples and screenshot/axe checks do not establish physical-device,
assistive-technology or real per-source authorization acceptance.


## Exact Page reading (Story 1.6)

`POST /api/page-detail` authorizes the owner and Origin before reading a bounded
JSON body containing only the canonical Source reference and slug. Direct/native
page URLs use the same composition and exact public reader after owner validation.
The adapter validates the installed version, safe catalog and current Source
before calling `get_page` with `source_id`, exact `slug` and `fuzzy: false`.
Bodies stay in transient detail results; list DTOs continue to discard bodies and
frontmatter. Every response remains private/no-store.

The public `compiled_truth` and `timeline` sections retain their original text.
Protected bodies are not recovered through files, DBs or alternate interfaces.
Partial/outline/window/continuation responses remain partial; verified public
window text is displayed as an excerpt. A valid public facts fence contributes
Page-local rows preserving claims, kinds and supplied fields. Row numbers are not
Fact IDs. Finding a claim in its original public table identifies a location in
this Page, not direct Fact supporting evidence. Missing verified fences in a full
public body mean only that no public memory section was found; protected,
malformed and partial sections leave memory linkage unknown. No recall is run.

`get_backlinks` is fixed to the current Source/slug and a limit of ten. Each
returned target endpoint must match this Page. A candidate origin is linked only
when its Source is currently allowed and its own exact `get_page` confirms its
identity/title. Identity-union, inaccessible, mismatched and unverified endpoints
are omitted with a partial state; truncation and continuation are preserved
without following cursors or fetching more results automatically.

Detail operations share the single process lease and existing child timeout,
byte and cleanup policies. The complete operation has a 45-second budget;
client transport stops after 60 seconds and requires explicit reopening after
failure. The UI uses the same result for panel/full reading, native radio views
and bounded identity/view URLs. History contains position/focus metadata only.
Permission/Source changes discard the affected data and block late responses.
Raw HTML, scripts, media and local paths remain inert; safe external hyperlinks
require explicit activation and do not send a referrer.

Synthetic fixtures, fake-CLI operations and configured native browser checks are
separate from installed-adapter evidence and physical-device acceptance. Current
executed verification and any unavailable positive live facts/backlink samples
are recorded in the Story 1.6 implementation/evidence documents.


Review hardening bounds navigation using the actual URLSearchParams serializer,
retains Page/view/full identity through native refresh and skips the hidden Page
list on direct full reading. A newly returned Page identity can remove a local
exclusion only when its acquisition began after that exclusion; carried append
rows and older delayed responses cannot reauthorize it. Current Source authority
also removes affected cached/late backlinks while preserving a still-permitted
main Page. Visible reference coverage remains capped at ten candidates with total
coverage unknown; public window excerpts and failed references keep their distinct
states. The review patch uses focused file-level regressions; aggregate verification
is recorded separately by the coordinating build workflow.

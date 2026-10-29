# Manual GBrain connection checks

The authenticated source screen can check one server-configured local GBrain connection. Rendering, builds, language changes and time-zone changes never start GBrain. A manual native form POST requires the configured authorized identity, host and external HTTPS Origin again at the action boundary. There is no polling, prefetch, automatic retry, command input or browser credential field.

Connection results are separate from source-list results. A successful probe reports the actual supported version, observation time, local active-source scope and observed count. Zero is successful. The source table remains pending; this check does not establish source-list integration. The display uses the shared language and effective time zone. During a new check, a displayed earlier observation keeps its timestamp and is explicitly marked previous. A failure clears that success instead of representing it as current.

## Server settings and audit gate

Missing, relative, invalid or incomplete settings remain unconfigured and launch no child process. Configure all of the following only after the audit below:

| Setting | Meaning |
| --- | --- |
| `OBSERVATORY_GBRAIN_EXECUTABLE` | Absolute path to the approved local public CLI executable or existing wrapper. Never selected by a request. |
| `OBSERVATORY_GBRAIN_CWD` | Fixed absolute working directory for that local configuration. Never selected by a request. |
| `OBSERVATORY_GBRAIN_READ_AUDIT` | Exact opt-in value `local-read-reviewed`; operator attestation that local routing, optional recording/transmission and startup lifecycle have been reviewed. |

The app inherits the server's environment, then fixes `GBRAIN_SKIP_STARTUP_HOOKS=1`, `GBRAIN_SWEEP=0`, `GBRAIN_NO_BANNER=1` and `GBRAIN_NO_RETRY_CONNECT=1` for every invocation. Server startup configuration is trusted; requests cannot choose executable, cwd, environment, command or arguments. No GBrain configuration is changed by Observatory. Configure the app through your existing server process mechanism; this feature does not deploy or restart services.

Before opting in, verify the selected working directory and inherited GBrain configuration refer to the intended **local** installation. GBrain can route the fixed public call through its thin-client configuration. The runtime does not independently enforce locality or inspect the inherited GBrain routing configuration. The local scope reported by this feature therefore depends on the audited inherited server configuration and the operator’s attestation; the opt-in value alone cannot prove locality. Audit that routing and any optional recording, notices, telemetry, provider transmission or background work. The source handler itself reads source registry data and visible-page counts; it does not call search, capture, recall, feedback or ingestion. Source IDs, names, local paths, URLs, content and raw diagnostics are discarded after validation and never sent to the browser or cached durably.

**The audit setting is an operator attestation, not proof of zero writes.** The official GBrain CLI may perform normal initialization and management records, including automatic pending schema migrations, retired-marker cleanup, behavior notices and official read-history bookkeeping. These lifecycle effects are permitted for connection checks when the installation's operating policy allows them. Observatory uses the same official CLI and configured local Brain as a terminal invocation while retaining its fixed read allowlist, authentication and execution budgets. Suppressing startup hooks and sweep does not suppress engine lifecycle effects, and exit 0 is not proof of zero writes. The connection-check policy does not permit Observatory-authored GBrain patches, direct DB/schema manipulation, explicit memory-write/ingestion or unrelated maintenance commands, optional capture/telemetry activation, new providers or unrelated configuration changes. Repository defaults still require explicit audited server configuration; secrets and rollback material remain private.

## Fixed public command policy

The server executes at most these three commands in order, with `shell:false`:

1. `--version`: require exactly supported `gbrain 0.60.323.0` output.
2. `--tools-json`: validate the public catalog before reading sources. `sources_list` must uniquely advertise read scope, nonmutating/idempotent behavior, no extra required scopes, and the verified optional boolean `include_archived` parameter/schema.
3. `call sources_list {}`: validate the supported non-content source-list schema, then retain only a count and connection observation.

Different versions, malformed JSON, unsafe/missing capability declarations, unexpected rows or partial/continuation envelopes stop the affected operation and request compatibility revalidation. The adapter rejects partial/continuation shapes rather than pretending a sample is complete. It does not follow cursors. Scope is the selected local configuration's active registered sources, excluding archived sources; this does not imply remote OAuth scope, every memory, or an atomic cross-command snapshot.

One global lease per Node process covers the entire check. Concurrent checks are refused immediately; there is no queue. Run a single production Node process to enforce this limit across requests. Each command has a **15,000ms** execution limit, **1,048,576-byte stdout** cap and **65,536-byte stderr** cap. Output limits count bytes before decoding. A timeout or excess output sends SIGTERM to the process group, then SIGKILL after **250ms**; on every completion, including success, the remaining group is killed before releasing the lease. Active groups are also killed synchronously during Node exit, SIGTERM and SIGINT, while preserving existing server shutdown handlers and Node’s default signal exit behavior. The server waits for child closure/reaping. Thus a three-call check has up to 45 seconds of command execution plus bounded termination/OS scheduling overhead; these are safety budgets, not a response-time SLA. Connection retry suppression also prevents the installed CLI's optional internal connection retry loop. Uncatchable termination such as SIGKILL, a host crash or power loss cannot run JavaScript cleanup; the service supervisor must terminate the entire service process tree/cgroup for that case. This app does not change supervisor settings.

Only confirmed spawn `ENOENT` and `EACCES` produce not-found and permission guidance. ENOENT can refer to the executable, interpreter or working directory. Timeout, output-limit and busy conditions have separate guidance. Other exits remain unknown failures. Nothing infers authentication, network or database causes from stderr text. Raw output, paths, stack traces and secrets are never returned in results.

## Verification evidence and remaining limits

An installed public CLI sample using version **0.60.323.0** measured version 28ms/18 stdout bytes, discovery 167ms/243,872 bytes and source probe 219ms/1,096 bytes, with four active sources and no source content copied. These measurements informed the execution budgets; performance depends on the installation.

An observational preflight using `doctor --only schema_version,behavior_changes --no-migrate --json --budget-ms 5000`, with a separate 8-second outer bound, no shell and hooks/sweep disabled, exited 0 in **312ms** with **371,613 stdout bytes**, **0 stderr bytes** and both selected checks `ok`. No raw report was retained. This establishes only that those checks succeeded in that environment; it does not guarantee a subsequent source call avoids lifecycle writes. Doctor is not part of the runtime adapter allowlist.

Automated verification uses a temporary fake public CLI and a dedicated Next backend, distinct from unconfigured production-isolation backends. It covers fixed argv, discovery ordering, nonempty/empty reads, unsupported partial shapes, schemas, privacy, confirmed and unknown failures, output budgets, SIGTERM-resistant timeout/reaping, descendants and concurrent refusal. Browser checks exercise the identity/Origin boundary, native forms, both locales, independent preferences, previous observation, 320px/enlarged text and automated accessibility. These automated checks establish application behavior with a fake CLI.

## Deployment validation

A deployment validation using the production adapter and GBrain **0.60.323.0** returned four active registered local sources in **387ms** after a local routing and optional-side-effect audit. The validated configuration used loopback PostgreSQL with thin-client routing disabled; GBrain-related environment overrides matched the terminal. This result applies to that configuration and does not establish connectivity for other installations.

Chromium accessed the private Tailscale Serve HTTPS origin. English with JavaScript and Korean native no-JavaScript submissions both succeeded, with version/scope/time/count evidence and no page errors. Language switching, time-zone persistence and manual rechecking also passed. Wrong-Origin execution returned 403 without cookie changes; direct backend access and a synthetic unauthorized identity were denied.

Physical PC/mobile devices, a different real tailnet user, assistive technologies, browser UI zoom and restart supervision remain unverified. Source-table integration is separate from the connection check. A fresh checkout defaults to unconfigured; each installation needs its own audited server settings and deployment validation.

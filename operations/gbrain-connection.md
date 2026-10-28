# Manual GBrain connection checks

The authenticated source screen can check one server-configured local GBrain connection. Rendering, builds, language changes and time-zone changes never start GBrain. A manual native form POST requires the configured owner identity, host and external HTTPS Origin again at the action boundary. There is no polling, prefetch, automatic retry, command input or browser credential field.

Connection results are separate from source-list results. A successful probe reports the actual supported version, observation time, local active-source scope and observed count. Zero is successful. The source table remains pending; this check does not establish source-list integration or whole-MVP support. The display uses the shared language and effective time zone. During a new check, a displayed earlier observation keeps its timestamp and is explicitly marked previous. A failure clears that success instead of representing it as current.

## Server settings and audit gate

Missing, relative, invalid or incomplete settings remain unconfigured and launch no child process. Configure all of the following only after the audit below:

| Setting | Meaning |
| --- | --- |
| `OBSERVATORY_GBRAIN_EXECUTABLE` | Absolute path to the approved local public CLI executable or existing wrapper. Never selected by a request. |
| `OBSERVATORY_GBRAIN_CWD` | Fixed absolute working directory for that local configuration. Never selected by a request. |
| `OBSERVATORY_GBRAIN_READ_AUDIT` | Exact opt-in value `local-read-reviewed`; operator attestation that local routing, optional recording/transmission and startup lifecycle have been reviewed. |

The app inherits the server's environment, then fixes `GBRAIN_SKIP_STARTUP_HOOKS=1`, `GBRAIN_SWEEP=0`, `GBRAIN_NO_BANNER=1` and `GBRAIN_NO_RETRY_CONNECT=1` for every invocation. Server startup configuration is trusted; requests cannot choose executable, cwd, environment, command or arguments. No GBrain configuration is changed by Observatory. Configure the app through your existing server process mechanism; this feature does not deploy or restart services.

Before opting in, verify the selected working directory and inherited GBrain configuration refer to the intended **local** installation. GBrain can route the fixed public call through its thin-client configuration. The runtime does not independently enforce locality or inspect the inherited GBrain routing configuration. The local scope reported by this feature therefore depends on the audited inherited server configuration and the operator’s attestation; the opt-in value alone cannot prove locality. Audit that routing and any optional recording, notices, telemetry, provider transmission or background work. The source handler itself reads source registry data and visible-page counts; it does not call search, capture, recall, feedback or ingestion. Source IDs, names, local paths, URLs, content and raw diagnostics are discarded after validation and never sent to the browser or cached durably.

**The audit setting is an operator attestation, not proof of zero writes.** Ordinary installed GBrain connection startup may apply pending migrations, clear retired markers and perform behavior-notice bookkeeping before a read. Suppressing startup hooks and sweep does not suppress those engine lifecycle effects. No public source-call no-migration switch was found. Do not enable live checks while that boundary remains unresolved for the installation and its permitted operating policy. Do not substitute private DB access, patch GBrain, run maintenance/migration commands or interpret exit 0 as evidence that startup was nonmutating. The repository default stays unconfigured. Automated fake-CLI success does not authorize or establish live acceptance.

## Fixed public command policy

The server executes at most these three commands in order, with `shell:false`:

1. `--version`: require exactly supported `gbrain 0.60.323.0` output.
2. `--tools-json`: validate the public catalog before reading sources. `sources_list` must uniquely advertise read scope, nonmutating/idempotent behavior, no extra required scopes, and the verified optional boolean `include_archived` parameter/schema.
3. `call sources_list {}`: validate the supported non-content source-list schema, then retain only a count and connection observation.

Different versions, malformed JSON, unsafe/missing capability declarations, unexpected rows or partial/continuation envelopes stop the affected operation and request compatibility revalidation. The adapter rejects partial/continuation shapes rather than pretending a sample is complete. It does not follow cursors. Scope is the selected local configuration's active registered sources, excluding archived sources; this does not imply remote OAuth scope, every memory, or an atomic cross-command snapshot.

One global lease per Node process covers the entire check. Concurrent checks are refused immediately; there is no queue. Run a single production Node process as established in the architecture. Each command has a **15,000ms** execution limit, **1,048,576-byte stdout** cap and **65,536-byte stderr** cap. Output limits count bytes before decoding. A timeout or excess output sends SIGTERM to the process group, then SIGKILL after **250ms**; on every completion, including success, the remaining group is killed before releasing the lease. Active groups are also killed synchronously during Node exit, SIGTERM and SIGINT, while preserving existing server shutdown handlers and Node’s default signal exit behavior. The server waits for child closure/reaping. Thus a three-call check has up to 45 seconds of command execution plus bounded termination/OS scheduling overhead; these are safety budgets, not a response-time SLA. Connection retry suppression also prevents the installed CLI's optional internal connection retry loop. Uncatchable termination such as SIGKILL, a host crash or power loss cannot run JavaScript cleanup; the service supervisor must terminate the entire service process tree/cgroup for that case. This app does not change supervisor settings.

Only confirmed spawn `ENOENT` and `EACCES` produce not-found and permission guidance. ENOENT can refer to the executable, interpreter or working directory. Timeout, output-limit and busy conditions have separate guidance. Other exits remain unknown failures. Nothing infers authentication, network or database causes from stderr text. Raw output, paths, stack traces and secrets are never returned in results.

## Verification evidence and remaining limits

The spec records the earlier installed public CLI sample on **2026-10-28**, version **0.60.323.0**: version 28ms/18 stdout bytes, discovery 167ms/243,872 bytes, source probe 219ms/1,096 bytes; four active sources and no source content copied. Those measurements motivated conservative budgets and are historical evidence, not fresh post-implementation source-read acceptance.

The coordinator then performed only the approved observational preflight `doctor --only schema_version,behavior_changes --no-migrate --json --budget-ms 5000`, with a separate 8-second outer bound, no shell, hooks/sweep disabled: exit 0 in **312ms**, stdout **371,613 bytes**, stderr **0 bytes**, both selected checks `ok`. No raw report was retained. This proves that narrow preflight succeeded in that environment; it does not guarantee a subsequent source call avoids lifecycle writes. Doctor is not part of the runtime adapter allowlist and no new live source call was made for implementation acceptance.

Automated verification uses a temporary fake public CLI and a dedicated Next backend, distinct from existing unconfigured production-isolation backends. It covers fixed argv, discovery ordering, nonempty/empty reads, unsupported partial shapes, schemas, privacy, confirmed and unknown failures, output budgets, SIGTERM-resistant timeout/reaping, descendants and concurrent refusal. Browser checks exercise the real owner/Origin boundary, native forms, both locales, independent preferences, previous observation, 320px/enlarged text and automated accessibility. These checks establish application behavior with a fake CLI. Real source-read lifecycle acceptance, actual Tailscale identity, remote devices, assistive technologies, browser UI zoom and whole-MVP support remain unverified.

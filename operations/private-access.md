# Private owner access

The application accepts protected requests only through the configured Tailscale Serve HTTPS origin, with the exact configured owner login. The loopback connection and trusted local processes form the proxy trust boundary: a local process able to connect to the backend can supply identity headers. Keep the VM account and local services trusted. Never expose Next directly on LAN, tailnet or public interfaces. The policy does not depend on live GBrain access.

## Configure and prepare

Tailscale **1.102.2** is the target installed CLI. HTTPS must already be available on this node; do not modify tailnet policy or enable Funnel for Observatory. Keep the existing HTTPS 443 mapping/Funnel and the service on port 3000 intact. Use 8443 and 3443 only after the preflight succeeds. This story provides manual operation; reboot recovery and supervisor setup belong to Story 1.13.

Set these values in the same trusted shell used to start the application and manage the mapping. Replace the examples with the node's HTTPS name and the owner's exact Tailscale login. Do not derive either setting from a request or commit personal settings.

```sh
export OBSERVATORY_OWNER_LOGIN='owner@example.com'
export OBSERVATORY_EXTERNAL_ORIGIN='https://your-node.your-tailnet.ts.net:8443'
```

The external origin is the canonical HTTPS origin, without a path, trailing slash, query, credentials, or fragment. The lifecycle tool requires a `.ts.net` name and a dedicated port above 1023. `OBSERVATORY_APP_PORT` defaults to `3443`; when choosing another unoccupied port, also pass that port to Next. The tool excludes 3000, privileged ports and the external HTTPS port. The app's default `dev`/`start` commands bind to `127.0.0.1:3443`.

```sh
npm ci
npm run typecheck
npm run lint
npm run build
node scripts/observatory-serve.mjs check
```

`check` verifies the configured HTTPS name against the local node, reads Serve status, probes both selected local ports and reads status again. It performs no mapping changes. Run it while the app is stopped. A collision in TCP, Web, AllowFunnel, a foreground session, or a Service refuses the chosen HTTPS port. An occupied OS socket refuses either chosen port. The script never chooses another port silently. Choose another dedicated origin/port when necessary and rerun preflight.

## Install and run after code review

Implementation workers must leave this step to the coordinator after review. Serialize other local Serve/Funnel administration during the operation. The script has its own exclusive lock, but cannot lock out a separate operator or CLI invocation. It rechecks state before mutation and verifies state after mutation; unexpected changes retain private evidence and fail rather than replacing configuration.

With Next still stopped:

```sh
node scripts/observatory-serve.mjs install
npm run start
```

The install command uses only `tailscale serve --bg --https=<dedicated-port> http://127.0.0.1:<app-port>`. It does not configure Funnel, replace the whole Serve configuration, reset Serve, start Next, install a supervisor, or change the existing service. `--bg` keeps this dedicated Serve mapping after the CLI exits. Next runs in the foreground and stops when its terminal is interrupted. Starting the backend after installing the mapping leaves a brief unavailable endpoint, with no protected content exposed.

For development use the same mapping with `npm run dev`, after stopping any production backend. Direct loopback navigation has no trusted Serve identity and is denied. Missing or invalid access settings return generic localized 503 guidance. Rejected identities, host values and Origins return generic localized 403 guidance. Neither response prints configured identities or diagnostic values.

The tool stores its ownership record and raw before/after status evidence in `~/.local/state/gbrain-observatory/` with private permissions. Never commit or share those files: Serve status can contain private names and paths. Successful output reports only completion and preservation verification. Canonical sorted JSON comparison keeps every unrelated field and value equivalent despite harmless JSON object-key ordering changes.

## Remove the owned mapping

Use the same origin and app-port configuration as installation:

```sh
node scripts/observatory-serve.mjs remove
```

Removal requires the installed ownership record and an exact private HTTPS root handler pointing to the recorded loopback target. It refuses a missing record, changed destination, additional path handler, enabled Funnel, foreign endpoint on the selected port, or changed origin/port configuration. It removes only that endpoint with `tailscale serve --https=<dedicated-port> off`, then compares the entire remaining configuration with its pre-removal state. Unrelated changes made legitimately since installation are preserved.

Stop the foreground Next process separately if it is still running. Removal does not stop or alter any application process.

If a CLI call or preservation check fails, inspect the retained before/after evidence privately. A pending ownership record deliberately blocks automatic adoption or removal because successful installation was not verified. Do not edit records to adopt a pre-existing mapping, run a whole Serve reset, or replay an old full configuration. Resolve the specific mismatch through a separately reviewed endpoint operation. A stale lock after process termination also requires private inspection before deleting only the lock file.

## Acceptance evidence

Record each level separately, with timestamp, Tailscale version, selected ports, outcome and remaining limits. Do not copy identity values, private memory content, or raw CLI output into tracked evidence.

- **Simulated checks:** policy/browser tests use a test-only identity proxy; lifecycle tests use isolated fake CLI state. They cannot establish live tailnet identity or remote-device reachability.
- **Local live HTTPS check after review:** save private Serve status before and after; verify the existing 443/Funnel configuration and port-3000 service are preserved; open the configured HTTPS endpoint and confirm owner identity handling, private/no-store responses, and both independent preferences. Deny direct backend requests, wrong identity, wrong Host and wrong/missing execution Origin. A local same-node request may lack Serve user identity, so record the actual HTTP result rather than calling that owner acceptance.
- **Owner PC and mobile:** connect with the owner's Tailscale session, open the dedicated HTTPS origin, switch English/Korean and manual/automatic time zone with JavaScript, then repeat native preference forms without JavaScript. Record actual results separately for each device.
- **Another user:** verify a different Tailscale user cannot read the screen or execute preference actions and receives no preference-cookie changes.
- **Public reachability:** confirm Observatory has no AllowFunnel entry and the chosen endpoint is private. Preserve any unrelated existing Funnel.

At implementation time no live mapping was installed or removed by the implementation worker. Owner PC/mobile and another user's actual identity checks remain unverified unless the coordinator records them after review. Live GBrain access is outside this story.

## References

The workflow follows the official [Tailscale Serve CLI reference](https://tailscale.com/docs/reference/tailscale-cli/serve) for scoped HTTPS setup, status JSON, background operation and `off`. Configuration preservation checks follow the [Tailscale 1.102.2 ServeConfig schema](https://github.com/tailscale/tailscale/blob/v1.102.2/ipn/serve.go), including foreground sessions, Services and AllowFunnel. Serve user identity and its loopback trust boundary are documented in [Tailscale Serve identity headers](https://tailscale.com/docs/features/tailscale-serve#identity-headers).

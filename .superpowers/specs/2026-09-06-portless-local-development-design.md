# Portless local development design

**Status:** proposed

## Context

The four deployable surfaces currently have independent development commands and
fixed loopback ports:

| Surface | Workspace path | Direct command | Current URL |
| --- | --- | --- | --- |
| member app | `apps/app` | `pnpm --filter app dev` | `http://localhost:5173` |
| API | `apps/api` | `pnpm --filter api dev` | `http://localhost:8787` |
| gate scanner | `apps/gate` | `pnpm --filter gate dev` | `http://localhost:5174` |
| operator dashboard | `apps/dash` | `pnpm --filter dash dev` | `http://localhost:5175` |

This makes ports part of the developer-facing interface and prevents two linked
worktrees from using the same fixed ports at the same time. Portless replaces
those ports with named local URLs and assigns the backing ports dynamically.

Portless cannot be added as a package-script prefix alone in this repository:

- Vite/Vite+ can accept an injected port, but all three frontends currently call
  the API at the insecure absolute URL `http://localhost:8787`. An HTTPS page
  cannot make that mixed-content request.
- Wrangler requires its port through `wrangler dev --port`; it does not consume
  Portless's generic `PORT` environment variable.
- The API uses `API_BASE_URL` to produce absolute pass URLs, so local responses
  must contain the public Portless API URL rather than a backing port.
- A root Portless configuration is not discovered when Portless is launched from
  a workspace package, and Portless's framework argument injection does not
  interpret a root-level `pnpm --filter ...` command as the filtered package's
  Vite script.

The design therefore has a small root-owned adapter between Portless and the
existing package scripts. Portless remains responsible for proxy lifecycle,
certificate setup, URL naming, dynamic port allocation, and worktree prefixes.

## Goals

- Add root commands that expose the four surfaces at stable named HTTPS URLs:
  `app.localhost`, `api.localhost`, `gate.localhost`, and `dash.localhost`.
- Make `pnpm dev` start all four surfaces, while `pnpm dev:<surface>` starts one.
- Keep every Portless setting in the root `package.json`; do not add
  `portless.json` or edit an `apps/*/package.json`.
- Preserve Portless's worktree isolation. For example, a linked worktree named
  `feature-auth` uses `feature-auth.app.localhost` and
  `feature-auth.api.localhost` with independent backing ports.
- Keep browser-to-API traffic functional under the default Portless HTTPS mode.
- Preserve every existing direct workspace command and its current fixed-port,
  non-Portless behavior.
- Fail early with actionable configuration errors instead of starting a partly
  wired development stack.

## Non-goals

- Changing production hosts, deployments, Cloudflare bindings, or API CORS
  policy.
- Replacing the existing direct `pnpm --filter <name> dev` workflow.
- Supporting Portless LAN mode, public tunnels, arbitrary custom TLDs, or a
  non-default naming scheme in the fuda-specific URL adapter.
- Making local TLS trust installation non-interactive. Portless owns that
  machine-level operation and may prompt on first use.
- Adding a process-manager dependency solely to run the four child commands.

## Root interface and configuration

Pin `portless` at exactly `0.15.6` in the root `devDependencies`. Portless is
pre-1.0 and its shared on-disk state has changed between releases, so an exact
workspace version avoids different contributors accidentally operating the same
state with different minor versions.

Add the following root-level configuration shape to `package.json`:

```json
{
  "portless": {
    "apps": {
      "apps/app": { "name": "app" },
      "apps/api": { "name": "api" },
      "apps/gate": { "name": "gate" },
      "apps/dash": { "name": "dash" }
    }
  }
}
```

The `apps` map is the source of truth for both the all-app launcher and selective
launches. The launcher must validate that every entry has a supported path and a
unique, non-empty name. It must not maintain a second independent path-to-name
table.

The root command interface is:

| Command | Selection | Main-checkout public URL(s) |
| --- | --- | --- |
| `pnpm dev` | all configured apps | all four URLs |
| `pnpm dev:app` | `apps/app` | `https://app.localhost` |
| `pnpm dev:api` | `apps/api` | `https://api.localhost` |
| `pnpm dev:gate` | `apps/gate` | `https://gate.localhost` |
| `pnpm dev:dash` | `apps/dash` | `https://dash.localhost` |

Each script calls the root TypeScript launcher. A selective script passes its
workspace path, not a separately repeated hostname; the launcher resolves the
name from `portless.apps`.

A selective command starts only the named surface. A frontend that needs live
API data therefore also needs `pnpm dev:api` in another terminal; `pnpm dev` is
the one-command path for the complete local stack.

No fixed `appPort` is configured. Backing ports remain dynamic so concurrent
worktrees cannot collide.

## Launcher architecture

Add a root-owned module under `tooling/portless/`. It has two explicit modes:

1. **Coordinator mode** is entered by the root scripts. It loads and validates
   the root `portless.apps` map, selects one entry or all entries, ensures the
   Portless proxy is running once for an all-app launch, and creates one child
   per selected surface.
2. **Service mode** runs as the command wrapped by Portless. At this point
   `PORT`, `HOST`, and `PORTLESS_URL` are available. It validates those values,
   builds the appropriate existing workspace dev command, and replaces itself
   with or supervises that command.

Conceptually, a selective launch is:

```text
pnpm dev:app
  -> root coordinator selects apps/app -> app
  -> portless run --name app <root launcher in service mode for apps/app>
  -> PORT=4xxx PORTLESS_URL=https://app.localhost ...
  -> pnpm --filter app dev -- --port 4xxx --host 127.0.0.1
```

Using `portless run --name <configured-name>` is intentional: the explicit base
name comes from the root configuration, while `run` still applies Portless's
linked-worktree prefix.

For `app`, `gate`, and `dash`, service mode appends the validated dynamic port and
host to the existing Vite+ dev script. For `api`, it appends:

```text
--port <PORT> --ip <HOST> --var API_BASE_URL:<PORTLESS_URL>
```

to the existing `wrangler dev --env dev` script. The command-line variable
overrides only `API_BASE_URL`; other `dev` environment configuration and local
secrets keep their current sources.

The coordinator streams child output directly. On `SIGINT` or `SIGTERM`, it
forwards the signal to active children and waits for them to finish. If any
child exits during an all-app launch, it terminates the remaining children so a
partial stack is not left running, then returns the first child's status. A
normal selective child exit is returned unchanged. Portless continues to own
route cleanup and descendant cleanup around each service.

## Frontend-to-API routing

When `PORTLESS_URL` is absent, each Vite configuration is byte-for-byte
equivalent in behavior to today: its fixed port remains in force, no `/api`
proxy exists, and frontend configuration continues to fall back to
`http://localhost:8787`.

When `PORTLESS_URL` is present, a shared root helper validates that the URL:

- is an HTTP(S) URL with no credentials, path, query, or fragment;
- has the expected surface label immediately before `.localhost`;
- may have one Portless worktree-prefix label before the surface label; and
- preserves any explicit proxy port in the public URL.

It then derives the matching API origin by replacing only the surface label:

```text
https://app.localhost              -> https://api.localhost
https://feature-auth.app.localhost -> https://feature-auth.api.localhost
```

For all three frontends, Portless mode configures Vite as follows:

- expose `VITE_API_BASE_URL` as `/api` to browser code;
- proxy `/api/**` to the derived Portless API origin;
- remove the leading `/api` before forwarding; and
- set `changeOrigin: true`, which lets the strict Portless proxy route the
  forwarded request to the API service.

The browser therefore sees a same-origin request such as
`https://app.localhost/api/challenge`. TLS from Vite to the API's Portless URL
uses the `NODE_EXTRA_CA_CERTS` value that Portless injects into the child. The
API's production CORS allow-list does not need to trust development subdomains,
because CORS is no longer the browser boundary for this path.

For the member app only, Portless mode also exposes:

- `VITE_APP_ORIGIN=<the app's PORTLESS_URL>`; and
- `VITE_RP_ID=<the app URL's hostname>`.

Using the exact hostname as the WebAuthn RP ID keeps passkey ceremonies valid in
both the main checkout and linked worktrees. Direct local development keeps the
existing documented `localhost` override.

## Validation and errors

The root tooling must reject, with a concise message and non-zero exit status:

- a missing or malformed `package.json` `portless.apps` map;
- an unknown selective workspace path;
- duplicate configured Portless names;
- a configured path that is not one of the four supported deployable surfaces;
- service mode without a numeric `PORT` in the range 1-65535;
- service mode without a loopback `HOST`;
- a missing or malformed `PORTLESS_URL`;
- a URL whose surface hostname does not match the selected configuration; or
- an API URL derivation that does not match the supported `.localhost` layout.

Errors must identify the bad field or selected surface and describe the expected
shape. Validation happens before the workspace dev child is spawned.

## Testing

Implementation follows test-driven development. Root tooling tests cover:

- loading the four entries from the root `package.json` shape;
- rejecting missing, duplicate, unknown, and malformed entries;
- resolving each selective path without duplicating its Portless name;
- command construction for Vite+ and Wrangler, including safe argument
  boundaries for `--var`;
- `PORT`, `HOST`, and `PORTLESS_URL` validation;
- main-checkout and worktree-prefixed API URL derivation;
- rejection of a mismatched surface, path-bearing URL, credentials, and an
  unsupported hostname; and
- coordinator exit and signal behavior through injected/fake child processes.

Vite configuration tests assert that Portless mode adds the `/api` proxy and the
expected client values, while a missing `PORTLESS_URL` retains current config.
Existing frontend API tests continue to prove the non-Portless default.
The root test script must include the tooling suite as well as the existing
recursive workspace suites, so `pnpm test` remains the complete test entry point.

An integration smoke test starts Portless with an isolated state directory,
plain HTTP, and an unprivileged proxy port. It starts a representative frontend
and the API, then checks their named routes and a proxied `/api/health` request.
This test avoids changing the machine trust store or requiring `sudo`; default
HTTPS trust remains a documented first-run/manual check.

Before completion, run the focused tests, `pnpm check`, and the full
`pnpm test`. Also run Portless's diagnostic/list command against the isolated
smoke-test state where useful.

## Documentation and compatibility

Update `README.md` with the root commands, named URLs, first-run certificate
trust expectation, and the distinction between Portless and direct workspace
commands. Update `docs/specs/pass-types-and-flows.md` so its local-development
section describes the Portless same-origin `/api` path and worktree-prefixed
WebAuthn origin/RP ID behavior.

No ADR is required: the adapter and proxy are local tooling, and the durable
externally observable development behavior belongs in the existing system spec.

After implementation and verification, delete this temporary design and its
implementation plan in accordance with the repository's Superpowers artifact
policy. Git history remains the design archive.

## Rejected alternatives

### Store configuration in `portless.json`

This changes only where Portless reads its settings. It neither teaches
Wrangler to consume `PORT` nor fixes HTTPS frontend-to-API calls. The user also
prefers the documented root `package.json` key, so no `portless.json` is added.

### Fix the API backing port at 8787

An `appPort` entry would avoid the Wrangler adapter but recreates the collision
that dynamic ports are meant to remove, especially across linked worktrees.

### Add Portless scripts to every workspace package

This scatters configuration across four manifests and violates the requirement
that Portless registration remain at the root. Existing direct commands are
more useful as an explicit compatibility path.

### Call the API's Portless URL directly from each browser

That requires expanding CORS to a changing set of named worktree origins and
still exposes cross-origin behavior locally. A same-origin Vite proxy keeps the
browser contract simple and leaves production CORS policy unchanged.

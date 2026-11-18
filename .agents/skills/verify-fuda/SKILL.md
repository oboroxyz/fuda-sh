---
name: verify-fuda
description: Drive fuda's real local stack (api plus the gate, app or dash frontend) in a headless browser and save proof that a user-facing change works. Use after changing apps/gate, apps/app, apps/dash, packages/ui or an api route, when a claim needs evidence beyond unit tests, or when asked to show a flow working. Not for real devices, Wallet saves, NFC or deployed services.
---

# Verify fuda

This drives the same isolated stack `pnpm e2e` uses: a fresh api built from the `e2e` Void target, with its own D1 state and no secrets, plus one frontend's dev server. `scripts/fuda-verify` runs `packages/e2e/scripts/verify.ts`, which starts the stack, checks it, runs a journey in Chromium that saves evidence, and stops only what it started. Paths below are relative to the repository root.

Read `features/README.md` before driving, then the feature file for the flow you are proving.

## Launch

```sh
.agents/skills/verify-fuda/scripts/fuda-verify up gate     # or app, dash
```

`up` refuses if ports 8797 (api), 9339 (api inspector) or the surface port (gate 6174, app 6173, dash 6175) are taken, which usually means `pnpm e2e` or another agent's stack. It never drives or kills a stack it did not start. One stack at a time per checkout: the ports are fixed.

It runs `packages/e2e/scripts/stack.ts <surface>` in its own process group: `vp build` of `apps/api/targets/e2e`, `void db migrate` into an empty D1 under `packages/e2e/.e2e/state/<surface>`, `vp preview` of the api, then `vp dev` of the surface. It is ready when it prints a JSON line with `"ready":true`, after about 10 seconds with a warm build cache and up to 3 minutes cold. On failure it names the log, `packages/e2e/.e2e/verify/<surface>.log`. Read it, then run `down`.

Requirements: dependencies installed (`pnpm install --frozen-lockfile`), Chromium for `playwright-core` 1.64.1 (the version `@e2e-dev/web` pins) in `~/.cache/ms-playwright` (`packages/e2e/node_modules/.bin/e2e-web install` if missing), and `sqlite3` on PATH for `d1()` reads.

Node: the wrapper picks Node 24.22 or later and puts it first on PATH. That matters because `void` and `vp` start through `/bin/sh` wrappers that run the first `node` on PATH, and `void` exits with "Node.js 24.22+ or 26.12+ is required" otherwise. A machine where an older Node, such as a `~/.local/bin/node` symlink, comes before mise's Node 24 on PATH hits this. Set `FUDA_VERIFY_NODE=/path/to/node` to choose one. The same PATH issue breaks a bare `pnpm e2e` here; run it as `PATH=<node 24 bin>:$PATH pnpm e2e`.

## Doctor

```sh
.agents/skills/verify-fuda/scripts/fuda-verify doctor
```

Read-only. It prints JSON and exits non-zero unless all of these hold: the process group from `up` is alive, the api, inspector and surface ports are owned by that group, the api answers `/health` with `{"ok":true}`, the surface serves its HTML, and `HEAD` is still the commit the stack was built from. Run it before every drive and whenever anything looks off. If `headMatchesLaunch` is false, the api was built from older code: `down`, then `up`. Surface code hot-reloads, but api code does not.

## Drive

```sh
.agents/skills/verify-fuda/scripts/fuda-verify seed bearer   # bearer | venue | pass | operator
.agents/skills/verify-fuda/scripts/fuda-verify drive packages/e2e/journeys/gate-bearer-once.ts
```

`seed` prints the JSON that the seed helpers in `packages/e2e/tests/support/seed.ts` return. It goes through public api routes only:

- `bearer`: a single-use Bearer Right `{qr, uid}`, issued with the admin authority, which is open because the e2e api has no `ADMIN_TOKEN`.
- `venue [name]`: a venue owned by a throwaway key, with a published Membership Card `{operatorToken, handle, name, cardSlug, cardTitle}`.
- `pass [name]`: a venue as above, plus one claimed pass's `qr`.
- `operator`: a signed-in operator with no venue `{token}`.

A journey is a TypeScript module whose default export is a `Journey` from `packages/e2e/scripts/verify.ts`: `{ surface, viewport?, run(ctx) }` (see `packages/e2e/journeys/gate-bearer-once.ts`). `drive` opens headless Chromium with locale `en-US`, timezone `Asia/Tokyo`, `baseURL` set to the surface and a default viewport of 1280×800. It records a video and a Playwright trace for the whole run. `ctx` gives:

- `page`, `context`: Playwright objects. Use roles and accessible names (`getByRole`, `getByLabel`, `getByText`), the same handles the e2e tests use. Never use coordinates or CSS position.
- `seed.*`, `apiRequest(path, schema, {body, method, token})` and `v` (valibot): seed data and read the api under `/v1`.
- `step(name)`: saves `<nn>-<name>.png` (full page) and `<nn>-<name>.aria.txt` (the URL plus an ARIA snapshot). Call it after each action whose result matters.
- `d1(sql)`: one read-only `SELECT` against the stack's local D1, returning rows. Use it to prove side effects.
- `note(key, value)`: records a value in `journey.json`.
- `check(condition, message)`: fails the journey.
- `signInOperator(token)`: sets the dash `fuda_operator` cookie. The admin token path is the sign-in page's "Sign in with an admin token instead" with an empty token.

Write a one-off journey anywhere, such as the session's scratch folder. Import only the `Journey` type, by absolute path (`import type { Journey } from '<repo>/packages/e2e/scripts/verify.ts'`), and take everything else from `ctx`, because packages resolve only inside `packages/e2e`. Add one to `packages/e2e/journeys/` only when the feature map should keep it; that folder is linted and type-checked with the e2e package. Selectors and expected text for each flow are in `features/`.

## Evidence

`drive` writes to `artifacts/<YYYY-MM-DD>-verify-<journey>/` (Git-ignored; a second argument overrides it): numbered PNG and ARIA pairs, `journey.webm`, `trace.zip` (drop it on trace.playwright.dev, which reads it in the browser without uploading it), and `journey.json`. The JSON records the commit, whether the tree was dirty, URL, viewport, locale, timezone, the page's theme, every step, every note, the result and the error. On failure it also saves a `failure` step. It prints `{"result","evidence","steps"}` and exits 1 when the journey fails.

Proof standards:

- Go through the user's path: the screen's own controls, or the reader's keystrokes (`page.keyboard`). Never call the api's action endpoint in place of the control being proved. Seeding through the api is fine.
- Capture the action and its result: a step before the result and a step after it, not only the final screen.
- Prove side effects with `d1()` or an api read that is not the endpoint that made the change, and record them with `note`. A green verdict on screen alone is not proof of admission.
- Mocks only at boundaries the stack already isolates: the e2e target's fake chain and the throwaway signing keys. Do not stub the api from the browser.
- When handing off, give the evidence path, viewport, locale, theme and the fact that all data is fictional seed data.

## Cleanup

```sh
.agents/skills/verify-fuda/scripts/fuda-verify down
```

`down` sends SIGTERM to the process group `up` started, then SIGKILL after 15 seconds. It never kills by name. It restores every `apps/*/void.lock.json` to the exact bytes it saved at `up`, because the stack rewrites them with local values. It removes `packages/e2e/.e2e/verify` and the surface's D1 state, and never touches `artifacts/`. Run it after every drive session, including failed ones. Afterwards, `git status` should show no `void.lock.json` change. If `down` reports nothing to stop but a lockfile is still modified, restore it with `git checkout -- apps/<app>/void.lock.json`, after checking that the diff contains only local values such as `API_BASE_URL: http://127.0.0.1:8797`.

## Helpers

- `scripts/fuda-verify`: the entry point shown above. A `/bin/sh` wrapper that chooses Node, then runs the implementation.
- `packages/e2e/scripts/verify.ts`: the implementation. Its usage line: `up <gate|app|dash> | doctor | seed <bearer|venue|pass|operator> [name] | drive <journey.ts> [out-dir] | down`.
- `packages/e2e/journeys/gate-bearer-once.ts`: the gate scan journey, kept as a template.

Keep the feature map current with `/pstack:maintain-verification-skill`.

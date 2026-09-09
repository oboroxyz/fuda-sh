# Venue and Member Experience Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development to implement and review the tasks below. The controller executes local work alongside one implementation worker at a time; no worker delegates.

**Goal:** Deliver separate venue and member journeys in the existing app, with verified member authentication, a member Dock, and shared wallet/authentication/UI modules used by dash.

**Architecture:** Keep one app Worker and origin. Venue pages remain public and self-contained; member pages use a session-owned layout and public read scope. Share the wallet/signature sequence and token lifecycle, with separate member/operator server audiences and product-specific state.

**Tech Stack:** Hono DOM, Vite+, Tailwind, daisyUI 5, Base Account 2.5.10, viem, Query Core, D1/Drizzle, Vitest.

**Spec:** `.superpowers/specs/2026-09-09-venue-and-member-experience-design.md`

## Global Constraints

- Keep both experiences in `apps/app` on `app.fuda.sh`; no new Worker/hostname or worktree.
- A owns `/@<handle>/*`, never navigates to `/`, and requires no member session.
- B owns `/`, `/signin`, `/rights`, `/signed`, `/private`, `/settings`; only `/` and `/signin` are public. No `/signup`.
- B Dock: Your passes, Enter, +Private, Settings. No Dock on A, top, or sign-in.
- Member and operator nonces/tokens are not interchangeable. Member tokens must not fall through to open-admin behavior.
- No PRF output, private signing keys, or private discovery result associations enter persistent storage or shared read caches.
- Sign-out clears member session/transient data, preserves device-saved public passes and preferences, then goes to `/`.
- Keep existing operator tokens valid, existing dash admin behavior, and all ENS/card prerequisites.
- Use the supplied external mock as flow reference only; author all implementation here. No fake rewards, stamp counts, recovery, or push features.
- Preserve the pending root package.json/runbook dash-command work. Root owns lockfile/package dependency edits and canonical docs.
- Targeted verification during implementation; final root `pnpm check`, `pnpm test`, app/dash builds once on final content. No commits by workers; controller integrates after reviews.

## Task 1: Audience-scoped API authentication

**Owner:** API worker. **Files:** `apps/api/src/auth/{session,sign-in}.ts`, `apps/api/src/routes/auth.ts`, relevant middleware/env/schema, new `apps/api/migrations/0009_session_audience.sql`, API auth tests, `packages/sdk/src/types.ts` and exports if needed.

**Produces:**

```ts
// @fuda/sdk
export interface MemberSessionResponse { address: Hex }
export interface MemberSignInResponse extends MemberSessionResponse { token: string }
// Relative paths receive the API's normal /v1 prefix.
// POST /auth/member/challenge {address} -> existing SignInChallengeResponse
// POST /auth/member/verify {address,nonce,signature} -> MemberSignInResponse
// GET /auth/member/me Bearer token -> MemberSessionResponse
// POST /auth/member/logout Bearer token -> {loggedOut:true}
```

- [ ] Add API tests through real routes for member challenge/sign-in/me/logout/expiry. Test member tokens against `/issuers/me`, issuer registration, `/members`, `/revoke` with ADMIN_TOKEN set AND absent; expect 401, not an admin fallback. Test operator token rejected by member endpoints, wrong-audience nonce rejection, and old session rows defaulting to operator.

```ts
const denied = await getJson(app, testEnv(), '/v1/members', memberToken)
expect(denied.status).toBe(401)
const retained = await getJson(app, testEnv(), '/v1/issuers/me', operatorToken)
expect(retained.status).toBe(200)
```

- [ ] Run `pnpm --filter api exec vp test test/member-auth.test.ts` to establish missing behavior.
- [ ] Add `audience TEXT NOT NULL DEFAULT 'operator'` to sessions, with allowed member/operator values. Reuse scoped nonce helpers (`operator:<address>`, `member:<address>`) and distinct messages. Preserve old operator message and TTLs. Member sessions have null issuerId.
- [ ] Keep credential resolvers audience-aware. A recognized wrong-audience bearer must return 401 before an open-admin fallback; avoid treating it as an absent credential.
- [ ] Return `cache-control: no-store` on auth responses. Reuse existing error codes and signature verification; do not add a member profile table.
- [ ] Run new + existing auth/operator-scope tests and targeted vp checks. Write report with red/green evidence, file list, interface changes and concerns; no commit.

## Task 2: Shared wallet/auth and confirmation UI

**Owner:** Controller. **Files:** new `packages/libs/src/wallet/*`, `packages/libs/src/auth/*`, libs manifest/README, `packages/ui/src/ConfirmAction.tsx` and exports/styles, dash `wallet.ts`, `operator-sign-in.ts`, `operator-session.ts`, `session-generation.ts`, `SignOutButton.tsx`, app `wallet.ts`, `base-account.ts`, package dependencies/lockfile.

**Produces:**

```ts
// @fuda/libs/wallet
export interface Eip1193Provider { request(args: {method:string; params?:unknown[]}): Promise<unknown> }
export interface BaseAccountOptions { appChainIds: readonly number[]; appName?: string; paymasterUrls?: Record<string,string> }
export function baseAccountProvider(options: BaseAccountOptions): Promise<Eip1193Provider>
export function requestAccount(provider:Eip1193Provider): Promise<Hex>
export function personalSign(provider:Eip1193Provider,address:Hex,message:string): Promise<Hex>

// @fuda/libs/auth
export type SignInFailure = 'network' | 'rejected' | 'unavailable' | 'wallet'
export type SignInOutcome<T> = {ok:true;session:T} | {ok:false;failure:SignInFailure}
export interface WalletSignInIo<T> {
  provider(): Promise<Eip1193Provider>
  requestAccount(provider:Eip1193Provider): Promise<Hex>
  personalSign(provider:Eip1193Provider,address:Hex,message:string): Promise<Hex>
  challenge(address:Hex): Promise<Result<SignInChallengeResponse>>
  verify(body:{address:Hex;nonce:Hex;signature:Hex}): Promise<Result<T>>
}
export function authenticateWallet<T>(io:WalletSignInIo<T>):Promise<SignInOutcome<T>>
export function createTokenStore(options:{apiBaseUrl:string;audience:'operator'|'member';storage?:()=>Storage}): {
  read():string|null; save(token:string):void; clear(token:string|null):void
}
// Preserve existing operator storage key `fuda:dash:operator:${apiBaseUrl}`.
// Member key is `fuda:app:member:${apiBaseUrl}`.
export function createSessionGeneration(): {capture():number;invalidate():void;isCurrent(ticket:number):boolean}

// @fuda/ui: controlled copy, uncontrolled native dialog.
export interface ConfirmActionProps {
  label:string; title:string; description:string; cancelLabel:string; confirmLabel:string
  onConfirm():void; class?:string; disabled?:boolean
}
```

- [ ] Add auth tests for successful address/challenge/signature propagation, rejection, network failure, and no verification after wallet cancellation. Add token tests for audience/API isolation, stale-token clear preserving replacement, and blocked storage. Port existing wallet validation tests to shared module and preserve public app/dash behavior.

```ts
operator.save('operator-token')
member.save('member-token')
member.clear('member-token')
expect(operator.read()).toBe('operator-token')
expect(member.read()).toBeNull()
```

- [ ] Run targeted libs tests before implementation; use existing app/dash tests as the extraction baseline.
- [ ] Implement lazy SDK loading with caller chain/paymaster configuration. Extract real signing sequence, token storage and session generation. Keep issuer loading outside shared auth. Update consumers without changing dash's sign-in outcomes or sponsorship path.
- [ ] Extract dash's native dialog into ConfirmAction. Cover cancel/Escape/backdrop/confirmation and focus restoration through real DOM tests. Keep dash and member copy separate.
- [ ] Use root `pnpm install --lockfile-only` for changed workspace dependency ownership; do not upgrade versions. Run libs/UI/dash auth tests and app wallet tests, targeted formatting/lint/types. Save report/diff for independent review.

## Task 3: Member routes, session controller and Dock screens

**Owner:** Member worker after Task 1 interfaces and Task 2 exports are available. **Files:** app `App.tsx`, `route.ts`/tests, `Landing.tsx`, `RightsList.tsx`, `SignedGate.tsx`, `PrivateScreen.tsx`, `Verdict.tsx`, new `member/*` controller/layout/auth/settings/copy, supporting tests; `apps/app/index.html`. Member worker owns `apps/app/src/member.css`, imported by controller-owned `styles.css`.

**Consumes:** Task 1 SDK/routes, Task 2 libs/auth/wallet/ConfirmAction. Existing public read query and entry functions remain their contracts.

- [ ] Add route/controller tests for top/signin/rights/settings paths, no signup, safe return targets, unsigned protected route handling, restoration pending/network/401, old response after sign-out/replacement, and separate A routing. Tests use real rendered controller with API/wallet IO injected at external operations.

```ts
expect(routeFor('http://localhost:5173','/settings','http://localhost:5173')).toBe('settings')
expect(safeMemberReturn('//outside.example/rights')).toBe('/rights')
expect(safeMemberReturn('/rights?uid=0x123')).toBe('/rights?uid=0x123')
```

- [ ] Implement member API client and session controller. Reuse shared authenticated wallet sequence, token store and generations. Session value is verified `{token,address}`. Restore via `/auth/member/me`; reject stale work after logout, token replacement or unmount. Do not persist provider/key objects.
- [ ] Move member-specific screens under `member/` (update tests/imports, avoid compatibility re-export files with no consumer). Top remains wide and public; sign-in centered and without Dock. Base new/returning users share one button/URL. Existing valid session returns to validated path; default `/rights`.
- [ ] Use member Dock with four real links and active state. Internal transitions preserve session and public read scope; popstate and modified clicks work. Add `viewport-fit=cover`; ensure Dock/content safe area and central desktop alignment.
- [ ] Rights screen receives verified Holder as default query, plus local public pass memory. Preserve query recovery and manual address lookup as secondary details. Use real known metadata only; keep unknown UID details subordinate.
- [ ] Signed screen retains protocol with passkey primary and browser wallet alternative. Private screen retains dedicated PRF flow; prioritize existing passkey, explain separate setup, clear private state on departure/unmount. No private keys/results in shared cache or persistence.
- [ ] Settings shows address, shared theme control, and ConfirmAction sign-out. Local clear is immediate even if logout HTTP fails; navigate `/`. Retain public Card/Pass memory and passkey identity. Clear transient member keys and read caches.
- [ ] Use a session-owned public query client supplied to member pages rather than recreating across Dock transitions. Keep direct screen tests possible with local scope fallback where required.
- [ ] Run app route/auth/controller/rights/private tests and build; add mobile DOM assertions for nav exclusion and no duplicate primary action. Save report/diff; no commit, no edits to venue/CardScreen or root docs/styles.

## Task 4: Public venue mobile flow

**Owner:** Controller while member worker owns B. **Files:** move `apps/app/src/CardScreen.tsx` and card-memory helpers under `venue/` as useful; new `venue/VenueLayout.tsx`, `venue.css` imported by app `styles.css`; affected CardScreen tests. Coordinate new CardScreen import path with Task 3 worker.

- [ ] Add view regression tests that every A-state home/back link resolves to `/@handle`, does not link to `/`, renders no member Dock, and shows existing saved-card state without issuance. Preserve zero/one/multiple-card chooser semantics.

```ts
expect([...host.querySelectorAll('a')].some(a=>a.getAttribute('href')==='/')).toBe(false)
expect(host.querySelector('a[href="/@garden-cafe"]')).not.toBeNull()
```

- [ ] Run card-screen tests to establish new navigation expectations fail.
- [ ] Implement public venue layout, a brand-first detail screen with benefit panel and bottom primary action, and an issued Pass/QR/Wallet screen. Use full small-screen width and centered ~28rem desktop width. Include loading, missing/empty/closed/error states with appropriate venue-local exit.
- [ ] Keep actual issuance and persistence unchanged except lifecycle guards required by navigation. Keep one-card/multi-card URLs stable. Do not add sample stamp counts, fake rewards, or unsupported links from the reference.
- [ ] Validate venue colors/logo failure/long content, 44px actions, short viewport scrolling and Wallet fallback. Run card tests/build and save report/diff for review.

## Task 5: Integration, canonical docs and final verification

**Owner:** Controller; independent final reviewer.

- [ ] Review each task against the spec and its diff, resolve load-bearing findings, then run a whole-change review from `e194ac2` excluding unrelated command edits.
- [ ] Update `docs/specs/pass-types-and-flows.md`, `docs/specs/attestation-model.md`, `docs/architecture.md`, and runbook for audience scopes, routes, login/gates, A navigation, Dock, and migration/setup. Remove misleading preexisting comments about app Worker owning the apex when touching them.
- [ ] Run `pnpm check`, `pnpm test`, `pnpm --filter app build`, `pnpm --filter dash build` on final content. Reuse identical final-content build evidence if already recorded.
- [ ] Browser-check A landing/chooser/ready/error and B top/signin/rights/signed/private/settings at 390 and 1280px; check narrow320 and short viewport Dock safe areas, dark theme and modal keyboard behavior. Use synthetic data only for UI fixtures; no live chain writes.
- [ ] Remove completed temporary spec/plan/SDD artifacts after canonical docs reflect shipped behavior. Run `git diff --check`, verify source unchanged after doc-only cleanup, commit verified changes without unrelated edits, and summarize changes/tests/remaining environment prerequisites.

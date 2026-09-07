# Card onboarding implementation plan

Spec: `.superpowers/specs/2026-09-07-card-onboarding-design.md`. Branch
`feat/card-onboarding` in the main checkout. One commit per task; no push.

- [ ] 1. sdk: `handles.ts` (`isIssuerHandle`, `RESERVED_ISSUER_HANDLES`),
      `member-number.ts` (`isMemberNumber`, `generateMemberNumber`,
      `formatMemberNumber`), types for the new responses; api `ens/names.ts`
      re-uses them. Tests.
- [ ] 2. api: migration `0004_issuers.sql`, drizzle mirrors, `PUBLIC_BASE_URL`
      binding (+ `env.dev`, `.dev.vars.example` untouched).
- [ ] 3. api: `/auth/*` routes, `sessions`, `operatorAuth()` middleware. Tests
      on the fake chain with a real EOA signer.
- [ ] 4. api: `/issuers` (create), `/issuers/me`, `/issuers/check`,
      `/issuers/:handle` (public), `/issuers/:handle/issue` (public, rate
      limited, member number, bearer attest, `card_id`). Tests.
- [ ] 5. app: `card` route in `routeFor`, `CardScreen.tsx` (landing → issue →
      ready), api client calls, per-handle issued record, pass memory. Tests.
- [ ] 6. dash: session union, sign-in with passkey (Base Account) + admin
      token, `/new` designer with live preview and handle check, `/published`
      screen with QR/link/share/copy/print, nav, copy en/ja. Tests.
- [ ] 7. passes: branding inputs in `@fuda/pass`, `pass-row` join, web pass
      page colours, Google/Apple fields, Apple `locations`. Tests.
- [ ] 8. docs: specs + runbook; delete spec and plan; final `pnpm check`,
      `pnpm test`, dev smoke on the fake chain.

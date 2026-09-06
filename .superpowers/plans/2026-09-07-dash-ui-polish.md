# Dash UI Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `apps/dash` into a responsive, bilingual, theme-aware operator console while preserving every existing authentication, issue, list, revoke, pass, QR, and Graph behavior.

**Architecture:** Keep the admin token and member resource in the Dash application root, route three page modules through the existing assets-only SPA, and keep all writes behind the existing API helpers. Add deep shared seams for locale persistence (`@fuda/i18n`), visual foundations (`@fuda/styles`), and non-domain appearance controls (`@fuda/ui`); Dash supplies all operator copy and domain behavior.

**Tech Stack:** TypeScript 7, Hono JSX DOM, Vite+, Vitest 4, Tailwind CSS 4, daisyUI 5, pnpm 11, Cloudflare Workers Static Assets.

**Spec:** `.superpowers/specs/2026-09-07-dash-ui-polish-design.md`

## Global Constraints

- Work only in `/home/yuji/.herdr/worktrees/fuda-sh/feat-dash-ui-polish` on `feat/dash-ui-polish`; never merge, delete the branch, remove the worktree, or close its Herdr workspace.
- Author every line from scratch in this repository. The sibling `fuda-sh-staff` tree is conceptual context only; copy no code, specifications, designs, or assets.
- Preserve `GET /members`, `POST /issue`, and `POST /revoke` contracts, the current Graph query helpers, pass URLs, QR payloads, and Bearer/Signed/+Private rules.
- Keep the admin token in Hono component state for the tab lifetime only. Never write it to local storage, session storage, cookies, the URL, or logs.
- Supported locales are exactly `en` and `ja`; the first-visit and invalid-value fallback is `en`, and browser language does not override it.
- Theme modes are exactly `light`, `dark`, and `system`; the unsaved/invalid fallback is `system`, and system mode follows live OS preference changes.
- Only `apps/dash` adopts the new shared package surfaces in this change. Do not modify `apps/app`, `apps/gate`, API behavior, D1, chain code, or Graph query contracts.
- The responsive mode boundary is Tailwind `lg`: 64 rem / 1024 CSS pixels. The UI must remain usable at 320, 768, and at least 1024 CSS pixels without page-level horizontal overflow.
- Keep machine-readable API error identifiers and blockchain values verbatim; localize only their surrounding operator-facing copy.
- Run the repository commands through their documented pnpm entry points. Do not weaken lint rules or add suppressions unless the implementation has a specific, inline reason.
- Use TDD for every behavior change: observe the named failure before implementation, make the smallest passing change, rerun the focused suite, then commit with the English message specified by the task.

## File Map

### New shared package files

- `packages/i18n/package.json` — workspace package manifest and export map.
- `packages/i18n/tsconfig.json` — shared TypeScript configuration.
- `packages/i18n/vite.config.ts` — focused Vitest configuration.
- `packages/i18n/src/index.ts` — locale set, fallback, dictionary type, and `pick`.
- `packages/i18n/src/browser.ts` — guarded browser locale read/write/document adapter.
- `packages/i18n/src/index.test.ts` — locale contract tests.
- `packages/i18n/src/browser.test.ts` — persistence and failure-mode tests.
- `packages/styles/package.json` — CSS-only workspace package manifest.
- `packages/styles/base.css` — semantic light/dark tokens and shared base/focus styles.
- `packages/ui/src/theme.ts` — pure theme selection plus guarded browser adapter.
- `packages/ui/src/theme.test.ts` — mode, persistence, root, and system-listener tests.
- `packages/ui/src/IconButton.tsx` — generic labelled icon-button primitive.
- `packages/ui/src/icon-button.test.tsx` — accessible icon-button contract tests.
- `packages/ui/src/controls.tsx` — stateless language and theme controls.
- `packages/ui/src/controls.test.tsx` — accessible control-markup tests.

### New Dash files

- `apps/dash/src/copy.ts` and `copy.test.ts` — complete English/Japanese operator dictionary.
- `apps/dash/src/router.ts` and `router.test.ts` — three-route parsing and History adapter.
- `apps/dash/src/test/test-view.ts` — shared, test-only Hono VNode inspection helpers.
- `apps/dash/src/DashboardShell.tsx` and `dashboard-shell.test.tsx` — desktop sidebar and mobile modal drawer.
- `apps/dash/src/members-state.ts` and `members-state.test.ts` — explicit resource state, stale snapshots, counts, and API status.
- `apps/dash/src/OverviewPage.tsx` and `overview-page.test.tsx` — counts and configuration cards.
- `apps/dash/src/rights-filter.ts` and `rights-filter.test.ts` — deterministic client-side search/filter behavior.
- `apps/dash/src/RightsList.tsx` and `rights-list.test.tsx` — desktop table and mobile cards.
- `apps/dash/src/single-flight.ts` and `single-flight.test.ts` — synchronous duplicate-action guard.
- `apps/dash/src/RevokeDialog.tsx` and `revoke-dialog.test.tsx` — accessible destructive confirmation.
- `apps/dash/src/RightsPage.tsx` — Rights-page composition and revoke state.
- `apps/dash/src/app-state.ts` and `app-state.test.ts` — pure unauthorized-session transition.
- `apps/dash/src/app-actions.ts` and `app-actions.test.ts` — authenticated issue/revoke, 401, and refresh coordination.
- `apps/dash/src/app-view.test.tsx` — route/page/auth shell composition coverage.

### Existing files modified or removed

- `packages/ui/src/index.ts`, `packages/ui/vite.config.ts` — export and test the new UI modules.
- `apps/dash/package.json`, `pnpm-lock.yaml` — add workspace dependencies and register new packages.
- `apps/dash/index.html`, `src/main.tsx`, `src/styles.css` — pre-render theme application and Dash composition styles.
- `apps/dash/src/App.tsx` — cross-route state and IO orchestration.
- `apps/dash/src/TokenGate.tsx`, `IssueForm.tsx`, `OnChainStatus.tsx`, `QrBlock.tsx` — localized labels and operation states.
- `apps/dash/src/members-view.ts`, `members-view.test.ts` — retain the full holder value for search and confirmation.
- `apps/dash/src/on-chain-status-view.test.tsx` — localized Graph-state assertions.
- `apps/dash/src/MembersTable.tsx` — remove after `RightsList.tsx` replaces it.
- `docs/specs/pass-types-and-flows.md`, `docs/architecture.md` — canonical Dash routes and durable UI behavior.
- `.superpowers/specs/2026-09-07-dash-ui-polish-design.md`, `.superpowers/plans/2026-09-07-dash-ui-polish.md` — remove only after implementation and verification succeed.

## Spec Coverage Map

| Design requirement | Implementation and proof |
| --- | --- |
| Scope preservation and non-goals | Global constraints; Tasks 6–10 regression tests and full gate |
| `packages/i18n`, `packages/styles`, `packages/ui` ownership | Tasks 1–3 |
| Overview, Rights, and Issue routing | Task 4 router/shell; Task 9 composition; Task 10 direct-route smoke |
| Shared member state and write refreshes | Task 5 resource state; Task 9 IO orchestration |
| English-default English/Japanese persistence | Tasks 1 and 3; Tasks 8–10 adoption and reload checks |
| Light/dark/system persistence and live system mode | Task 2 helpers/controls; Tasks 9–10 pre-render application and browser checks |
| Loading, empty, stale, and error behavior | Tasks 5, 7, 8, and 9 |
| Search/filter and responsive table/cards | Task 6; Task 10 viewport checks |
| Confirm-before-revoke and duplicate suppression | Task 7 red/green tests; Task 10 network smoke |
| Existing issue/pass/QR/+Private/Graph behavior | Tasks 6 and 8 regression tests; Tasks 9–10 integration/full suite |
| Responsive and accessible behavior | Tasks 2, 4, 6–9 markup/CSS; Task 10 keyboard and viewport checks |
| Canonical docs and temporary artifact lifecycle | Tasks 10 and 11 |

---

### Task 1: Add the locale contract and guarded browser persistence

**Files:**

- Create: `packages/i18n/package.json`
- Create: `packages/i18n/tsconfig.json`
- Create: `packages/i18n/vite.config.ts`
- Create: `packages/i18n/src/index.ts`
- Create: `packages/i18n/src/browser.ts`
- Test: `packages/i18n/src/index.test.ts`
- Test: `packages/i18n/src/browser.test.ts`
- Modify: `pnpm-lock.yaml`

**Interfaces:**

- Produces: `Locale`, `LOCALES`, `DEFAULT_LOCALE`, `Copy<T>`, `pick<T>()`, `resolveLocale()`, `LocaleEnvironment`, `getLocale()`, and `setLocale()` with the exact declarations below.
- Consumes: browser `localStorage` and `document.documentElement.lang` only through `LocaleEnvironment`; no Dash import is allowed.

- [ ] **Step 1: Create the package shell and failing locale contract tests**

Create a private ESM package named `@fuda/i18n` with exports `.` → `./src/index.ts` and `./browser` → `./src/browser.ts`, a `test` script of `vp test`, exact dev dependency `"vitest": "4.1.11"`, the root tsconfig extension, and a Vite+ test include of `src/**/*.test.ts` in the Node environment. Add these tests before creating the source modules:

```ts
import { describe, expect, it } from 'vitest'

import { DEFAULT_LOCALE, LOCALES, pick, resolveLocale } from './index.ts'

describe('locale contract', () => {
  it('supports English and Japanese with English as the fallback', () => {
    expect(LOCALES).toStrictEqual(['en', 'ja'])
    expect(DEFAULT_LOCALE).toBe('en')
    expect(resolveLocale('ja')).toBe('ja')
    expect(resolveLocale('fr')).toBe('en')
    expect(resolveLocale(null)).toBe('en')
  })

  it('selects the complete dictionary branch', () => {
    expect(pick({ en: { title: 'Rights' }, ja: { title: '権利' } }, 'ja')).toStrictEqual({ title: '権利' })
  })
})
```

- [ ] **Step 2: Run the locale contract test and observe the missing-module failure**

Run: `pnpm --filter @fuda/i18n test -- src/index.test.ts`

Expected: FAIL because `packages/i18n/src/index.ts` does not exist.

- [ ] **Step 3: Implement the locale contract**

Create `src/index.ts` with exactly this public shape and no browser globals:

```ts
export const LOCALES = ['en', 'ja'] as const
export type Locale = (typeof LOCALES)[number]
export const DEFAULT_LOCALE: Locale = 'en'
export const LOCALE_STORAGE_KEY = 'fuda:locale'
export type Copy<T> = Record<Locale, T>

export const isLocale = (value: unknown): value is Locale =>
  typeof value === 'string' && (LOCALES as readonly string[]).includes(value)

export const resolveLocale = (stored: string | null): Locale => (isLocale(stored) ? stored : DEFAULT_LOCALE)

export const pick = <T>(copy: Copy<T>, locale: Locale): T => copy[locale] ?? copy[DEFAULT_LOCALE]
```

- [ ] **Step 4: Add failing browser-adapter tests**

Use an injectable environment and assert all required failure behavior:

```ts
import { describe, expect, it, vi } from 'vitest'

import { getLocale, setLocale } from './browser.ts'
import type { LocaleEnvironment } from './browser.ts'

const environment = (stored: string | null): LocaleEnvironment => ({
  readStored: vi.fn(() => stored),
  setDocumentLanguage: vi.fn(),
  writeStored: vi.fn(),
})

describe('browser locale preference', () => {
  it('reads a valid choice and defaults invalid data to English', () => {
    expect(getLocale(environment('ja'))).toBe('ja')
    expect(getLocale(environment('broken'))).toBe('en')
  })

  it('falls back to English when storage reads throw', () => {
    const env = environment(null)
    env.readStored = () => {
      throw new Error('blocked')
    }
    expect(getLocale(env)).toBe('en')
  })

  it('updates document language even when persistence is blocked', () => {
    const env = environment(null)
    env.writeStored = () => {
      throw new Error('blocked')
    }
    setLocale('ja', env)
    expect(env.setDocumentLanguage).toHaveBeenCalledWith('ja')
  })
})
```

- [ ] **Step 5: Run the adapter test and observe the missing-module failure**

Run: `pnpm --filter @fuda/i18n test -- src/browser.test.ts`

Expected: FAIL because `packages/i18n/src/browser.ts` does not exist.

- [ ] **Step 6: Implement the browser adapter and package exports**

Use this exact interface; keep each side effect independently guarded so a storage write cannot block the root-language update:

```ts
import { DEFAULT_LOCALE, LOCALE_STORAGE_KEY, resolveLocale } from './index.ts'
import type { Locale } from './index.ts'

export interface LocaleEnvironment {
  readStored: () => string | null
  writeStored: (locale: Locale) => void
  setDocumentLanguage: (locale: Locale) => void
}

const browserLocaleEnvironment: LocaleEnvironment = {
  readStored: () => window.localStorage.getItem(LOCALE_STORAGE_KEY),
  writeStored: (locale) => window.localStorage.setItem(LOCALE_STORAGE_KEY, locale),
  setDocumentLanguage: (locale) => {
    document.documentElement.lang = locale
  },
}

export const getLocale = (environment: LocaleEnvironment = browserLocaleEnvironment): Locale => {
  try {
    return resolveLocale(environment.readStored())
  } catch {
    return DEFAULT_LOCALE
  }
}

export const setLocale = (locale: Locale, environment: LocaleEnvironment = browserLocaleEnvironment): void => {
  try {
    environment.writeStored(locale)
  } catch {
    // The active page still changes language when persistence is unavailable.
  }
  environment.setDocumentLanguage(locale)
}
```

- [ ] **Step 7: Update the lockfile and verify the package**

Run: `pnpm install --lockfile-only`

Expected: PASS and add `packages/i18n` to the workspace lockfile without unrelated version changes.

Run: `pnpm --filter @fuda/i18n test`

Expected: PASS for both locale test files.

- [ ] **Step 8: Commit the locale module**

```bash
git add packages/i18n pnpm-lock.yaml
git commit -m "feat: add shared locale preferences"
```

---

### Task 2: Add shared theme foundations and non-domain appearance controls

**Files:**

- Create: `packages/styles/package.json`
- Create: `packages/styles/base.css`
- Create: `packages/ui/src/theme.ts`
- Test: `packages/ui/src/theme.test.ts`
- Create: `packages/ui/src/IconButton.tsx`
- Test: `packages/ui/src/icon-button.test.tsx`
- Create: `packages/ui/src/controls.tsx`
- Test: `packages/ui/src/controls.test.tsx`
- Modify: `packages/ui/src/index.ts`
- Modify: `packages/ui/vite.config.ts`
- Modify: `pnpm-lock.yaml`

**Interfaces:**

- Consumes: the existing Hono JSX DOM runtime in `@fuda/ui`.
- Produces: `ThemeMode`, `THEME_MODES`, `ThemeEnvironment`, `resolveThemeMode()`, `nextThemeMode()`, `readThemeMode()`, `applyThemeMode()`, `saveThemeMode()`, `watchThemeMode()`, `IconButton`, `ThemeToggle`, `ThemeControlLabels`, `LanguageSwitcher`, and `LanguageOption`.

- [ ] **Step 1: Write failing pure theme tests**

```ts
import { describe, expect, it, vi } from 'vitest'

import {
  applyThemeMode,
  nextThemeMode,
  readThemeMode,
  resolveThemeMode,
  saveThemeMode,
  watchThemeMode,
} from './theme.ts'
import type { ThemeEnvironment } from './theme.ts'

const environment = (stored: string | null, dark = false): ThemeEnvironment => ({
  applyRoot: vi.fn(),
  prefersDark: vi.fn(() => dark),
  readStored: vi.fn(() => stored),
  subscribeSystem: vi.fn(() => vi.fn()),
  writeStored: vi.fn(),
})

describe('theme preference', () => {
  it('defaults invalid or absent data to system and cycles light to dark to system', () => {
    expect(resolveThemeMode(null)).toBe('system')
    expect(resolveThemeMode('sepia')).toBe('system')
    expect(nextThemeMode('light')).toBe('dark')
    expect(nextThemeMode('dark')).toBe('system')
    expect(nextThemeMode('system')).toBe('light')
  })

  it('applies the selected mode and resolved dark state', () => {
    const env = environment('system', true)
    applyThemeMode('system', env)
    expect(env.applyRoot).toHaveBeenCalledWith('system', true)
  })

  it('applies even when saving is blocked', () => {
    const env = environment(null)
    env.writeStored = () => {
      throw new Error('blocked')
    }
    saveThemeMode('dark', env)
    expect(env.applyRoot).toHaveBeenCalledWith('dark', true)
  })

  it('subscribes only in system mode and reapplies preference changes', () => {
    const env = environment('system')
    const listener = vi.fn()
    const unsubscribe = vi.fn()
    env.subscribeSystem = vi.fn((next) => {
      listener.mockImplementation(next)
      return unsubscribe
    })
    const stop = watchThemeMode('system', env)
    expect(env.subscribeSystem).toHaveBeenCalledOnce()
    listener()
    expect(env.applyRoot).toHaveBeenCalledWith('system', false)
    stop()
    expect(unsubscribe).toHaveBeenCalledOnce()
    expect(watchThemeMode('dark', env)).toBeTypeOf('function')
  })

  it('reads system when storage access throws', () => {
    const env = environment(null)
    env.readStored = () => {
      throw new Error('blocked')
    }
    expect(readThemeMode(env)).toBe('system')
  })
})
```

- [ ] **Step 2: Run the theme test and observe the missing-module failure**

Run: `pnpm --filter @fuda/ui test -- src/theme.test.ts`

Expected: FAIL because `packages/ui/src/theme.ts` does not exist.

- [ ] **Step 3: Implement the theme seam**

Use these exact declarations and behaviors:

```ts
export const THEME_MODES = ['light', 'dark', 'system'] as const
export type ThemeMode = (typeof THEME_MODES)[number]
export const THEME_STORAGE_KEY = 'fuda:theme'

export interface ThemeEnvironment {
  readStored: () => string | null
  writeStored: (mode: ThemeMode) => void
  prefersDark: () => boolean
  applyRoot: (mode: ThemeMode, dark: boolean) => void
  subscribeSystem: (listener: () => void) => () => void
}

export const resolveThemeMode = (value: unknown): ThemeMode =>
  THEME_MODES.find((mode) => mode === value) ?? 'system'

export const nextThemeMode = (mode: ThemeMode): ThemeMode =>
  THEME_MODES[(THEME_MODES.indexOf(mode) + 1) % THEME_MODES.length] ?? 'system'

const browserThemeEnvironment: ThemeEnvironment = {
  readStored: () => window.localStorage.getItem(THEME_STORAGE_KEY),
  writeStored: (mode) => window.localStorage.setItem(THEME_STORAGE_KEY, mode),
  prefersDark: () => window.matchMedia('(prefers-color-scheme: dark)').matches,
  applyRoot: (mode, dark) => {
    document.documentElement.dataset.themeMode = mode
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
    document.documentElement.classList.toggle('dark', dark)
  },
  subscribeSystem: (listener) => {
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    query.addEventListener('change', listener)
    return () => query.removeEventListener('change', listener)
  },
}

export const readThemeMode = (environment: ThemeEnvironment = browserThemeEnvironment): ThemeMode => {
  try { return resolveThemeMode(environment.readStored()) } catch { return 'system' }
}

export const applyThemeMode = (mode: ThemeMode, environment: ThemeEnvironment = browserThemeEnvironment): void => {
  environment.applyRoot(mode, mode === 'dark' || (mode === 'system' && environment.prefersDark()))
}

export const saveThemeMode = (mode: ThemeMode, environment: ThemeEnvironment = browserThemeEnvironment): void => {
  try { environment.writeStored(mode) } catch { /* Apply the unsaved choice for this page. */ }
  applyThemeMode(mode, environment)
}

export const watchThemeMode = (
  mode: ThemeMode,
  environment: ThemeEnvironment = browserThemeEnvironment,
): (() => void) => mode === 'system'
  ? environment.subscribeSystem(() => applyThemeMode('system', environment))
  : () => undefined
```

Keep the browser adapter private. The public functions expose behavior, not DOM details.

- [ ] **Step 4: Write failing icon-button and appearance-control markup tests**

Create this local VNode walker in the test and assert the public props:

```ts
interface ControlNode { props: Record<string, unknown>; tag: unknown }
const isControlNode = (value: unknown): value is ControlNode =>
  typeof value === 'object' && value !== null && 'props' in value && 'tag' in value
const findControl = (value: unknown, tag: string): ControlNode | undefined => {
  if (Array.isArray(value)) {
    return value.map((child) => findControl(child, tag)).find((child) => child !== undefined)
  }
  if (!isControlNode(value)) return undefined
  return value.tag === tag ? value : findControl(value.props.children, tag)
}

const theme = ThemeToggle({
  labels: { control: 'Theme', dark: 'Dark', light: 'Light', system: 'System' },
  mode: 'system',
  onChange: vi.fn(),
})
expect(findControl(theme, 'button')?.props).toMatchObject({ 'aria-label': 'Theme: System', type: 'button' })

const language = LanguageSwitcher({
  current: 'en',
  label: 'Language',
  onChange: vi.fn(),
  options: [
    { label: 'English', value: 'en' },
    { label: '日本語', value: 'ja' },
  ],
})
expect(findControl(language, 'select')?.props).toMatchObject({ 'aria-label': 'Language', value: 'en' })

const icon = IconButton({ label: 'Close menu', onClick: vi.fn(), children: <span aria-hidden="true">X</span> })
expect(findControl(icon, 'button')?.props).toMatchObject({ 'aria-label': 'Close menu', type: 'button' })
```

- [ ] **Step 5: Run the controls test and observe the missing-module failure**

Run: `pnpm --filter @fuda/ui test -- src/controls.test.tsx`

Expected: FAIL because `packages/ui/src/IconButton.tsx` and `controls.tsx` do not exist and the current Vite include omits TSX tests.

- [ ] **Step 6: Implement stateless controls and public exports**

Create `IconButton.tsx` with this exact generic public prop shape:

```ts
export interface IconButtonProps {
  children: JSX.Element
  label: string
  onClick: () => void
}
```

It renders a native 44 px square button with `type="button"`, the supplied accessible label, and decorative children. Use `IconButton` inside `ThemeToggle`; it must remain domain- and copy-agnostic. Use these exact public control props:

```ts
export interface ThemeControlLabels {
  control: string
  light: string
  dark: string
  system: string
}

export interface ThemeToggleProps {
  labels: ThemeControlLabels
  mode: ThemeMode
  onChange: (mode: ThemeMode) => void
}

export interface LanguageOption {
  label: string
  value: string
}

export interface LanguageSwitcherProps {
  current: string
  label: string
  options: readonly LanguageOption[]
  onChange: (value: string) => void
}
```

`ThemeToggle` shows a CSS/icon glyph for the current mode with `aria-hidden="true"`, names itself `<control>: <current localized mode>`, and invokes `onChange(nextThemeMode(mode))`. `LanguageSwitcher` is a labelled native select with 44 px minimum block size; it passes only `event.currentTarget.value`. Export all three components and their types from `packages/ui/src/index.ts`. Change the UI Vitest include to `src/**/*.test.{ts,tsx}`.

- [ ] **Step 7: Add the shared CSS-only package**

Create a private ESM package named `@fuda/styles` with the sole export `"./base.css": "./base.css"` and no runtime dependencies. Its CSS must define the dark variant and semantic tokens without any Dash selector:

```css
@custom-variant dark (&:where(.dark, .dark *));

:root {
  color-scheme: light;
  font-family: ui-sans-serif, system-ui, sans-serif;
  --fuda-font-mono: ui-monospace, monospace;
  --fuda-space-1: 0.25rem;
  --fuda-space-2: 0.5rem;
  --fuda-space-3: 0.75rem;
  --fuda-space-4: 1rem;
  --fuda-bg: #f6f5f2;
  --fuda-surface: #ffffff;
  --fuda-text: #20211f;
  --fuda-muted: #666963;
  --fuda-border: #d9dbd5;
  --fuda-accent: #315f4c;
  --fuda-danger: #a53d35;
  --fuda-focus: #356fda;
}

:root.dark {
  color-scheme: dark;
  --fuda-bg: #171916;
  --fuda-surface: #222520;
  --fuda-text: #f2f3ee;
  --fuda-muted: #b6bab1;
  --fuda-border: #3c4039;
  --fuda-accent: #91c5ad;
  --fuda-danger: #ef8f86;
  --fuda-focus: #8db4ff;
}

@layer base {
  body { background: var(--fuda-bg); color: var(--fuda-text); }
  :focus-visible { outline: 3px solid var(--fuda-focus); outline-offset: 2px; }
}

@layer components {
  .fuda-icon-button {
    align-items: center; display: inline-flex; justify-content: center;
    min-block-size: 44px; min-inline-size: 44px;
  }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { scroll-behavior: auto !important; transition-duration: 0.01ms !important; }
}
```

Keep values semantic; Dash-specific layout and status styles stay in the app stylesheet.

- [ ] **Step 8: Refresh dependencies and verify UI tests**

Run: `pnpm install --lockfile-only`

Expected: PASS and register `packages/styles` without unrelated dependency drift.

Run: `pnpm --filter @fuda/ui test`

Expected: PASS, including existing fetch/short/barcode tests and both new files.

- [ ] **Step 9: Commit the shared appearance foundation**

```bash
git add packages/styles packages/ui pnpm-lock.yaml
git commit -m "feat: add shared appearance controls"
```

---

### Task 3: Add complete English and Japanese Dash copy

**Files:**

- Create: `apps/dash/src/copy.ts`
- Test: `apps/dash/src/copy.test.ts`
- Modify: `apps/dash/package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**

- Consumes: `Copy<T>` and `Locale` from `@fuda/i18n`.
- Produces: `DashCopy` and `DASH_COPY: Copy<DashCopy>`; later tasks receive a selected `DashCopy`, never a locale string plus ad hoc literals.

- [ ] **Step 1: Add the workspace dependency and failing dictionary test**

Add `"@fuda/i18n": "workspace:*"` to Dash dependencies. Test both branches and the operator-critical labels:

```ts
import { pick } from '@fuda/i18n'
import { describe, expect, it } from 'vitest'

import { DASH_COPY } from './copy.ts'

describe('Dash copy', () => {
  it('defaults callers to the complete English branch', () => {
    const copy = pick(DASH_COPY, 'en')
    expect(copy.nav).toStrictEqual({ issue: 'Issue', overview: 'Overview', rights: 'Rights' })
    expect(copy.auth.tokenLabel).toBe('Admin token')
    expect(copy.revoke.confirm).toBe('Revoke right')
  })

  it('contains Japanese operator copy for every typed field', () => {
    const copy = pick(DASH_COPY, 'ja')
    expect(copy.nav).toStrictEqual({ issue: '発行', overview: '概要', rights: '権利' })
    expect(copy.auth.tokenLabel).toBe('管理トークン')
    expect(copy.revoke.confirm).toBe('権利を取り消す')
  })
})
```

- [ ] **Step 2: Run the copy test and observe the missing-module failure**

Run: `pnpm --filter dash test -- src/copy.test.ts`

Expected: FAIL because `apps/dash/src/copy.ts` does not exist.

- [ ] **Step 3: Define the exact dictionary shape**

Create nested sections with these fields:

```ts
export interface DashCopy {
  chrome: {
    brand: string; subtitle: string; navigation: string; openMenu: string; closeMenu: string
    language: string; english: string; japanese: string
    theme: { control: string; light: string; dark: string; system: string }
  }
  nav: { overview: string; rights: string; issue: string }
  auth: {
    title: string; description: string; tokenLabel: string; tokenPlaceholder: string
    continue: string; unauthorized: string
  }
  overview: {
    title: string; description: string; total: string; active: string; revoked: string
    api: string; graph: string; checking: string; connected: string; unavailable: string
    configured: string; notConfigured: string; refreshing: string; stale: string
  }
  rights: {
    title: string; description: string; searchLabel: string; searchPlaceholder: string
    statusFilter: string; levelFilter: string; all: string; active: string; revoked: string
    bearer: string; signed: string; private: string; member: string; holder: string
    level: string; tier: string; status: string; uid: string; passes: string
    web: string; google: string; apple: string; qr: string; hideQr: string; revoke: string
    empty: string; noMatches: string; clearFilters: string; refreshing: string; qrLabel: string
  }
  revoke: {
    title: string; description: string; memberFallback: string; cancel: string
    confirm: string; revoking: string; errorPrefix: string
  }
  issue: {
    title: string; description: string; levelLabel: string; bearerDescription: string
    signedDescription: string; privateDescription: string; memberId: string
    memberIdOptional: string; holder: string; stealthMetaAddress: string; tier: string
    usageModel: string; submit: string; submitting: string; errorPrefix: string
    issued: string; announced: string; memberDiscovers: string; transaction: string
    openPass: string; qrLabel: string
  }
  chain: {
    title: string; description: string; holderLabel: string; holderPlaceholder: string
    query: string; querying: string; idle: string; loading: string; unconfigured: string
    errorFallback: string; empty: string; statusHeading: string; active: string
    revokedAt: string; holder: string; unresolvedDelegation: string; delegation: string
    delegations: string; enteredAt: string; inactive: string
  }
}
```

- [ ] **Step 4: Populate every field with fixed copy**

Use the following values exactly; the `satisfies Copy<DashCopy>` declaration makes omissions or extra keys fail type checking:

| Path | English | Japanese |
| --- | --- | --- |
| `chrome.brand` | fuda dash | fuda ダッシュ |
| `chrome.subtitle` | Operator console | 運営コンソール |
| `chrome.navigation` | Dashboard navigation | ダッシュボードナビゲーション |
| `chrome.openMenu` / `closeMenu` | Open menu / Close menu | メニューを開く / メニューを閉じる |
| `chrome.language` | Language | 言語 |
| `chrome.english` / `japanese` | English / 日本語 | English / 日本語 |
| `chrome.theme.control` | Theme | テーマ |
| `chrome.theme.light` / `dark` / `system` | Light / Dark / System | ライト / ダーク / システム |
| `nav.overview` / `rights` / `issue` | Overview / Rights / Issue | 概要 / 権利 / 発行 |
| `auth.title` | Open the operator console | 運営コンソールを開く |
| `auth.description` | Enter the admin token. It stays in this tab's memory only. Leave it empty only for a local API without ADMIN_TOKEN. | 管理トークンを入力してください。トークンはこのタブのメモリにのみ保持されます。ADMIN_TOKEN を設定していないローカル API でのみ空欄にできます。 |
| `auth.tokenLabel` / `tokenPlaceholder` | Admin token / ADMIN_TOKEN | 管理トークン / ADMIN_TOKEN |
| `auth.continue` | Continue | 続ける |
| `auth.unauthorized` | Unauthorized. Check the admin token. | 認証できませんでした。管理トークンを確認してください。 |
| `overview.title` | Overview | 概要 |
| `overview.description` | Current operational rights and client configuration. | 現在の運用中の権利とクライアント設定です。 |
| `overview.total` / `active` / `revoked` | Total rights / Active rights / Revoked rights | 権利の合計 / 有効な権利 / 取り消した権利 |
| `overview.api` / `graph` | API / Graph index | API / Graph インデックス |
| `overview.checking` / `connected` / `unavailable` | Checking / Connected / Unavailable | 確認中 / 接続済み / 利用不可 |
| `overview.configured` / `notConfigured` | Configured / Not configured | 設定済み / 未設定 |
| `overview.refreshing` / `stale` | Refreshing rights / Showing last loaded values | 権利を更新中 / 最後に読み込んだ値を表示中 |
| `rights.title` | Rights | 権利 |
| `rights.description` | Search, inspect, share, and revoke issued rights. | 発行した権利の検索、確認、共有、取り消しを行います。 |
| `rights.searchLabel` / `searchPlaceholder` | Search rights / Member, holder, or UID | 権利を検索 / メンバー、保有者、または UID |
| `rights.statusFilter` / `levelFilter` | Filter by status / Filter by level | ステータスで絞り込む / レベルで絞り込む |
| `rights.all` / `active` / `revoked` | All / Active / Revoked | すべて / 有効 / 取り消し済み |
| `rights.bearer` / `signed` / `private` | Bearer / Signed / +Private | Bearer / Signed / +Private |
| `rights.member` / `holder` / `level` / `tier` | Member / Holder / Level / Tier | メンバー / 保有者 / レベル / ティア |
| `rights.status` / `uid` / `passes` | Status / UID / Passes | ステータス / UID / パス |
| `rights.web` / `google` / `apple` | Web / Google / Apple | Web / Google / Apple |
| `rights.qr` / `hideQr` / `revoke` | Show QR / Hide QR / Revoke | QR を表示 / QR を隠す / 取り消す |
| `rights.empty` | No rights have been issued. | 発行済みの権利はありません。 |
| `rights.noMatches` / `clearFilters` | No rights match these filters. / Clear filters | 条件に一致する権利はありません。 / 絞り込みを解除 |
| `rights.refreshing` / `qrLabel` | Refreshing rights / Right identifier QR | 権利を更新中 / 権利識別子の QR |
| `revoke.title` | Revoke this right? | この権利を取り消しますか？ |
| `revoke.description` | The right will stop passing verification. Confirm the exact member and UID. | この権利は検証を通過できなくなります。メンバーと UID を確認してください。 |
| `revoke.memberFallback` | No member ID | メンバー ID なし |
| `revoke.cancel` / `confirm` / `revoking` | Cancel / Revoke right / Revoking | キャンセル / 権利を取り消す / 取り消し中 |
| `revoke.errorPrefix` | Revoke failed | 取り消しに失敗しました |
| `issue.title` / `description` | Issue a right / Create a Bearer, Signed, or +Private right. | 権利を発行 / Bearer、Signed、または +Private の権利を作成します。 |
| `issue.levelLabel` | Right level | 権利レベル |
| `issue.bearerDescription` | Bearer — device wallet pass, no app | Bearer — アプリ不要のデバイスウォレットパス |
| `issue.signedDescription` | Signed — the member's wallet signs at the gate | Signed — ゲートでメンバーのウォレットが署名 |
| `issue.privateDescription` | +Private — stealth address from a meta-address | +Private — メタアドレスからステルスアドレスを生成 |
| `issue.memberId` / `memberIdOptional` | Member ID / Member ID (optional representative ID) | メンバー ID / メンバー ID（任意の代表 ID） |
| `issue.holder` / `stealthMetaAddress` | Holder address / Stealth meta-address | 保有者アドレス / ステルスメタアドレス |
| `issue.tier` / `usageModel` | Tier / Usage model | ティア / 利用モデル |
| `issue.submit` / `submitting` | Issue right / Issuing | 権利を発行 / 発行中 |
| `issue.errorPrefix` | Issue failed | 発行に失敗しました |
| `issue.issued` | Issued | 発行しました |
| `issue.announced` / `memberDiscovers` | Announced / The member discovers it in their app. | アナウンスしました / メンバーがアプリで検出します。 |
| `issue.transaction` / `openPass` / `qrLabel` | Transaction / Open browser pass / Issued right QR | トランザクション / ブラウザパスを開く / 発行した権利の QR |
| `chain.title` / `description` | On-chain status / Query chain-indexed rights independently of the D1 member list. | オンチェーンステータス / D1 メンバー一覧とは独立して、チェーンに索引された権利を検索します。 |
| `chain.holderLabel` / `holderPlaceholder` | Holder address / 0x… holder address | 保有者アドレス / 0x… 保有者アドレス |
| `chain.query` / `querying` | Query / Querying | 検索 / 検索中 |
| `chain.idle` / `loading` | Enter a holder to look up its on-chain status. / Loading on-chain status. | 保有者を入力してオンチェーンステータスを検索してください。 / オンチェーンステータスを読み込み中です。 |
| `chain.unconfigured` / `errorFallback` | On-chain status is not configured. / Chain lookup failed. | オンチェーンステータスが設定されていません。 / チェーン検索に失敗しました。 |
| `chain.empty` / `statusHeading` | No on-chain rights found. / On-chain rights | オンチェーン権利が見つかりません。 / オンチェーン権利 |
| `chain.active` / `inactive` | ACTIVE / INACTIVE | 有効 / 無効 |
| `chain.revokedAt` / `holder` | REVOKED at / Holder | 取り消し日時 / 保有者 |
| `chain.unresolvedDelegation` / `delegation` | Unresolved delegation / Delegation | 未解決の委任 / 委任 |
| `chain.delegations` / `enteredAt` | Issuer delegations / Entered at | 発行者の委任 / 入場日時 |

- [ ] **Step 5: Refresh the lockfile and verify copy**

Run: `pnpm install --lockfile-only`

Expected: PASS with Dash linked to `@fuda/i18n`.

Run: `pnpm --filter dash test -- src/copy.test.ts`

Expected: PASS for both locales.

Run: `pnpm typecheck`

Expected: PASS, proving both dictionary branches satisfy `DashCopy`.

- [ ] **Step 6: Commit the bilingual copy contract**

```bash
git add apps/dash/package.json apps/dash/src/copy.ts apps/dash/src/copy.test.ts pnpm-lock.yaml
git commit -m "feat: add bilingual dash copy"
```

---

### Task 4: Add URL routing and the responsive authenticated shell

**Files:**

- Create: `apps/dash/src/router.ts`
- Test: `apps/dash/src/router.test.ts`
- Create: `apps/dash/src/test/test-view.ts`
- Create: `apps/dash/src/DashboardShell.tsx`
- Test: `apps/dash/src/dashboard-shell.test.tsx`

**Interfaces:**

- Consumes: `DashCopy`, `Locale`, `ThemeMode`, `LanguageSwitcher`, and `ThemeToggle`.
- Produces: `DashRoute`, `DASH_ROUTES`, `routeFromPath()`, `canonicalPath()`, `navigateTo()`, `subscribeToRoute()`, shared VNode test helpers, and `DashboardShell`.

- [ ] **Step 1: Write failing route tests**

```ts
import { describe, expect, it, vi } from 'vitest'

import { canonicalPath, navigateTo, routeFromPath, subscribeToRoute } from './router.ts'

describe('Dash router', () => {
  it('recognizes routes and normalizes trailing and unknown paths', () => {
    expect(routeFromPath('/')).toBe('/')
    expect(routeFromPath('/rights/')).toBe('/rights')
    expect(routeFromPath('/issue?from=overview')).toBe('/issue')
    expect(routeFromPath('/unknown')).toBe('/')
    expect(canonicalPath('/unknown')).toBe('/')
  })

  it('pushes a selected route and reports browser navigation', () => {
    const pushState = vi.fn()
    navigateTo({ pushState }, '/rights')
    expect(pushState).toHaveBeenCalledWith(null, '', '/rights')

    let listener: (() => void) | undefined
    const onRoute = vi.fn()
    const unsubscribe = subscribeToRoute(
      {
        addEventListener: (_type, next) => { listener = next },
        pathname: () => '/issue',
        removeEventListener: vi.fn(),
      },
      onRoute,
    )
    listener?.()
    expect(onRoute).toHaveBeenCalledWith('/issue')
    unsubscribe()
  })
})
```

- [ ] **Step 2: Run the router test and observe the missing-module failure**

Run: `pnpm --filter dash test -- src/router.test.ts`

Expected: FAIL because `apps/dash/src/router.ts` does not exist.

- [ ] **Step 3: Implement the route interface**

```ts
export const DASH_ROUTES = ['/', '/rights', '/issue'] as const
export type DashRoute = (typeof DASH_ROUTES)[number]

export interface PushHistory { pushState: (data: null, unused: string, url: string) => void }
export interface RouteEvents {
  pathname: () => string
  addEventListener: (type: 'popstate', listener: () => void) => void
  removeEventListener: (type: 'popstate', listener: () => void) => void
}

export const routeFromPath = (pathname: string): DashRoute => {
  const raw = pathname.split(/[?#]/u, 1)[0] || '/'
  const normalized = raw.length > 1 ? raw.replace(/\/+$/u, '') : raw
  return (DASH_ROUTES as readonly string[]).includes(normalized) ? (normalized as DashRoute) : '/'
}

export const canonicalPath = (pathname: string): DashRoute => routeFromPath(pathname)
export const navigateTo = (history: PushHistory, route: DashRoute): void => history.pushState(null, '', route)
export const subscribeToRoute = (events: RouteEvents, onRoute: (route: DashRoute) => void): (() => void) => {
  const listener = (): void => onRoute(routeFromPath(events.pathname()))
  events.addEventListener('popstate', listener)
  return () => events.removeEventListener('popstate', listener)
}
```

App will use `history.replaceState(null, '', canonicalPath(location.pathname))` once on mount when the pathname is not canonical.

- [ ] **Step 4: Write the failing shell structure test**

First create `src/test/test-view.ts` with the exact test-only interface below. `walkView` recursively follows arrays and `props.children`; `findViewNodes` filters the result by `tag`; `viewText` concatenates string, number, and bigint children. Tests use `viewProps(node)` rather than unsafe inline casts. Keeping it below a `test/` directory applies the repository's test-fixture lint latitude without adding it to Vitest's test-file include.

```ts
export interface ViewNode {
  props: Record<string, unknown>
  tag: unknown
}

export const isViewNode = (value: unknown): value is ViewNode =>
  typeof value === 'object' && value !== null && 'props' in value && 'tag' in value

export const walkView = (value: unknown): ViewNode[] => {
  if (Array.isArray(value)) return value.flatMap(walkView)
  if (!isViewNode(value)) return []
  return [value, ...walkView(value.props.children)]
}

export const findViewNodes = (value: unknown, tag: unknown): ViewNode[] =>
  walkView(value).filter((node) => node.tag === tag)

export const viewProps = (node: ViewNode): Record<string, unknown> => node.props

export const viewText = (value: unknown): string => {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint') return String(value)
  if (Array.isArray(value)) return value.map(viewText).join(' ')
  return isViewNode(value) ? viewText(value.props.children) : ''
}
```

Render the pure shell VNode with Overview selected and assert two labelled navigation landmarks (desktop and drawer), three unique target paths in each, `aria-current="page"` on Overview, a named mobile open button, and appearance controls in the shell. Assert `/rights` marks Rights instead when passed as `route`.

```ts
const shell = DashboardShell({
  appearance: <div data-testid="appearance" />,
  children: <section>page</section>,
  copy: pick(DASH_COPY, 'en'),
  onNavigate: vi.fn(),
  route: '/',
})
expect(findViewNodes(shell, 'nav')).toHaveLength(2)
expect(walkView(shell).filter((node) => viewProps(node)['aria-current'] === 'page').map(viewText))
  .toContain('Overview')
expect(walkView(shell).some((node) => viewProps(node)['aria-label'] === 'Open menu')).toBe(true)
```

- [ ] **Step 5: Run the shell test and observe the missing-module failure**

Run: `pnpm --filter dash test -- src/dashboard-shell.test.tsx`

Expected: FAIL because `apps/dash/src/DashboardShell.tsx` does not exist.

- [ ] **Step 6: Implement the shell**

Use this exact public interface:

```ts
export interface DashboardShellProps {
  appearance: JSX.Element
  children: JSX.Element
  copy: DashCopy
  onNavigate: (route: DashRoute) => void
  route: DashRoute
}
```

Render a persistent `<aside>` only visible at `lg`, and a mobile header plus native `<dialog>` drawer only visible below `lg`. Both use the same local nav item definition for `/`, `/rights`, and `/issue`. The mobile open button calls `showModal()`. The close button, dialog `cancel`, backdrop click, and any navigation selection close it. Call `onNavigate` only after closing. Native modal behavior supplies focus containment/background inertness; retain the opener ref and focus it after close. Use native links with real `href` values, prevent default only for unmodified primary-button navigation, and leave modified clicks available to open a new tab. Add `aria-current="page"` only to the selected link.

- [ ] **Step 7: Verify router and shell**

Run: `pnpm --filter dash test -- src/router.test.ts src/dashboard-shell.test.tsx`

Expected: PASS for route normalization, History calls, both navigation modes, and shell semantics.

- [ ] **Step 8: Commit routing and shell behavior**

```bash
git add apps/dash/src/router.ts apps/dash/src/router.test.ts apps/dash/src/test/test-view.ts apps/dash/src/DashboardShell.tsx apps/dash/src/dashboard-shell.test.tsx
git commit -m "feat: add dash routes and responsive shell"
```

---

### Task 5: Model member loading and build Overview

**Files:**

- Create: `apps/dash/src/members-state.ts`
- Test: `apps/dash/src/members-state.test.ts`
- Create: `apps/dash/src/OverviewPage.tsx`
- Test: `apps/dash/src/overview-page.test.tsx`

**Interfaces:**

- Consumes: `MemberRowView`, `DashCopy['overview']`, `API_BASE_URL`, and `GRAPH_RIGHTS_ENDPOINT`.
- Produces: `MembersState`, `MemberCounts`, `MemberSnapshot`, `beginMembersLoad()`, `completeMembersLoad()`, `failMembersLoad()`, `memberSnapshot()`, `countMembers()`, `apiConnectionStatus()`, `graphIsConfigured()`, and `OverviewPage`.

- [ ] **Step 1: Write failing member-resource tests**

Use three minimal `MemberRowView` fixtures (two active and one revoked) and assert:

```ts
expect(countMembers(rows)).toStrictEqual({ active: 2, revoked: 1, total: 3 })
expect(beginMembersLoad({ kind: 'idle' })).toStrictEqual({ kind: 'loading', previousRows: null })
expect(memberSnapshot(completeMembersLoad(rows))).toStrictEqual({ refreshing: false, rows, stale: false })

const refreshing = beginMembersLoad(completeMembersLoad(rows))
expect(memberSnapshot(refreshing)).toStrictEqual({ refreshing: true, rows, stale: false })
expect(memberSnapshot(failMembersLoad(refreshing, 'fetch failed'))).toStrictEqual({
  refreshing: false,
  rows,
  stale: true,
})
expect(memberSnapshot(failMembersLoad({ kind: 'idle' }, 'fetch failed'))).toBeNull()
expect(apiConnectionStatus({ kind: 'idle' })).toBe('checking')
expect(apiConnectionStatus(completeMembersLoad(rows))).toBe('connected')
expect(apiConnectionStatus({ kind: 'error', message: 'down', previousRows: null })).toBe('unavailable')
expect(graphIsConfigured('')).toBe(false)
```

- [ ] **Step 2: Run the state test and observe the missing-module failure**

Run: `pnpm --filter dash test -- src/members-state.test.ts`

Expected: FAIL because `apps/dash/src/members-state.ts` does not exist.

- [ ] **Step 3: Implement the resource state exactly**

```ts
export type MembersState =
  | { kind: 'idle' }
  | { kind: 'loading'; previousRows: readonly MemberRowView[] | null }
  | { kind: 'ready'; rows: readonly MemberRowView[] }
  | { kind: 'error'; message: string; previousRows: readonly MemberRowView[] | null }

export interface MemberCounts { active: number; revoked: number; total: number }
export interface MemberSnapshot {
  refreshing: boolean
  rows: readonly MemberRowView[]
  stale: boolean
}

export type ApiConnectionStatus = 'checking' | 'connected' | 'unavailable'
```

`beginMembersLoad` carries rows from `ready`, `error.previousRows`, or `loading.previousRows`; `completeMembersLoad` returns `ready`; `failMembersLoad` preserves the latest available rows. `memberSnapshot` returns `null` for idle/initial loading/initial error, returns `refreshing: true` for loading with rows, returns `stale: true` only for an error with rows, and otherwise returns ready rows. `countMembers` counts only exact `active`/`revoked` values. API state is checking for idle/loading, connected for ready, unavailable for error. `graphIsConfigured(endpoint)` is `endpoint.trim() !== ''`.

- [ ] **Step 4: Write the failing Overview view test**

Import `viewText` from `test-view.ts`, select `const copy = pick(DASH_COPY, 'en').overview`, and reuse a local three-row fixture matching Step 1. Define the states and assert these exact visible states:

```ts
const ready = completeMembersLoad(rows)
const initialError: MembersState = { kind: 'error', message: 'fetch failed', previousRows: null }
const staleError: MembersState = { kind: 'error', message: 'fetch failed', previousRows: rows }

expect(viewText(OverviewPage({ apiBaseUrl: 'https://api.fuda.sh', copy, graphEndpoint: '', state: ready })))
  .toContain('Total rights 3 Active rights 2 Revoked rights 1')
expect(viewText(OverviewPage({ apiBaseUrl: 'https://api.fuda.sh', copy, graphEndpoint: '', state: ready })))
  .toContain('API Connected https://api.fuda.sh Graph index Not configured')
expect(viewText(OverviewPage({ apiBaseUrl: 'x', copy, graphEndpoint: 'https://graph.example', state: initialError })))
  .not.toContain('Total rights 0')
expect(viewText(OverviewPage({ apiBaseUrl: 'x', copy, graphEndpoint: '', state: staleError })))
  .toContain('Showing last loaded values')
```

- [ ] **Step 5: Run the view test and observe the missing-module failure**

Run: `pnpm --filter dash test -- src/overview-page.test.tsx`

Expected: FAIL because `apps/dash/src/OverviewPage.tsx` does not exist.

- [ ] **Step 6: Implement Overview from the resource only**

Use the exact props below. Render skeleton values with `aria-hidden="true"` and a polite live status during initial loading. Render no numeric value for an initial error. Render zero only for `ready([])`. Add explicit refresh/stale text beside retained counts. Label Graph only as configured/not configured, never connected.

```ts
export interface OverviewPageProps {
  apiBaseUrl: string
  copy: DashCopy['overview']
  graphEndpoint: string
  state: MembersState
}
```

- [ ] **Step 7: Verify Overview**

Run: `pnpm --filter dash test -- src/members-state.test.ts src/overview-page.test.tsx`

Expected: PASS for all initial, ready-empty, ready-populated, refreshing, and stale-error cases.

- [ ] **Step 8: Commit the member resource and Overview**

```bash
git add apps/dash/src/members-state.ts apps/dash/src/members-state.test.ts apps/dash/src/OverviewPage.tsx apps/dash/src/overview-page.test.tsx
git commit -m "feat: add dash overview states"
```

---

### Task 6: Add Rights search, filters, and responsive records

**Files:**

- Modify: `apps/dash/src/members-view.ts`
- Modify: `apps/dash/src/members-view.test.ts`
- Create: `apps/dash/src/rights-filter.ts`
- Test: `apps/dash/src/rights-filter.test.ts`
- Create: `apps/dash/src/RightsList.tsx`
- Test: `apps/dash/src/rights-list.test.tsx`
- Delete: `apps/dash/src/MembersTable.tsx`

**Interfaces:**

- Consumes: current `MemberRow` values, existing `passUrls()`, `toQr()`, `short()`, `QrBlock`, and `DashCopy['rights']`.
- Produces: `MemberRowView.holder`, `RightsFilters`, filter union types, `DEFAULT_RIGHTS_FILTERS`, `filterRights()`, `hasRightsFilters()`, and `RightsList`.

- [ ] **Step 1: Extend the member-view test first**

Add assertions that public rows retain `holder: HOLDER`, while a +Private row retains `holder: null`. Keep every existing short-holder, tier, pass-link, and QR assertion.

Run: `pnpm --filter dash test -- src/members-view.test.ts`

Expected: FAIL because `MemberRowView` does not yet expose `holder`.

- [ ] **Step 2: Add the full holder to the view model**

```ts
export interface MemberRowView {
  uid: Hex
  memberId: string
  holder: Hex | null
  holderShort: string | null
  level: Level
  tier: string
  status: 'active' | 'revoked'
  qr: string
  passUrls: PassUrls | null
}
```

Set `holder: row.holder` in `memberRowView`; do not change any other derivation.

- [ ] **Step 3: Write failing filter tests**

```ts
expect(filterRights(rows, { level: 'all', query: 'ALICE', status: 'all' }).map(({ memberId }) => memberId))
  .toStrictEqual(['alice'])
expect(filterRights(rows, { level: 'all', query: HOLDER.toUpperCase(), status: 'all' })).toHaveLength(1)
expect(filterRights(rows, { level: 'all', query: UID.slice(12, 28), status: 'all' })).toHaveLength(1)
expect(filterRights(rows, { level: 'private', query: '', status: 'active' }).map(({ level }) => level))
  .toStrictEqual(['private'])
expect(hasRightsFilters(DEFAULT_RIGHTS_FILTERS)).toBe(false)
expect(hasRightsFilters({ ...DEFAULT_RIGHTS_FILTERS, status: 'revoked' })).toBe(true)
```

- [ ] **Step 4: Run filter tests and observe the missing-module failure**

Run: `pnpm --filter dash test -- src/rights-filter.test.ts`

Expected: FAIL because `apps/dash/src/rights-filter.ts` does not exist.

- [ ] **Step 5: Implement deterministic AND filtering**

```ts
export type RightStatusFilter = 'all' | MemberRowView['status']
export type RightLevelFilter = 'all' | MemberRowView['level']
export interface RightsFilters { level: RightLevelFilter; query: string; status: RightStatusFilter }
export const DEFAULT_RIGHTS_FILTERS: RightsFilters = { level: 'all', query: '', status: 'all' }

export const filterRights = (rows: readonly MemberRowView[], filters: RightsFilters): MemberRowView[] => {
  const query = filters.query.trim().toLocaleLowerCase('en-US')
  return rows.filter((row) => {
    const statusMatches = filters.status === 'all' || row.status === filters.status
    const levelMatches = filters.level === 'all' || row.level === filters.level
    const queryMatches = query === '' || [row.memberId, row.holder ?? '', row.uid]
      .some((value) => value.toLocaleLowerCase('en-US').includes(query))
    return statusMatches && levelMatches && queryMatches
  })
}

export const hasRightsFilters = (filters: RightsFilters): boolean =>
  filters.query.trim() !== '' || filters.status !== 'all' || filters.level !== 'all'
```

- [ ] **Step 6: Write failing responsive-record view tests**

Render an active Bearer, revoked Signed, and +Private row. Assert that both the desktop table container and mobile card list exist; web/Google/Apple links exist for public rows; the +Private record contains no pass links or holder; every row/card exposes the full UID through accessible text/title while showing a shortened visual form; QR buttons have expanded state; and revoked actions are disabled.

Use these exact props:

```ts
export interface RightsListProps {
  copy: DashCopy['rights']
  openQr: string | null
  onRequestRevoke: (row: MemberRowView) => void
  onToggleQr: (uid: string) => void
  revokingUid: string | null
  rows: readonly MemberRowView[]
}
```

- [ ] **Step 7: Run the view test and observe the missing-module failure**

Run: `pnpm --filter dash test -- src/rights-list.test.tsx`

Expected: FAIL because `apps/dash/src/RightsList.tsx` does not exist.

- [ ] **Step 8: Implement one data source with two intentional layouts**

Render a `rights-table` wrapper visible only at `lg` and a `rights-cards` list hidden at `lg`. Factor pass links, QR disclosure, status text/badge, and actions into private render helpers so both layouts use identical rules. Use `copy` for every label. Pass `copy.qrLabel` to `QrBlock`. Disable revoke when `row.status === 'revoked' || revokingUid === row.uid`. Toggle labels between `copy.qr` and `copy.hideQr`; add `aria-expanded` and a stable `aria-controls` ID. For +Private, render a textual em dash for holder and passes and never render an anchor.

Remove `MembersTable.tsx` only after no import references it.

- [ ] **Step 9: Verify Rights data presentation**

Run: `pnpm --filter dash test -- src/members-view.test.ts src/rights-filter.test.ts src/rights-list.test.tsx`

Expected: PASS, including current pass/QR/+Private regression coverage.

- [ ] **Step 10: Commit Rights filtering and views**

```bash
git add apps/dash/src/members-view.ts apps/dash/src/members-view.test.ts apps/dash/src/rights-filter.ts apps/dash/src/rights-filter.test.ts apps/dash/src/RightsList.tsx apps/dash/src/rights-list.test.tsx apps/dash/src/MembersTable.tsx
git commit -m "feat: add searchable responsive rights"
```

---

### Task 7: Add single-flight revoke confirmation and Rights-page composition

**Files:**

- Create: `apps/dash/src/single-flight.ts`
- Test: `apps/dash/src/single-flight.test.ts`
- Create: `apps/dash/src/RevokeDialog.tsx`
- Test: `apps/dash/src/revoke-dialog.test.tsx`
- Create: `apps/dash/src/RightsPage.tsx`

**Interfaces:**

- Consumes: `MembersState`, `memberSnapshot()`, `filterRights()`, `RightsList`, `OnChainStatus`, `Result<RevokeResponse>`, `DashCopy`, and the full `MemberRowView`.
- Produces: `SingleFlight<Key>`, `createSingleFlight<Key>()`, `RevokeDialog`, and `RightsPage`.

- [ ] **Step 1: Write the failing synchronous duplicate-guard test**

```ts
import { expect, it, vi } from 'vitest'

import { createSingleFlight } from './single-flight.ts'

it('allows one action per key until its promise settles', async () => {
  let release: (() => void) | undefined
  const action = vi.fn(async () => await new Promise<void>((resolve) => { release = resolve }))
  const flight = createSingleFlight<string>()

  const first = flight.run('uid', action)
  const duplicate = flight.run('uid', action)
  expect(duplicate).toBeNull()
  expect(flight.isRunning('uid')).toBe(true)
  expect(action).toHaveBeenCalledOnce()

  release?.()
  await first
  expect(flight.isRunning('uid')).toBe(false)
  expect(flight.run('uid', action)).not.toBeNull()
})
```

- [ ] **Step 2: Run the guard test and observe the missing-module failure**

Run: `pnpm --filter dash test -- src/single-flight.test.ts`

Expected: FAIL because `apps/dash/src/single-flight.ts` does not exist.

- [ ] **Step 3: Implement the reusable Dash-local guard**

```ts
export interface SingleFlight<Key> {
  isRunning: (key: Key) => boolean
  run: <Result>(key: Key, action: () => Promise<Result>) => Promise<Result> | null
}

export const createSingleFlight = <Key>(): SingleFlight<Key> => {
  const running = new Set<Key>()
  return {
    isRunning: (key) => running.has(key),
    run: <Result>(key: Key, action: () => Promise<Result>): Promise<Result> | null => {
      if (running.has(key)) return null
      running.add(key)
      try {
        return action().finally(() => running.delete(key))
      } catch (error) {
        running.delete(key)
        throw error
      }
    },
  }
}
```

- [ ] **Step 4: Write failing confirmation-dialog tests**

Render the dialog view for an active row and assert `role="dialog"`/native dialog semantics, `aria-modal="true"`, member fallback, shortened holder, level, shortened UID with full UID accessible, safe Cancel before the destructive action in DOM order, and a localized error. Render with `busy: true` and assert both actions are disabled, the busy label appears, and cancel/close is blocked.

```ts
export interface RevokeDialogProps {
  busy: boolean
  copy: DashCopy['revoke']
  error: string | null
  onCancel: () => void
  onConfirm: () => void
  target: MemberRowView | null
}
```

- [ ] **Step 5: Run dialog tests and observe the missing-module failure**

Run: `pnpm --filter dash test -- src/revoke-dialog.test.tsx`

Expected: FAIL because `apps/dash/src/RevokeDialog.tsx` does not exist.

- [ ] **Step 6: Implement the native modal confirmation**

Use a ref and effect to call `showModal()` when `target` becomes non-null and `close()` when it clears. On `cancel`, call `preventDefault()` while busy; otherwise invoke `onCancel`. Prevent backdrop dismissal while busy. Place Cancel first and focus it after opening. The browser returns focus to the invoking revoke button when the modal closes; retain a fallback invoker ref in `RightsPage` and focus it after successful/cancelled closure for browsers that do not.

- [ ] **Step 7: Compose the Rights page with exact state ownership**

```ts
export interface RightsPageProps {
  copy: DashCopy
  graphEndpoint: string
  members: MembersState
  onRevoke: (uid: string) => Promise<Result<RevokeResponse>>
}
```

`RightsPage` owns `filters`, `openQr`, `revokeTarget`, `revokeError`, and one `SingleFlight<string>` retained through `useRef`. It derives source rows with `memberSnapshot`, then filters them. Initial error, refresh status, source-empty, and filtered-empty are separate render branches. Clear filters restores `DEFAULT_RIGHTS_FILTERS` without reloading.

Confirm calls `flight.run(target.uid, () => onRevoke(target.uid))` before any `await`. A null return is ignored. While the promise exists, set `revokingUid` synchronously for UI state. On success, close the dialog; App's `onRevoke` wrapper performs the shared reload. On a non-401 failure, keep the dialog open and render `<errorPrefix>: <verbatim error>`. A 401 unmounts the authenticated page through App and must not leave a second error. Always clear visible busy state in `finally` if the page remains mounted.

Place `<OnChainStatus endpoint={graphEndpoint} copy={copy.chain} />` in its own section after the D1 collection; do not pass filters or rows to it.

- [ ] **Step 8: Verify revoke safety and Rights composition**

Run: `pnpm --filter dash test -- src/single-flight.test.ts src/revoke-dialog.test.tsx src/rights-filter.test.ts src/rights-list.test.tsx`

Expected: PASS; the single-flight test proves two immediate confirmations produce one request.

- [ ] **Step 9: Commit revoke confirmation**

```bash
git add apps/dash/src/single-flight.ts apps/dash/src/single-flight.test.ts apps/dash/src/RevokeDialog.tsx apps/dash/src/revoke-dialog.test.tsx apps/dash/src/RightsPage.tsx
git commit -m "feat: confirm dash revocations safely"
```

---

### Task 8: Localize and harden Issue, token, QR, and Graph states

**Files:**

- Modify: `apps/dash/src/TokenGate.tsx`
- Modify: `apps/dash/src/IssueForm.tsx`
- Modify: `apps/dash/src/QrBlock.tsx`
- Modify: `apps/dash/src/OnChainStatus.tsx`
- Modify: `apps/dash/src/on-chain-status-view.test.tsx`
- Create: `apps/dash/src/issue-form-view.test.tsx`

**Interfaces:**

- Consumes: selected `DashCopy` sections, `createSingleFlight()`, existing `issueBodyFrom()`, and existing `loadOnChainStatus()`.
- Produces: updated component props below; request payloads and Graph helper signatures remain unchanged.

- [ ] **Step 1: Write failing localized component tests**

Update Graph view tests to pass Japanese copy and assert Japanese idle/loading/empty/fallback strings while preserving UID, delegation, Attendance, and unresolved-relation assertions. Add Issue view assertions for persistent `<label>` text, selected level descriptions, disabled invalid submit, `aria-live` outcome, localized raw error context, and busy label. Assert TokenGate has a real password-input label and accepts appearance controls.

Use these exact signatures:

```ts
export interface TokenGateProps {
  appearance: JSX.Element
  copy: DashCopy['auth']
  error: string | null
  onToken: (token: string) => void
}

export interface TokenGateViewProps extends TokenGateProps {
  onValue: (value: string) => void
  value: string
}

export interface IssueFormProps {
  copy: DashCopy['issue']
  onIssue: (body: Record<string, string | number>) => Promise<Result<IssueResponse>>
}

export interface IssueFormViewProps {
  body: Record<string, string | number> | null
  busy: boolean
  copy: DashCopy['issue']
  form: Form
  onChange: (patch: Partial<Form>) => void
  onSubmit: () => void
  result: Result<IssueResponse> | null
}

export interface QrBlockProps { label: string; qr: string }

export interface OnChainStatusProps {
  copy: DashCopy['chain']
  endpoint: string
}

export interface OnChainStatusViewProps {
  copy: DashCopy['chain']
  state: OnChainStatusState
}
```

- [ ] **Step 2: Run focused component tests and observe signature failures**

Run: `pnpm --filter dash test -- src/issue-form-view.test.tsx src/on-chain-status-view.test.tsx`

Expected: FAIL because current components do not accept copy/appearance/endpoint props and still contain English literals.

- [ ] **Step 3: Localize TokenGate and QR semantics**

Split `TokenGate` into a state wrapper and exported pure `TokenGateView`. Render appearance controls outside the auth card but within the gate page. Render the auth error in `role="alert"`. Associate the password input and visible `copy.tokenLabel` with a stable ID. Preserve trimming and acceptance of an empty local token. In `QrBlock`, add an accessible label to the generated SVG container while keeping the exact `qrSvg(qr, { modulePx: 160 })` call and full payload `<code>` text.

- [ ] **Step 4: Localize Issue and add single-flight submission**

Split `IssueForm` into a hook-owning wrapper and exported pure `IssueFormView` using the exact props above. Keep `issueBodyFrom()` and the exact API body untouched. Retain a `SingleFlight<'issue'>` through `useRef`. Guard before awaiting:

```ts
const pending = flight.current.run('issue', async () => await onIssue(body))
if (pending === null) return
setBusy(true)
try {
  setResult(await pending)
} finally {
  setBusy(false)
}
```

Disable submit for `body === null || busy`; use the busy label while active. Give every input/select a visible associated label. Use `role="status" aria-live="polite"` for success and `role="alert"` for errors. Preserve raw API identifiers, the +Private announcement transaction prefix, Bearer/Signed holder text, QR, and browser-pass URL.

- [ ] **Step 5: Localize Graph view without changing Graph IO**

Remove the direct `GRAPH_RIGHTS_ENDPOINT` import from `OnChainStatus.tsx`; use the `endpoint` prop. Keep the `OnChainStatusState` union and `loadOnChainStatus(graphOnChainStatusIo, endpoint, holder)` call. Preserve idle/loading/error/ready behavior and disable Query while loading. Use localized labels, but continue rendering BigInt timestamps through template-string conversion and preserve unresolved delegation IDs. Graph errors remain confined to this section.

- [ ] **Step 6: Verify all preserved feature tests**

Run: `pnpm --filter dash test -- src/issue-form.test.ts src/issue-form-view.test.tsx src/on-chain-status.test.ts src/on-chain-status-view.test.tsx src/members-view.test.ts`

Expected: PASS for all issue payload, pass/QR, +Private, Graph relation, error, and localized view cases.

- [ ] **Step 7: Commit localized operation states**

```bash
git add apps/dash/src/TokenGate.tsx apps/dash/src/IssueForm.tsx apps/dash/src/QrBlock.tsx apps/dash/src/OnChainStatus.tsx apps/dash/src/on-chain-status-view.test.tsx apps/dash/src/issue-form-view.test.tsx
git commit -m "feat: localize dash operation states"
```

---

### Task 9: Compose App state, appearance persistence, pages, and responsive styling

**Files:**

- Create: `apps/dash/src/app-state.ts`
- Test: `apps/dash/src/app-state.test.ts`
- Create: `apps/dash/src/app-actions.ts`
- Test: `apps/dash/src/app-actions.test.ts`
- Test: `apps/dash/src/app-view.test.tsx`
- Modify: `apps/dash/src/App.tsx`
- Modify: `apps/dash/src/main.tsx`
- Modify: `apps/dash/index.html`
- Modify: `apps/dash/src/styles.css`
- Modify: `apps/dash/package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**

- Consumes: all earlier task interfaces plus unchanged `listMembers`, `issueRight`, `revokeRight`, `memberRowView`, `API_BASE_URL`, and `GRAPH_RIGHTS_ENDPOINT`.
- Produces: `DashIo`, `ActionContext`, `issueAndReload()`, `revokeAndReload()`, `SessionState`, `unauthorizedSession()`, `AppProps`, `AppViewProps`, and the finished routed `App`.

- [ ] **Step 1: Write the failing unauthorized transition test**

```ts
import { expect, it } from 'vitest'

import { unauthorizedSession } from './app-state.ts'

it('clears only protected operational state on 401', () => {
  expect(unauthorizedSession({
    authError: null,
    members: { kind: 'ready', rows: [] },
    token: 'secret',
  })).toStrictEqual({
    authError: 'unauthorized',
    members: { kind: 'idle' },
    token: null,
  })
})
```

- [ ] **Step 2: Run the state test and observe the missing-module failure**

Run: `pnpm --filter dash test -- src/app-state.test.ts`

Expected: FAIL because `apps/dash/src/app-state.ts` does not exist.

- [ ] **Step 3: Implement the pure session transition and IO interface**

```ts
export interface SessionState {
  authError: 'unauthorized' | null
  members: MembersState
  token: string | null
}

export const unauthorizedSession = (_state: SessionState): SessionState => ({
  authError: 'unauthorized',
  members: { kind: 'idle' },
  token: null,
})

export interface DashIo {
  issueRight: typeof issueRight
  listMembers: typeof listMembers
  revokeRight: typeof revokeRight
}
```

Keep `DEFAULT_DASH_IO` private in `App.tsx`. Optional IO injection is permitted only through `AppProps.io?: DashIo` for deterministic tests; production uses existing helpers.

- [ ] **Step 4: Write failing authenticated-action coordination tests**

Create `app-actions.test.ts` with injected spies. Assert a successful issue and successful revoke each call `reload(token)` exactly once and return the original result; a non-401 failure never reloads or clears; and a 401 calls `onUnauthorized()` exactly once and never reloads.

```ts
const UID = `0x${'ab'.repeat(32)}` as const
const HOLDER = `0x${'11'.repeat(20)}` as const
const issueSuccess: Result<IssueResponse> = {
  body: {
    holder: HOLDER,
    level: 'bearer',
    passUrls: { apple: '/apple', google: '/google', web: '/pass' },
    qr: `fuda:v1:${UID}`,
    uid: UID,
  },
  ok: true,
}
const revokeSuccess: Result<RevokeResponse> = { body: { revoked: true, uid: UID }, ok: true }
const issueRight = vi.fn<DashIo['issueRight']>(async () => issueSuccess)
const listMembers = vi.fn<DashIo['listMembers']>(async () => ({ body: { members: [] }, ok: true }))
const revokeRight = vi.fn<DashIo['revokeRight']>(async () => revokeSuccess)
const io = { issueRight, listMembers, revokeRight }
const reload = vi.fn(async (_token: string) => undefined)
const onUnauthorized = vi.fn()
const context: ActionContext = {
  io,
  onUnauthorized,
  reload,
  token: 'secret',
}

expect(await issueAndReload(context, { memberId: 'alice', tier: 1, usageModel: 1 })).toStrictEqual(issueSuccess)
expect(reload).toHaveBeenCalledWith('secret')

expect(await revokeAndReload(context, UID)).toStrictEqual(revokeSuccess)
expect(reload).toHaveBeenCalledTimes(2)

revokeRight.mockResolvedValueOnce({ error: 'bad_uid', network: false, ok: false, status: 400 })
await revokeAndReload(context, UID)
expect(reload).toHaveBeenCalledTimes(2)

issueRight.mockResolvedValueOnce({ error: 'unauthorized', network: false, ok: false, status: 401 })
await issueAndReload(context, { memberId: 'alice', tier: 1, usageModel: 1 })
expect(onUnauthorized).toHaveBeenCalledOnce()
```

- [ ] **Step 5: Run the action test and observe the missing-module failure**

Run: `pnpm --filter dash test -- src/app-actions.test.ts`

Expected: FAIL because `apps/dash/src/app-actions.ts` does not exist.

- [ ] **Step 6: Implement authenticated action coordination**

```ts
export interface ActionContext {
  io: DashIo
  onUnauthorized: () => void
  reload: (token: string) => Promise<void>
  token: string
}

export const issueAndReload = async (
  context: ActionContext,
  body: Record<string, string | number>,
): Promise<Result<IssueResponse>> => {
  const result = await context.io.issueRight(context.token, body)
  if (!result.ok) {
    if (result.status === 401) context.onUnauthorized()
    return result
  }
  await context.reload(context.token)
  return result
}

export const revokeAndReload = async (
  context: ActionContext,
  uid: string,
): Promise<Result<RevokeResponse>> => {
  const result = await context.io.revokeRight(context.token, uid)
  if (!result.ok) {
    if (result.status === 401) context.onUnauthorized()
    return result
  }
  await context.reload(context.token)
  return result
}
```

- [ ] **Step 7: Write the failing app-view composition tests**

Test pure exported `AppView` rather than mounting hooks. Use this interface:

```ts
export interface AppViewProps {
  appearance: JSX.Element
  authError: 'unauthorized' | null
  copy: DashCopy
  graphEndpoint: string
  members: MembersState
  onIssue: IssueFormProps['onIssue']
  onNavigate: (route: DashRoute) => void
  onRevoke: RightsPageProps['onRevoke']
  onToken: (token: string) => void
  route: DashRoute
  token: string | null
}
```

Assert token-null renders only TokenGate plus appearance controls while retaining the requested route in state; `AppView` maps `authError === 'unauthorized'` to the currently selected `copy.auth.unauthorized`, so changing locale translates the visible error without mutating session state. Token-present renders `DashboardShell`; `/` contains Overview but not Issue/Graph forms; `/rights` contains Rights and separate on-chain heading; `/issue` contains the existing level choices. Assert switching copy passed to `AppView` changes labels without changing route/member fixtures.

- [ ] **Step 8: Run the view test and observe the missing-export failure**

Run: `pnpm --filter dash test -- src/app-view.test.tsx`

Expected: FAIL because `AppView` and routed composition do not exist.

- [ ] **Step 9: Refactor App into stateful controller plus pure view**

`App` owns route, locale, theme, and one `session: SessionState` value containing token, member resource, and auth error. Export `AppProps` as `{ initialTheme: ThemeMode; io?: DashIo }`. Initialize route with `routeFromPath(location.pathname)`, locale with `getLocale()`, theme from the required `initialTheme` prop passed by `main.tsx`, and session with `{ authError: null, members: { kind: 'idle' }, token: null }`. Subscribe to `popstate`, replace a noncanonical initial pathname, and never reload members on route changes. Token submission replaces session with `{ authError: null, members: { kind: 'idle' }, token }`, which triggers the initial members load.

Implement `reload(token)` as:

```ts
setSession((state) => ({ ...state, members: beginMembersLoad(state.members) }))
const result = await io.listMembers(token)
if (result.ok) {
  const rows = result.body.members.map((row) => memberRowView(row, API_BASE_URL))
  setSession((state) => ({ ...state, members: completeMembersLoad(rows) }))
  return
}
if (result.status === 401) {
  setSession((state) => unauthorizedSession(state))
  return
}
setSession((state) => ({ ...state, members: failMembersLoad(state.members, result.error) }))
```

Build one `ActionContext` from the current token, `io`, `reload`, and `onUnauthorized: () => setSession((state) => unauthorizedSession(state))`. `onIssue` delegates to `issueAndReload`; `onRevoke` delegates to `revokeAndReload`. Failed non-401 writes return without erasing rows or performing an unnecessary reload.

Build one appearance fragment from `LanguageSwitcher` and `ThemeToggle`. Language selection validates with `isLocale`, calls `setLocale`, then updates locale state. Theme selection calls `saveThemeMode`, updates theme state, and a theme effect returns `watchThemeMode(theme)`. Pass the same controls to TokenGate or DashboardShell. Do not recreate token/member/form state when either preference changes.

- [ ] **Step 10: Apply theme before render**

Update `main.tsx` in this exact order:

```ts
const initialTheme = readThemeMode()
applyThemeMode(initialTheme)
const root = document.querySelector<HTMLElement>('#root')
if (root !== null) render(<App initialTheme={initialTheme} />, root)
```

Remove `data-theme="dark"` from `index.html`; keep `lang="en"` as the no-script/first-paint language.

- [ ] **Step 11: Add package dependencies and app styling**

Add `"@fuda/styles": "workspace:*"` alongside `@fuda/i18n`; retain `@fuda/sdk`, `@fuda/ui`, and Hono. Start `styles.css` with:

```css
@import 'tailwindcss';
@import '@fuda/styles/base.css';
@plugin "daisyui";
```

Then add only Dash selectors. Required concrete layout rules:

- `.dash-app` is a min-height screen grid; at `lg` it has a 248 px sidebar column and a `minmax(0, 1fr)` content column.
- `.dash-sidebar` is hidden below `lg`, sticky at the viewport top, full-height, and uses semantic surface/border tokens.
- `.dash-mobile-header` and `.dash-drawer` are absent at `lg`; the header is sticky and its menu button is 44 px square.
- `.dash-main` has `min-width: 0`; content is centered with a 72 rem maximum and responsive 16/24/32 px padding.
- nav links, icon controls, primary actions, and mobile drawer actions meet the 44 px minimum target and have visible selected, hover, and focus states in both themes.
- Overview cards use `repeat(auto-fit, minmax(min(100%, 14rem), 1fr))`.
- `.rights-table` is hidden below `lg`; `.rights-cards` is hidden at `lg` and above.
- long addresses/UIDs use `overflow-wrap: anywhere`; action rows wrap rather than widen the viewport.
- native dialog backdrop is opaque enough to distinguish modality; the drawer occupies `min(22rem, calc(100vw - 2rem))` and never exceeds the viewport.
- status and destructive treatments use semantic text plus color; skeletons have no essential animation.

- [ ] **Step 12: Refresh the lockfile and run the integrated Dash suite**

Run: `pnpm install --lockfile-only`

Expected: PASS with Dash linked to `@fuda/i18n` and `@fuda/styles` and no unrelated version drift.

Run: `pnpm --filter dash test`

Expected: PASS for all old and new Dash tests.

Run: `pnpm --filter dash build`

Expected: PASS and emit the routed assets-only SPA.

- [ ] **Step 13: Commit the integrated console**

```bash
git add apps/dash/package.json apps/dash/index.html apps/dash/src/App.tsx apps/dash/src/app-state.ts apps/dash/src/app-state.test.ts apps/dash/src/app-actions.ts apps/dash/src/app-actions.test.ts apps/dash/src/app-view.test.tsx apps/dash/src/main.tsx apps/dash/src/styles.css pnpm-lock.yaml
git commit -m "feat: compose polished dash console"
```

---

### Task 10: Update canonical docs and complete verification

**Files:**

- Modify: `docs/specs/pass-types-and-flows.md`
- Modify: `docs/architecture.md`

**Interfaces:**

- Consumes: the verified implementation and the repository documentation hierarchy.
- Produces: canonical current-behavior documentation; no temporary artifact becomes canonical.

- [ ] **Step 1: Update the canonical surface description**

In `docs/specs/pass-types-and-flows.md`, replace the Dash surface role with:

```markdown
operator dashboard: `/` overview from D1 member rows and client configuration, `/rights` D1 search/filter/revoke/pass links plus separate on-chain lookup, and `/issue` issuance
```

After the existing dashboard Graph-separation paragraph, add:

```markdown
The dashboard keeps its admin token in the current tab's memory only and applies the gate to every Dash route. English is the first-visit language; an explicit English/Japanese choice and a light/dark/system theme mode persist in browser-local preferences. These presentation preferences do not enter API requests and changing them does not clear route or operational state. At widths below 64 rem, navigation uses a modal drawer and D1 rights use cards; at and above 64 rem, navigation is persistent and rights use a table. Revocation always requires confirmation and suppresses a duplicate submission while the selected UID is in flight.
```

- [ ] **Step 2: Update the architecture ownership row**

Change only the Operator dashboard row in `docs/architecture.md` to:

```markdown
| Operator dashboard | `apps/dash` | Gives authorized issuers routed Overview, Rights, and Issue views; derives operational summaries from D1 member rows, issues and revokes through the API, and queries chain status separately through the rights subgraph |
```

Do not describe the temporary spec/plan or implementation sequence in canonical docs.

- [ ] **Step 3: Run focused tests for every changed package**

Run: `pnpm --filter @fuda/i18n test`

Expected: PASS.

Run: `pnpm --filter @fuda/ui test`

Expected: PASS.

Run: `pnpm --filter dash test`

Expected: PASS, including all preserved and new Dash cases.

- [ ] **Step 4: Run repository-wide automated gates**

Run each command independently and require exit code 0:

```bash
pnpm test
pnpm check
pnpm format:check
pnpm --filter dash build
git diff --check
```

Expected: every command PASS with zero test, type, lint, formatting, build, or whitespace failures. Fix a failure at its owning task seam, rerun the focused red/green test, then rerun this entire five-command gate.

- [ ] **Step 5: Verify direct routes and assets-only fallback**

Start the built preview on a deterministic port:

```bash
pnpm --filter dash run preview -- --host 127.0.0.1 --port 4175 --strictPort
curl -fsS http://127.0.0.1:4175/
curl -fsS http://127.0.0.1:4175/rights
curl -fsS http://127.0.0.1:4175/issue
```

Expected: all three curl commands return the SPA shell with HTTP 200. In a browser, confirm direct loading each route retains that route after token entry, internal navigation uses clean paths, unknown paths normalize to `/`, and Back/Forward follows prior route selections.

- [ ] **Step 6: Run the local operational smoke without changing API contracts**

In separate terminals, use the existing local fake-chain workflow:

```bash
pnpm --filter api migrate:local
USE_FAKE_CHAIN=1 pnpm --filter api dev
pnpm --filter dash dev
```

Before any write, run `curl -i http://127.0.0.1:8787/members` and require `x-auth-mode: open`; then leave the Dash token empty. If local ignored vars cause `x-auth-mode: locked`, do not choose or expose a credential overnight: record the external configuration blocker and retain the automated API/UI evidence for morning review. With open fake-chain auth, verify one Bearer issue produces the same QR and web pass link, one Signed issue preserves its holder/pass behavior, and one +Private issue shows announcement feedback without holder/pass links. Confirm each success refreshes Overview and Rights. Revoke the new Bearer row: cancel once, then confirm; while pending, activate Confirm repeatedly and observe one network request; after success, observe the revoked row. Query a holder in the separate on-chain section when Graph is configured; when it is not, confirm the localized unconfigured error without any fallback to D1.

- [ ] **Step 7: Run appearance, responsive, and keyboard checks**

Use browser responsive widths 320 px, 768 px, and 1024 px or wider:

- no page-level horizontal overflow and no hidden issue, QR, pass, query, or revoke action;
- cards below 1024 px and the table at/above 1024 px;
- modal drawer below 1024 px, persistent sidebar at/above it;
- drawer open/close, Escape, focus containment, overlay inertness, route-close, and focus return work by keyboard;
- token, search, filters, QR, issue, query, and revoke dialog have visible labels and focus;
- destructive confirmation starts on Cancel and cannot dismiss while busy;
- statuses remain understandable without color;
- light, dark, and system remain legible, system follows a live OS preference change, and theme survives reload;
- English appears on a clean first visit, Japanese is complete, locale survives reload, and switching either preference keeps route, form/filter values, token, and loaded rows; and
- reduced-motion preference removes nonessential transitions.

- [ ] **Step 8: Commit canonical documentation after all checks pass**

```bash
git add docs/specs/pass-types-and-flows.md docs/architecture.md
git commit -m "docs: describe polished dash behavior"
```

---

### Task 11: Remove completed temporary artifacts and record final evidence

**Files:**

- Delete: `.superpowers/specs/2026-09-07-dash-ui-polish-design.md`
- Delete: `.superpowers/plans/2026-09-07-dash-ui-polish.md`

**Interfaces:**

- Consumes: Task 10's successful full automated and manual verification evidence.
- Produces: a clean feature branch whose canonical docs, implementation, and tests are authoritative; Git history retains this design and plan.

- [ ] **Step 1: Confirm the verification commit exists before deletion**

Run:

```bash
git log -1 --oneline
git status --short
```

Expected: HEAD is `docs: describe polished dash behavior` and the worktree is clean. If either condition is false, return to Task 10; do not delete the artifacts.

- [ ] **Step 2: Delete both temporary artifacts**

Use the patch editing tool to delete exactly:

```text
.superpowers/specs/2026-09-07-dash-ui-polish-design.md
.superpowers/plans/2026-09-07-dash-ui-polish.md
```

Do not delete `.superpowers/README.md`, other active specs, or other plans.

- [ ] **Step 3: Verify deletion scope and repository state**

Run:

```bash
git status --short
git diff --check
git diff --name-status
```

Expected: exactly the two files above are deleted, `git diff --check` is silent, and no implementation or canonical-doc file changed after Task 10's successful gate.

- [ ] **Step 4: Commit the lifecycle cleanup**

```bash
git add .superpowers/specs/2026-09-07-dash-ui-polish-design.md .superpowers/plans/2026-09-07-dash-ui-polish.md
git commit -m "chore: remove completed development artifacts"
```

- [ ] **Step 5: Report completion without integrating the branch**

Run:

```bash
git status --short
git log --oneline 7277405..HEAD
```

Expected: clean worktree and the sequence of English task commits. Report automated command results, manual route/responsive/accessibility/operation evidence, and the final commit hash to the controller. Do not merge into `main`, remove the worktree, delete `feat/dash-ui-polish`, or close workspace `w1J`; those remain controller-owned actions.

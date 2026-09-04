/* oxlint-disable eslint/sort-keys -- sections here are ordered by topic (lint → fmt), not alphabetically */
// fuda-sh unified toolchain config (Vite+ / `vp`): dev server, build, test,
// lint (oxlint) and fmt (oxfmt) in one file. `vp lint` / `vp fmt` / `vp check`.
//
// Lint philosophy — near-full-strict from day one. This repo is written fresh,
// so the Ultracite presets (core + anti-slop + vitest) run UNCURATED except for
// the handful of exclusions that are structural rather than taste:
//   1. tool conflicts (a fixer/formatter fight, a framework false positive),
//   2. rules that would WEAKEN assertions,
//   3. the test-fixture latitude every codebase needs.
// Deliberate exceptions in code use `// oxlint-disable-next-line <rule> -- reason`
// (e.g. an intentional sequential-await loop over D1); keep them rare and reasoned.
import oxfmtPreset from 'ultracite/oxfmt'
import antiSlop from 'ultracite/oxlint/anti-slop'
import core from 'ultracite/oxlint/core'
import vitest from 'ultracite/oxlint/vitest'
import { defineConfig } from 'vite-plus'

export default defineConfig({
  lint: {
    extends: [core, antiSlop, vitest],
    rules: {
      // -- structural exclusions (not taste) ----------------------------------
      // The fixer adds parentheses around nested ternaries; oxfmt strips them
      // again. The two tools cannot both be satisfied, in any codebase:
      'unicorn/no-nested-ternary': 'off',
      // False positive on Hono middleware (`await next()`):
      'node/callback-return': 'off',
      // -- config, not off ----------------------------------------------------
      // JSX component files keep PascalCase names (App.tsx); everything else kebab:
      'unicorn/filename-case': ['error', { cases: { kebabCase: true, pascalCase: true } }],
      // hono/jsx pragma comments are compiler directives, not doc tags:
      'jsdoc/check-tag-names': ['error', { definedTags: ['jsxRuntime', 'jsxImportSource'] }],
    },
    overrides: [
      // Vitest preset curation must live at override level (the preset applies
      // its rules via a test-file override, which top-level `rules` cannot beat).
      {
        files: ['**/*.test.ts', '**/*.test.tsx', '**/test/**'],
        env: { jest: true },
        rules: {
          // These two rewrite exact `toBe(true/false)` into truthy/falsy checks —
          // they WEAKEN assertions, so they stay off even in a strict setup:
          'vitest/prefer-to-be-truthy': 'off',
          'vitest/prefer-to-be-falsy': 'off',
          // Test-fixture latitude: fakes and fixtures are built by casting.
          // All of these stay fully enforced in src:
          'typescript/no-explicit-any': 'off',
          'typescript/no-non-null-assertion': 'off',
          'anti-slop/no-chained-type-assertions': 'off',
          'anti-slop/no-unknown-parameters': 'off',
          'anti-slop/no-unknown-returns': 'off',
          'anti-slop/no-module-mocking': 'off',
          'anti-slop/require-safety-comment-for-type-assertion': 'off',
        },
      },
      // Cloudflare Worker entry code runs in the workerd global scope:
      {
        files: ['src/worker/**'],
        env: { serviceworker: true },
      },
    ],
  },

  fmt: {
    // Ultracite defaults plus the fuda house style.
    ...oxfmtPreset,
    printWidth: 110,
    semi: false,
    singleQuote: true,
    trailingComma: 'all',
    // Markdown stays hand-formatted (proseWrap would rewrap prose):
    ignorePatterns: [...oxfmtPreset.ignorePatterns, '**/*.md'],
  },
})

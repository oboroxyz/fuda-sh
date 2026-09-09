---
paths:
  - 'apps/app/**'
  - 'apps/dash/**'
  - 'apps/gate/**'
  - 'packages/ui/**'
  - 'packages/styles/**'
---

# Frontend design

For `apps/app`, `apps/dash`, and `apps/gate`, import `tailwindcss` and then `@fuda/styles/base.css` from the app's `src/styles.css`. Keep variables, base rules, and reusable `.fuda-*` classes emitted by `packages/ui` in `packages/styles/base.css`; keep each product's visual design in its app.

Prefer daisyUI components for standard UI patterns when they fit the desired behavior and visual design. Compose them with Tailwind utilities rather than reimplementing the same patterns from scratch.

Prefer Tailwind utilities in TSX and `@apply` for reusable selector-driven rules. Use CSS declarations for custom properties, keyframes, pseudo-elements, compound state selectors, and expressions that Tailwind cannot represent clearly. Compose conditional or potentially conflicting class names with `cn`; keep static classes as string literals. Declare `cn` as a direct dependency of each app or package that imports it.

import solid from 'vite-plugin-solid'
import { defineConfig } from 'vite-plus'

// Solid bindings live in solid.ts; only their test is Solid JSX. The Hono
// bindings' test must not go through the Solid compiler
// (docs/adr/0009-void-and-solid.md).
export default defineConfig({
  plugins: [solid({ hot: false, include: ['src/**/solid.test.tsx'] })],
  test: { environment: 'happy-dom', include: ['src/**/*.test.{ts,tsx}'], unstubGlobals: true },
})

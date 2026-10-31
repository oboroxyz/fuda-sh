import solid from 'vite-plugin-solid'
import { defineConfig } from 'vite-plus'

// Only src/solid/ is Solid; every other .tsx here is Hono JSX and must not go
// through the Solid compiler (docs/adr/0009-void-and-solid.md).
export default defineConfig({
  plugins: [solid({ hot: false, include: ['src/solid/**/*.tsx'] })],
  test: { environment: 'node', include: ['src/**/*.test.{ts,tsx}'], unstubGlobals: true },
})

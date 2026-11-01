import solid from 'vite-plugin-solid'
import { defineConfig } from 'vite-plus'

export default defineConfig({
  plugins: [solid({ hot: false })],
  test: { environment: 'node', include: ['src/**/*.test.{ts,tsx}'], unstubGlobals: true },
})

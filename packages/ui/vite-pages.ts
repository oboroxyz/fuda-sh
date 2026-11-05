import { preact } from '@preact/preset-vite'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite-plus'
import { voidPlugin } from 'void'
import { voidPreact } from 'void-preact/plugin'

export const preactPagesConfig = (options: { host?: string; port: number; prebundled: string[] }) =>
  defineConfig({
    environments: { void_worker: { optimizeDeps: { include: options.prebundled } } },
    optimizeDeps: { include: options.prebundled },
    plugins:
      process.env.VITEST === undefined
        ? [
            tailwindcss(),
            voidPlugin(),
            voidPreact({ preact: { prefreshEnabled: false, reactAliasesEnabled: false } }),
          ]
        : [tailwindcss(), preact({ prefreshEnabled: false, reactAliasesEnabled: false })],
    server: { host: options.host, port: options.port, strictPort: true },
    test: { environment: 'node', include: ['src/**/*.test.{ts,tsx}'], unstubGlobals: true },
  })

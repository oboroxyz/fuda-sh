import { defineConfig } from 'vite-plus'
import { voidPlugin } from 'void'

// Each e2e surface gets fresh D1 and R2 state in its own directory.
export default defineConfig({ plugins: [voidPlugin({ persistTo: process.env.E2E_STATE_DIR })] })

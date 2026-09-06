import { defineConfig } from 'vitest/config'

// Operational scripts run in Node, outside the Worker test pool.
export default defineConfig({ test: { include: ['scripts/**/*.test.ts'] } })

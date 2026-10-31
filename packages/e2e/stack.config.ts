// Ports and origins shared by the stack launcher, the e2e configs and the seed
// helpers. They sit beside the dev ports (api 8787, app 5173, gate 5174,
// dash 5175), so a suite run never collides with `pnpm dev`.
import { fileURLToPath } from 'node:url'

export const repoRoot: string = fileURLToPath(new URL('../..', import.meta.url))

export const API_PORT = 8797
export const INSPECTOR_PORT = 9339
// The api's CORS policy accepts any loopback port on `localhost` or `127.0.0.1`.
export const API_ORIGIN = `http://127.0.0.1:${String(API_PORT)}`

interface Surface {
  port: number
  origin: string
}

export const SURFACES = {
  app: { origin: 'http://127.0.0.1:6173', port: 6173 },
  dash: { origin: 'http://127.0.0.1:6175', port: 6175 },
  gate: { origin: 'http://127.0.0.1:6174', port: 6174 },
} as const satisfies Record<string, Surface>

export type SurfaceName = keyof typeof SURFACES

export const isSurface = (value: string): value is SurfaceName => Object.hasOwn(SURFACES, value)

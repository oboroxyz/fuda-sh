// VITE_API_BASE_URL is baked in at build time; local dev talks to `wrangler dev --env local`.
export const API_BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8787'

// `?camera=off` runs the gate as a reader-only station: no camera, no paste box,
// one waiting line. It is a URL flag rather than a build setting because the same
// deployment serves both — a laptop with a working camera and a tablet that has
// none, standing at the same event. Anything else, including a missing parameter,
// keeps the camera.
export const cameraMode = (search: string): 'auto' | 'off' =>
  new URLSearchParams(search).get('camera') === 'off' ? 'off' : 'auto'

// The scanner reaches the api only through its own Worker, which forwards
// `/api/*` (docs/adr/0010-void-pages-and-frontend-workers.md).
export const API_BASE_URL = '/api'

// `?camera=off` runs the gate as a reader-only station: no camera, no paste box,
// one waiting line. It is a URL flag rather than a build setting because the same
// deployment serves both — a phone or laptop that scans with its camera and a tablet
// on a stand with a USB reader, at the same event. Anything else, including a missing parameter,
// keeps the camera.
export const cameraMode = (search: string): 'auto' | 'off' =>
  new URLSearchParams(search).get('camera') === 'off' ? 'off' : 'auto'

// `?venue=<handle>` says which shop this station checks for, so the api can turn
// another shop's pass away. It is station configuration for honest staff, not
// authentication: anyone holding the URL can change it. A leading `@` and
// capitals are forgiven, because the shop page is written `@handle`. Whatever is
// left is sent as is, even if no shop has that handle, and the api answers
// WRONG_VENUE: dropping a mistyped value would silently turn the check off.
export const venueHandle = (search: string): string | null => {
  const raw = new URLSearchParams(search).get('venue')?.trim().replace(/^@/u, '').toLowerCase()
  return raw === undefined || raw === '' ? null : raw
}

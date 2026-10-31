// The dashboard's cookies, shared by the Worker (src/server/cookies.ts) and the
// browser, which writes the two preference cookies itself.
export const OPERATOR_COOKIE = 'fuda_operator'
// The deployment admin token. Present but empty is a real session: an api with
// ADMIN_TOKEN unset serves the admin routes to anyone.
export const ADMIN_COOKIE = 'fuda_admin'
// Presentation preferences the server needs for the first render. They are not
// HttpOnly, because the browser writes them.
export const THEME_COOKIE = 'fuda_theme'
export const LOCALE_COOKIE = 'fuda_locale'

// The member app's cookies, shared by its Worker (src/server/) and the
// browser, which writes the two preference cookies itself.
export const MEMBER_COOKIE = 'fuda_member'
// Presentation preferences the server needs for the first render. They are not
// HttpOnly, because the browser writes them.
export const THEME_COOKIE = 'fuda_theme'
export const LOCALE_COOKIE = 'fuda_locale'

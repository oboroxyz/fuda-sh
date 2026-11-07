// WebAuthn's JSON form of bytes. Not taken from `@simplewebauthn/server/helpers`: importing
// that entry evaluates its certificate code, which throws in a built Worker for want of a
// reflect polyfill and would take every route that reaches it down.
export const base64UrlOf = (bytes: Uint8Array): string =>
  btoa(String.fromCodePoint(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/[=]+$/u, '')

export const bytesOfBase64Url = (text: string): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(atob(text.replaceAll('-', '+').replaceAll('_', '/')), (char) => char.codePointAt(0) ?? 0)

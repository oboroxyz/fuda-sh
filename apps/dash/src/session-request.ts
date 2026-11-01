import { apiFetch as requestApi, fetchJson as requestJson } from '@fuda/sdk/http'
import type { ApiInit, Result } from '@fuda/sdk/http'

// A page identifies the cookie session it rendered with. Cookies are shared
// across tabs; an old page must never submit writes through a newer session.
let version: string | null = null
export const setSessionVersion = (value: string | null): void => {
  version = value
}
export const sessionHeaders = (): Record<string, string> =>
  version === null ? {} : { 'x-fuda-session': version }
const options = (init: ApiInit): ApiInit => ({
  ...init,
  headers: version === null ? init.headers : { ...init.headers, 'x-fuda-session': version },
})
export const checkSessionResult = <T>(result: Result<T>): Result<T> => {
  if (!result.ok && result.error === 'session_changed') {
    window.location.reload()
  }
  return result
}
export const apiFetch = async <T>(base: string, path: string, init: ApiInit = {}): Promise<Result<T>> =>
  checkSessionResult(await requestApi<T>(base, path, options(init)))
export const fetchJson = async <T>(url: string, init: ApiInit = {}): Promise<Result<T>> =>
  checkSessionResult(await requestJson<T>(url, options(init)))

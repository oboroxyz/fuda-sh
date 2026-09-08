import { API_BASE_URL } from './config.ts'

// Never reuse a credential with a different API deployment.
const STORAGE_KEY = `fuda:dash:operator:${API_BASE_URL}`

export const readOperatorToken = (): string | null => {
  try {
    const token = window.localStorage.getItem(STORAGE_KEY)
    return token === '' ? null : token
  } catch {
    return null
  }
}

export const saveOperatorToken = (token: string): void => {
  try {
    window.localStorage.setItem(STORAGE_KEY, token)
  } catch {
    // Storage can be unavailable; the current in-memory session still works.
  }
}

export const clearOperatorToken = (token: string | null): void => {
  try {
    if (token !== null && window.localStorage.getItem(STORAGE_KEY) === token) {
      window.localStorage.removeItem(STORAGE_KEY)
    }
  } catch {
    // A blocked store must not prevent local sign-out.
  }
}

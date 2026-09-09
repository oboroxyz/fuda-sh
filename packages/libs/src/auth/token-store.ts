export interface TokenStoreOptions {
  apiBaseUrl: string
  audience: 'operator' | 'member'
  storage?: () => Storage
}

export const createTokenStore = ({
  apiBaseUrl,
  audience,
  storage = () => window.localStorage,
}: TokenStoreOptions) => {
  const key = audience === 'operator' ? `fuda:dash:operator:${apiBaseUrl}` : `fuda:app:member:${apiBaseUrl}`
  return {
    clear: (token: string | null): void => {
      try {
        const store = storage()
        if (token !== null && store.getItem(key) === token) {
          store.removeItem(key)
        }
      } catch {
        /* Blocked storage must not prevent local sign-out. */
      }
    },
    read: (): string | null => {
      try {
        const token = storage().getItem(key)
        return token === '' ? null : token
      } catch {
        return null
      }
    },
    save: (token: string): void => {
      try {
        storage().setItem(key, token)
      } catch {
        /* The in-memory session still works. */
      }
    },
  }
}

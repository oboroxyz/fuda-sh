// This digest is a comparison value, never a credential accepted by the api.
export const sessionVersion = async (token: string | null): Promise<string | null> => {
  if (token === null) {
    return null
  }
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

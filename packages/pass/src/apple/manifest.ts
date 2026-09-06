const hex = (bytes: Uint8Array): string => {
  let out = ''
  for (const b of bytes) {
    out += b.toString(16).padStart(2, '0')
  }
  return out
}

// `manifest.json`: the SHA-1 of every file in the pass except itself and the
// signature. SHA-1 is Apple's choice, not ours — it is an integrity index over
// files the CMS signature already covers, so its collision weakness buys an
// attacker nothing here.
export const manifestOf = async (files: Map<string, Uint8Array<ArrayBuffer>>): Promise<string> => {
  const named = [...files]
  const digests = await Promise.all(named.map(async ([, data]) => await crypto.subtle.digest('SHA-1', data)))
  const entries: Record<string, string> = {}
  for (const [index, [name]] of named.entries()) {
    entries[name] = hex(new Uint8Array(digests[index] ?? new ArrayBuffer(0)))
  }
  return JSON.stringify(entries)
}

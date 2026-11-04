import { normalizeUid, passUrls } from '@fuda/sdk'
import type { Hex, PassBackup } from '@fuda/sdk'
import { fetchJson } from '@fuda/sdk/http'
import type { Result } from '@fuda/sdk/http'
import * as v from 'valibot'

import { API_BASE_URL } from './config.ts'

export const fetchPassBackup = async (uid: Hex): Promise<Result<PassBackup>> =>
  await fetchJson<PassBackup>(`${passUrls(API_BASE_URL, uid).web}/backup`, { method: 'GET' })

export const passBackupHref = (uid: Hex): string => `${passUrls(API_BASE_URL, uid).web}/backup`

const BackupFile = v.object({ uid: v.string() })

// A file the member chose: only the uid is read from it, and the api then says what
// that uid is, so nothing else in the file is trusted.
export const uidFromBackupFile = (text: string): Hex | null => {
  try {
    const parsed = v.safeParse(BackupFile, JSON.parse(text))
    return parsed.success ? normalizeUid(parsed.output.uid) : null
  } catch {
    return null
  }
}

import type { Hex } from '@fuda/sdk'

// Which passes a change touches. A card or venue edit reaches every pass under it through
// one subquery, so a variable-length list never meets D1's bound parameter limit.
export type PassScope = { uid: Hex } | { cardId: string } | { issuerId: string }

const scopeFilter = (scope: PassScope): { column: string; value: string } => {
  if ('uid' in scope) {
    return { column: 'r.uid', value: scope.uid }
  }
  return 'cardId' in scope
    ? { column: 'm.card_id', value: scope.cardId }
    : { column: 'm.issuer_id', value: scope.issuerId }
}

// Wallet learns of a change from the tag, so a push sent before this commits is a push
// the device answers with "nothing changed". Only registered passes are recorded: an
// unregistered pass is downloaded fresh, so no device holds a stale copy of it.
export const recordPassChange = async (db: D1Database, scope: PassScope, now: number): Promise<void> => {
  const { column, value } = scopeFilter(scope)
  const registered = `apple_pass_registrations r
    JOIN members m ON m.attestation_uid = r.uid
    WHERE ${column} = ?1`
  await db.batch([
    // REPLACE draws a new tag from the sequence; the +1 keeps Last-Modified moving when
    // two changes land in one second.
    db
      .prepare(
        `INSERT OR REPLACE INTO apple_pass_updates (uid, updated_at)
         SELECT DISTINCT r.uid, MAX(?2, COALESCE((SELECT u.updated_at + 1 FROM apple_pass_updates u WHERE u.uid = r.uid), 0))
         FROM ${registered}`,
      )
      .bind(value, now),
    db
      .prepare(
        `UPDATE apple_pass_registrations
         SET updated_tag = (SELECT u.tag FROM apple_pass_updates u WHERE u.uid = apple_pass_registrations.uid)
         WHERE uid IN (SELECT r.uid FROM ${registered})`,
      )
      .bind(value),
  ])
}

export interface PushTarget {
  deviceId: string
  pushToken: string
}

// A device holding several passes under one card needs one push: it asks for every change
// at once. The cap keeps a large card inside the Worker's subrequest budget. A device past
// it still gets the new tag, and picks the change up the next time Wallet asks.
const MAX_PUSHES_PER_CHANGE = 200

export const pushTargets = async (db: D1Database, scope: PassScope): Promise<PushTarget[]> => {
  const { column, value } = scopeFilter(scope)
  const { results } = await db
    .prepare(
      `SELECT DISTINCT d.device_id AS deviceId, d.push_token AS pushToken
       FROM apple_pass_registrations r
       JOIN apple_pass_devices d ON d.device_id = r.device_id
       JOIN members m ON m.attestation_uid = r.uid
       WHERE ${column} = ?1
       LIMIT ${MAX_PUSHES_PER_CHANGE}`,
    )
    .bind(value)
    .all<PushTarget>()
  return results
}

// The token is matched so that a push answered "gone" cannot erase a registration the
// device made with a fresh token while that push was in flight.
export const dropDevice = async (db: D1Database, target: PushTarget): Promise<void> => {
  await db.batch([
    db
      .prepare(
        `DELETE FROM apple_pass_registrations WHERE device_id = ?1
         AND EXISTS (SELECT 1 FROM apple_pass_devices WHERE device_id = ?1 AND push_token = ?2)`,
      )
      .bind(target.deviceId, target.pushToken),
    db
      .prepare('DELETE FROM apple_pass_devices WHERE device_id = ?1 AND push_token = ?2')
      .bind(target.deviceId, target.pushToken),
  ])
}

interface Registration {
  deviceId: string
  now: number
  pushToken: string
  serial: string
  uid: Hex
}

// True for a new registration. A repeat still stores the push token, which Wallet rotates.
export const registerDevice = async (db: D1Database, registration: Registration): Promise<boolean> => {
  const { deviceId, now, pushToken, serial, uid } = registration
  const results = await db.batch([
    db
      .prepare(
        `INSERT INTO apple_pass_devices (device_id, push_token) VALUES (?1, ?2)
         ON CONFLICT (device_id) DO UPDATE SET push_token = excluded.push_token`,
      )
      .bind(deviceId, pushToken),
    db
      .prepare(
        `INSERT INTO apple_pass_updates (uid, updated_at) VALUES (?1, ?2)
         ON CONFLICT (uid) DO NOTHING`,
      )
      .bind(uid, now),
    db
      .prepare(
        `INSERT INTO apple_pass_registrations (device_id, uid, serial, updated_tag)
         SELECT ?1, ?2, ?3, tag FROM apple_pass_updates WHERE uid = ?2
         ON CONFLICT (device_id, uid) DO NOTHING`,
      )
      .bind(deviceId, uid, serial),
  ])
  return results[2]?.meta.changes === 1
}

export const unregisterDevice = async (db: D1Database, deviceId: string, uid: Hex): Promise<void> => {
  await db.batch([
    db
      .prepare('DELETE FROM apple_pass_registrations WHERE device_id = ?1 AND uid = ?2')
      .bind(deviceId, uid),
    db
      .prepare(
        `DELETE FROM apple_pass_devices WHERE device_id = ?1
         AND NOT EXISTS (SELECT 1 FROM apple_pass_registrations WHERE device_id = ?1)`,
      )
      .bind(deviceId),
  ])
}

export interface UpdatedSerials {
  lastUpdated: string
  serialNumbers: string[]
}

export const updatedSerials = async (
  db: D1Database,
  deviceId: string,
  since: number,
): Promise<UpdatedSerials | null> => {
  const { results } = await db
    .prepare(
      `SELECT serial, updated_tag AS tag FROM apple_pass_registrations
       WHERE device_id = ?1 AND updated_tag > ?2
       ORDER BY updated_tag`,
    )
    .bind(deviceId, since)
    .all<{ serial: string; tag: number }>()
  const last = results.at(-1)
  return last === undefined
    ? null
    : { lastUpdated: String(last.tag), serialNumbers: results.map(({ serial }) => serial) }
}

export const passUpdatedAt = async (db: D1Database, uid: Hex): Promise<number | null> => {
  const row = await db
    .prepare('SELECT updated_at AS updatedAt FROM apple_pass_updates WHERE uid = ?1')
    .bind(uid)
    .first<{ updatedAt: number }>()
  return row?.updatedAt ?? null
}

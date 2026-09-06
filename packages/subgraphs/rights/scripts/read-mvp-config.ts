import fs from 'node:fs'

import * as v from 'valibot'

const UID_PATTERN = /^0x[0-9a-fA-F]{64}$/u

export interface SchemaVersion {
  uid: `0x${string}`
  version: number
}

export interface MvpGraphConfig {
  schemas: {
    entitlement: SchemaVersion[]
    issuerDelegation: SchemaVersion[]
    attendance: SchemaVersion[]
  }
  announcerFromBlock: number
}

const VarsSchema = v.object({
  ANNOUNCER_FROM_BLOCK: v.string(),
  EAS_SCHEMAS: v.string(),
})
const WranglerSchema = v.object({
  env: v.optional(v.record(v.string(), v.object({ vars: VarsSchema }))),
  vars: v.optional(VarsSchema),
})
const VersionSchema = v.object({
  uid: v.pipe(v.string(), v.regex(UID_PATTERN)),
  version: v.pipe(v.number(), v.integer(), v.minValue(1)),
})
const SchemasSchema = v.object({
  attendance: v.pipe(v.array(VersionSchema), v.minLength(1)),
  entitlement: v.pipe(v.array(VersionSchema), v.minLength(1)),
  issuerDelegation: v.pipe(v.array(VersionSchema), v.minLength(1)),
})

const stripJsonComments = (source: string): string => {
  let output = ''
  let inString = false
  let escaped = false
  let lineComment = false
  let blockComment = false

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]
    const next = source[index + 1]

    if (lineComment) {
      if (character === '\n') {
        lineComment = false
        output += character
      }
      continue
    }
    if (blockComment) {
      if (character === '*' && next === '/') {
        blockComment = false
        index += 1
      } else if (character === '\n') {
        output += character
      }
      continue
    }
    if (!inString && character === '/' && next === '/') {
      lineComment = true
      index += 1
      continue
    }
    if (!inString && character === '/' && next === '*') {
      blockComment = true
      index += 1
      continue
    }

    output += character
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (character === '\\') {
        escaped = true
      } else if (character === '"') {
        inString = false
      }
    } else if (character === '"') {
      inString = true
    }
  }
  return output
}

const parseWrangler = (source: string, path: string): v.InferOutput<typeof WranglerSchema> => {
  try {
    const parsed: unknown = JSON.parse(
      stripJsonComments(source).replaceAll(/,\s*(?<closing>[}\]])/gu, '$<closing>'),
    )
    return v.parse(WranglerSchema, parsed)
  } catch (error) {
    throw new Error(`Invalid Wrangler configuration at ${path}`, { cause: error })
  }
}

const normalizeVersions = (
  family: keyof MvpGraphConfig['schemas'],
  versions: v.InferOutput<typeof VersionSchema>[],
  seenUids: Set<string>,
): SchemaVersion[] => {
  const seenVersions = new Set<number>()
  return versions.map((entry) => {
    const uid: `0x${string}` = `0x${entry.uid.slice(2).toLowerCase()}`
    if (seenUids.has(uid)) {
      throw new Error(`Duplicate EAS schema UID: ${uid}`)
    }
    if (seenVersions.has(entry.version)) {
      throw new Error(`Duplicate EAS schema version for ${family}: ${entry.version}`)
    }
    seenUids.add(uid)
    seenVersions.add(entry.version)
    return { uid, version: entry.version }
  })
}

const parseSchemas = (json: string): MvpGraphConfig['schemas'] => {
  const parsedJson: unknown = JSON.parse(json)
  const parsed = v.parse(SchemasSchema, parsedJson)
  const seenUids = new Set<string>()
  return {
    attendance: normalizeVersions('attendance', parsed.attendance, seenUids),
    entitlement: normalizeVersions('entitlement', parsed.entitlement, seenUids),
    issuerDelegation: normalizeVersions('issuerDelegation', parsed.issuerDelegation, seenUids),
  }
}

export const readMvpGraphConfig = (
  filePath: string,
  options: { environment?: string } = {},
): MvpGraphConfig => {
  const config = parseWrangler(fs.readFileSync(filePath).toString(), filePath)
  const { environment } = options
  const selectedVars = environment === undefined ? config.vars : config.env?.[environment]?.vars
  if (selectedVars === undefined) {
    throw new Error(
      environment === undefined ? 'Wrangler vars are missing' : `Wrangler env.${environment} is missing`,
    )
  }

  const announcerFromBlock = Number(selectedVars.ANNOUNCER_FROM_BLOCK)
  if (!Number.isSafeInteger(announcerFromBlock) || announcerFromBlock <= 0) {
    throw new Error('ANNOUNCER_FROM_BLOCK must be a positive integer')
  }

  return {
    announcerFromBlock,
    schemas: parseSchemas(selectedVars.EAS_SCHEMAS),
  }
}

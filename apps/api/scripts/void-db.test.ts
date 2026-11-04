import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

const cli = fileURLToPath(new URL('../node_modules/void/dist/cli/cli.mjs', import.meta.url))
const temporaryRoots: string[] = []
const fixture = (): string => {
  const root = mkdtempSync(path.join(tmpdir(), 'fuda-void-db-'))
  temporaryRoots.push(root)
  mkdirSync(path.join(root, 'db'))
  writeFileSync(
    path.join(root, '.void-wrangler.jsonc'),
    JSON.stringify({ d1_databases: [{ binding: 'DB', database_id: 'db-test' }], name: 'db-test' }),
  )
  writeFileSync(
    path.join(root, 'void.config.ts'),
    `export default { cloudflare: { name: 'db-test', d1_databases: [{ binding: 'DB', database_name: 'db-test', database_id: 'db-test', migrations_dir: 'db/migrations' }] }, inference: { bindings: { db: false } } }`,
  )
  return root
}
const run = (root: string, args: string[]): string => {
  const result = spawnSync(process.execPath, [cli, 'db', ...args], { cwd: root, encoding: 'utf-8' })
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
  return result.stdout
}

describe('Void database CLI', () => {
  afterEach(() => {
    for (const root of temporaryRoots.splice(0)) {
      rmSync(root, { force: true, recursive: true })
    }
  })

  it('applies the shared hand-written history to a fresh database and is repeatable', () => {
    const root = fixture()
    symlinkSync(fileURLToPath(new URL('../migrations', import.meta.url)), path.join(root, 'db/migrations'))
    run(root, ['migrate'])
    expect(run(root, ['migrate'])).toContain('up to date')
    expect(run(root, ['execute', "SELECT name FROM sqlite_master WHERE name = 'cards'"])).toContain('cards')
  })
})

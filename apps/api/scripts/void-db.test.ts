import { spawnSync } from 'node:child_process'
import { globSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
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
const open = (root: string): DatabaseSync => {
  const files = globSync('.void/v3/d1/**/*.sqlite', { cwd: root })
  expect(files).toHaveLength(1)
  const [file] = files
  if (file === undefined) {
    throw new Error('Void did not create its local D1 database')
  }
  return new DatabaseSync(path.join(root, file))
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

  it('adopts Wrangler history without replaying it, preserves rows, and applies only pending SQL', () => {
    const root = fixture()
    const migrations = path.join(root, 'db/migrations')
    mkdirSync(migrations)
    writeFileSync(path.join(migrations, '0001.sql'), 'CREATE TABLE records (id TEXT PRIMARY KEY);')
    run(root, ['migrate'])
    const before = open(root)
    before.exec(`
      INSERT INTO records VALUES ('existing');
      CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TEXT DEFAULT CURRENT_TIMESTAMP);
      INSERT INTO d1_migrations (name, applied_at) SELECT name, applied_at FROM _void_migrations;
      DROP TABLE _void_migrations;
    `)
    const history = before.prepare('SELECT * FROM d1_migrations').all()
    before.close()
    // A fresh checkout has no materialized config; the CLI must still reopen this DB.
    rmSync(path.join(root, '.void-wrangler.jsonc'))
    writeFileSync(path.join(migrations, '0002.sql'), 'ALTER TABLE records ADD COLUMN title TEXT;')
    run(root, ['migrate'])
    run(root, ['execute', "UPDATE records SET title = 'preserved' WHERE id = 'existing'"])
    expect(run(root, ['migrate'])).toContain('up to date')
    const after = open(root)
    try {
      expect(
        after
          .prepare('SELECT * FROM records')
          .all()
          .map((row) => ({ ...row })),
      ).toStrictEqual([{ id: 'existing', title: 'preserved' }])
      expect(after.prepare('SELECT * FROM d1_migrations').all()).toStrictEqual(history)
      expect(
        after
          .prepare('SELECT name FROM _void_migrations ORDER BY name')
          .all()
          .map((row) => ({ ...row })),
      ).toStrictEqual([{ name: '0001.sql' }, { name: '0002.sql' }])
    } finally {
      after.close()
    }
  })
})

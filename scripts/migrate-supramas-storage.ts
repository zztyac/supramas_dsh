#!/usr/bin/env node
/** Safely migrate the default SupraMAS JSON unit from storage version 1 to version 2. */

import { constants } from 'node:fs'
import { copyFile, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { migrateSupraMasStorageV1 } from '../packages/supramas/supramas/src/storage-migration.ts'
import { writeAtomic } from '../packages/storage/storage-json/src/atomic.ts'

function argumentsOf(argv: string[]): { path: string; dryRun: boolean } {
  let path = resolve(homedir(), '.dsh', 'storages', 'supramas.json')
  let dryRun = false
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--dry-run') {
      dryRun = true
      continue
    }
    if (argument === '--path') {
      const value = argv[index + 1]
      if (value === undefined) throw new Error('--path requires a file path')
      path = resolve(value)
      index += 1
      continue
    }
    throw new Error(`unknown argument ${String(argument)}`)
  }
  return { path, dryRun }
}

function backupPath(path: string): string {
  const timestamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')
  return `${path}.v1-${timestamp}.bak`
}

async function main(): Promise<void> {
  const options = argumentsOf(process.argv.slice(2))
  let text: string
  try {
    text = await readFile(options.path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      console.log(`SupraMAS storage does not exist yet: ${options.path}`)
      return
    }
    throw error
  }
  const document: unknown = JSON.parse(text)
  const unit = typeof document === 'object' && document !== null
    ? (document as Record<string, unknown>)['unit']
    : undefined
  const version = typeof unit === 'object' && unit !== null
    ? (unit as Record<string, unknown>)['version']
    : undefined
  if (version === 2) {
    console.log(`SupraMAS storage is already version 2: ${options.path}`)
    return
  }
  const migrated = migrateSupraMasStorageV1(document)
  const summary = JSON.stringify(migrated.stats)
  if (options.dryRun) {
    console.log(`Dry run succeeded for ${options.path}: ${summary}`)
    return
  }
  const backup = backupPath(options.path)
  await copyFile(options.path, backup, constants.COPYFILE_EXCL)
  try {
    await writeAtomic(options.path, `${JSON.stringify(migrated.document, null, 2)}\n`)
  } catch (error) {
    throw new Error(`migration failed; the untouched backup is ${backup}`, { cause: error })
  }
  console.log(`Migrated SupraMAS storage to version 2: ${summary}`)
  console.log(`Backup: ${backup}`)
}

await main()

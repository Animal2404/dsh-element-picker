/**
 * Syntax gate: `node --check` every script in the repository.
 *
 * The workflows are the only place these scripts ever run, so a stray broken
 * literal would otherwise burn a full cloud round-trip before anyone saw it.
 * This turns that into an immediate, precisely located failure.
 */
import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { readdir } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SKIP = new Set(['node_modules', 'lib', 'e2e-out', 'real-dsh-out', '.git'])

/**
 * @param {string} directory - Directory to walk.
 * @returns {Promise<string[]>} Script paths below it.
 */
async function walk(directory) {
  const out = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue
    const full = join(directory, entry.name)
    if (entry.isDirectory()) {
      out.push(...(await walk(full)))
      continue
    }
    if (entry.name.endsWith('.mjs') || entry.name.endsWith('.js')) out.push(full)
  }
  return out
}

const files = (await walk(root)).sort()
const failures = []

for (const file of files) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' })
  } catch (error) {
    const detail = `${error.stderr ?? ''}${error.stdout ?? ''}`.trim().split('\n').slice(0, 4).join(' | ')
    failures.push(`${relative(root, file)}: ${detail}`)
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`syntax: ${failure}`)
  throw new Error(`syntax: ${failures.length} file(s) failed to parse`)
}
console.log(`syntax: ok (${files.length} scripts parsed)`)

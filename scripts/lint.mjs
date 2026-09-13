/**
 * Static checks. No build, no browser: everything here reads text off disk, so
 * it can gate the pipeline before anything is produced.
 */
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { SOURCE_FILES, analyzeSources, readSources } from './flatten.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const failures = []

/**
 * @param {boolean} condition - Check result.
 * @param {string} message - Failure description.
 * @returns {void}
 */
function check(condition, message) {
  if (!condition) failures.push(message)
}

/**
 * @param {string} path - File path relative to the repository root.
 * @returns {Promise<string>} File text.
 */
async function read(path) {
  return readFile(join(root, path), 'utf8')
}

const pkg = JSON.parse(await read('package.json'))
const patch = await read('cordis.patch.yml')
const sources = await readSources(root)
const texts = new Map(sources.map((s) => [s.name, s.text]))

// 1. Manifest contract: the three pieces DSH reads.
check(pkg.type === 'module', 'package.json: "type" must be "module" (the host half is ESM)')
check(pkg.dsh?.bundle?.patch === './cordis.patch.yml', 'package.json: dsh.bundle.patch must point at ./cordis.patch.yml')
check(pkg.dsh?.client?.platform === 'web', 'package.json: dsh.client.platform must be "web"')
check(
  Array.isArray(pkg.dsh?.client?.inject) && pkg.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-conversation'),
  'package.json: dsh.client.inject must include @deepseek-ai/dsh-client-ui-conversation (the slot owner)',
)
check(pkg.exports?.['./client']?.default === './lib/client.js', 'package.json: exports["./client"] must default to ./lib/client.js')
check(pkg.exports?.['.']?.default === './lib/index.js', 'package.json: exports["."] must default to ./lib/index.js')

// 2. The patch file must mount exactly this package, under a stable row id.
check(patch.includes(pkg.name), 'cordis.patch.yml: must insert this package name')
check(/id:\s*element-picker/.test(patch), 'cordis.patch.yml: row id must stay "element-picker"')

// 3. Source contract for the flattener.
const analysis = analyzeSources(sources)
for (const violation of analysis.violations) failures.push(`src: ${violation}`)
check(analysis.imports.some((i) => i.from === 'react'), 'src: the browser half must require the "react" platform module')
check(
  !analysis.imports.some((i) => i.from.startsWith('@deepseek-ai/')),
  'src: cross-plugin imports are forbidden (the client bundle purity rule); use the slot props instead',
)

// 4. Browser-only code: no Node globals, no network.
for (const [name, text] of texts) {
  check(!/\brequire\s*\(/.test(text), `src/${name}: uses require(); only the generated bundle may`)
  check(!/\bfetch\s*\(/.test(text), `src/${name}: must not perform network access`)
  check(!/\bprocess\./.test(text), `src/${name}: must not read Node process state`)
  check(!/[A-Za-z]:[\\/](DeepSeek|Users)/.test(text), `src/${name}: contains a local absolute path`)
}

// 5. Overlay styles stay namespaced and non-invasive.
const css = texts.get('styles.js') ?? ''
check(!/!important/.test(css), 'src/styles.js: must not use !important (no fighting the app styles)')
for (const [index, line] of css.split('\n').entries()) {
  const isSelector = line.trim().endsWith('{') && !line.trim().startsWith('@')
  if (!isSelector) continue
  const namespaced = line.includes('#dsh-element-picker-root') || line.includes('[data-dsh-picker')
  check(namespaced, `src/styles.js:${index + 1}: selector is not namespaced: ${line.trim()}`)
}

// 6. The entry must export exactly what the loader wrapper publishes.
const entry = texts.get('plugin.js') ?? ''
check(/^export\s+function\s+apply\s*\(/m.test(entry), 'src/plugin.js: must export function apply(ctx)')
check(/^export\s+const\s+inject\s*=/m.test(entry), 'src/plugin.js: must export const inject')
check(entry.includes('conversation.input.left'), 'src/plugin.js: must register into conversation.input.left')
check(entry.includes('data-composer-input') === false, 'src/plugin.js: the composer selector belongs in insert.js')

// 7. Every declared source file must exist and be listed.
check(SOURCE_FILES.length === sources.length, 'scripts/flatten.mjs: SOURCE_FILES does not match the loaded sources')

if (failures.length > 0) {
  for (const failure of failures) console.error(`lint: ${failure}`)
  throw new Error(`lint: ${failures.length} failure(s)`)
}
console.log(`lint: ok (${sources.length} source files, ${analysis.declared.size} top-level symbols)`)

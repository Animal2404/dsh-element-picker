/**
 * Static verification of the built artifact, run by CI between build and test.
 * Fails loudly when the produced bundle cannot be what DSH expects.
 */
import { readFile, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

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

const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const client = await readFile(join(root, 'lib', 'client.js'), 'utf8')
const host = await readFile(join(root, 'lib', 'index.js'), 'utf8')
const info = JSON.parse(await readFile(join(root, 'lib', 'build-info.json'), 'utf8'))

check(client.startsWith('window.__ModuleLoader__.load({ id: '), 'lib/client.js: must open with the loader call')
check(client.includes(`"${pkg.name}"`), `lib/client.js: loader id must be ${pkg.name}`)
check(client.trimEnd().endsWith('});'), 'lib/client.js: must close the loader call')
check(/exports\.apply\s*=\s*apply/.test(client), 'lib/client.js: must publish apply')
check(/exports\.inject\s*=\s*inject/.test(client), 'lib/client.js: must publish inject')
check(!/^\s*(import|export)\s/m.test(client), 'lib/client.js: still contains ESM syntax')
check(client.includes('require("react")'), 'lib/client.js: must require the react platform module')
check(!client.includes("require('./"), 'lib/client.js: relative requires must be flattened away')
check(client.includes('[data-composer-input]'), 'lib/client.js: must carry the composer selector')
check(client.includes('data-dsh-picker-ui'), 'lib/client.js: must carry the overlay marker')
check(client.includes('conversation.input.left'), 'lib/client.js: must register the composer tool row slot')
check(host.includes(`export const name = "${pkg.name}"`), 'lib/index.js: must declare the plugin name')
check(host.includes('export function apply'), 'lib/index.js: must export apply for the host loader')
check(info.moduleId === pkg.name, 'lib/build-info.json: moduleId must equal the package name')
check(info.version === pkg.version, 'lib/build-info.json: version must equal the package version')
check(typeof info.sourceHash === 'string' && info.sourceHash.length === 16, 'lib/build-info.json: sourceHash must be a 16-char digest')

const clientSize = (await stat(join(root, 'lib', 'client.js'))).size
check(clientSize > 2000, `lib/client.js: suspiciously small (${clientSize} bytes)`)

if (failures.length > 0) {
  for (const failure of failures) console.error(`verify-bundle: ${failure}`)
  throw new Error(`verify-bundle: ${failures.length} failure(s)`)
}
console.log(`verify-bundle: ok (client.js ${clientSize} bytes, sourceHash ${info.sourceHash})`)

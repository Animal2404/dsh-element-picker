/**
 * Source flattening shared by the build, the lint pass, and the bundle test.
 *
 * The shipped `lib/client.js` must be a *classic* script in DSH's loader format
 * (one `window.__ModuleLoader__.load({ id, factory })` call), because the client
 * module system serves it as a same-origin classic script — not an ES module.
 * The DSH repository builds this shape with an internal preset that is not
 * published, so this repository reproduces the shape with a deliberately small
 * flattener instead of a general bundler:
 *
 *   - every source file uses single-line `import ... from '...'` statements and
 *     `export <declaration>` at the top level, nothing else;
 *   - flattening strips the import lines, rewrites the `react` import into a
 *     `require('react')` call, drops the `export` keywords, and concatenates in
 *     dependency order;
 *   - top-level declaration names must be globally unique, which the analyzer
 *     enforces rather than hoping for.
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Source files in dependency order (each may only use names declared above it).
 */
export const SOURCE_FILES = [
  'styles.js',
  'selector.js',
  'hooks-map.js',
  'describe.js',
  'insert.js',
  'chip.js',
  'transcript.js',
  'overlay.js',
  'plugin.js',
]

/** Platform modules the loader resolves for the bundle. */
export const EXTERNAL_MODULES = ['react']

/** Prefix of the generated loader wrapper. */
export const LOADER_PREFIX = 'window.__ModuleLoader__.load({ id: '

/** Top-level declaration pattern (handles `export const|function|class`). */
const DECLARATION_RE =
  /^(?:export\s+)?(?:async\s+)?(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/

/** Import statement pattern: single line, named or default. */
const IMPORT_RE = /^\s*import\s+(.+?)\s+from\s+['"](.+?)['"]\s*$/

/**
 * @param {string} root - Repository root.
 * @returns {Promise<{ name: string, text: string }[]>} Sources in bundle order.
 */
export async function readSources(root) {
  const out = []
  for (const name of SOURCE_FILES) {
    out.push({ name, text: await readFile(join(root, 'src', name), 'utf8') })
  }
  return out
}

/**
 * Analyse the sources without transforming them.
 *
 * @param {{ name: string, text: string }[]} sources - Sources in bundle order.
 * @returns {{ declared: Map<string, string>, imports: { file: string, clause: string, from: string }[], violations: string[] }}
 *   Declared top-level names, import statements, and any contract violations.
 */
export function analyzeSources(sources) {
  const declared = new Map()
  const imports = []
  const violations = []

  for (const { name, text } of sources) {
    const lines = text.split('\n')
    for (const [index, line] of lines.entries()) {
      const where = `${name}:${index + 1}`

      if (/^\s*export\s*\{/.test(line) || /^\s*export\s+default\b/.test(line) || /^\s*export\s*\*/.test(line)) {
        violations.push(`${where}: only \`export <declaration>\` is supported`)
      }

      const importMatch = IMPORT_RE.exec(line)
      if (importMatch !== null) {
        imports.push({ file: name, clause: importMatch[1], from: importMatch[2] })
        if (/^\s*import\s*\(/.test(line)) {
          violations.push(`${where}: dynamic import is not supported`)
        }
        continue
      }
      if (/^\s*import\s/.test(line)) {
        violations.push(`${where}: multi-line import; keep imports on one line`)
        continue
      }

      const declaredMatch = DECLARATION_RE.exec(line)
      if (declaredMatch !== null) {
        const symbol = declaredMatch[1]
        const previous = declared.get(symbol)
        if (previous !== undefined && previous !== name) {
          violations.push(
            `${where}: top-level name "${symbol}" collides with ${previous}; flattening would shadow it`,
          )
        } else {
          declared.set(symbol, name)
        }
      }
    }
  }

  return { declared, imports, violations }
}

/**
 * Flatten the sources into a classic script for the DSH loader.
 *
 * @param {{ name: string, text: string }[]} sources - Sources in bundle order.
 * @param {string} moduleId - The package id the loader keys the factory by.
 * @returns {{ code: string, declared: string[] }} The bundle text and its
 *   top-level names.
 */
export function buildClientBundle(sources, moduleId) {
  const chunks = []
  for (const { text } of sources) {
    const lines = []
    for (const line of text.split('\n')) {
      const importMatch = IMPORT_RE.exec(line)
      if (importMatch !== null) {
        const [, clause, from] = importMatch
        if (!EXTERNAL_MODULES.includes(from)) continue // relative: flattened away
        if (clause.trim() === 'React') {
          lines.push(`const React = require(${JSON.stringify(from)})`)
          continue
        }
        lines.push(`const ${clause.trim()} = require(${JSON.stringify(from)})`)
        continue
      }
      lines.push(line.startsWith('export ') ? line.slice('export '.length) : line)
    }
    chunks.push(`\t//#region ${moduleId}/src\n${lines.join('\n').replace(/^\t/gm, '\t\t')}`)
  }

  const code = [
    `${LOADER_PREFIX}${JSON.stringify(moduleId)},`,
    '\tfactory: (require) => {',
    '\t\tvar module = { exports: {} };',
    '\t\tvar exports = module.exports;',
    '',
    chunks.join('\n\n'),
    '',
    '\t\texports.apply = apply;',
    '\t\texports.inject = inject;',
    '\t\treturn module.exports;',
    '\t},',
    '});',
    '',
  ].join('\n')

  return { code, declared: [...analyzeSources(sources).declared.keys()] }
}

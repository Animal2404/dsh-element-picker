/**
 * Loader-contract test: the built artifact must be loadable the way DSH loads
 * it, and `apply()` must register into the composer tool row.
 *
 * Runs against `lib/client.js`, so the CI job order is lint -> build -> verify
 * -> test.
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import { createDocument, createWindow } from './helpers/dom-stub.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const bundle = await readFile(join(root, 'lib', 'client.js'), 'utf8')

/**
 * Load the bundle the way the DSH client module system does: a classic script
 * that calls `window.__ModuleLoader__.load(...)` exactly once.
 *
 * @returns {{ id: string, factory: (require: (id: string) => unknown) => object }}
 *   The captured loader definition.
 */
function loadBundle() {
  const doc = createDocument()
  const win = createWindow(doc)
  let captured = null
  win.__ModuleLoader__ = {
    load(definition) {
      captured = definition
    },
  }

  vm.runInNewContext(bundle, { window: win, console })

  assert.notEqual(captured, null, 'the bundle must call window.__ModuleLoader__.load')
  return captured
}

test('the artifact is one loader call keyed by the package name', () => {
  assert.equal(bundle.startsWith('window.__ModuleLoader__.load({ id: '), true)
  assert.equal(bundle.includes(`"${pkg.name}"`), true)
  assert.equal(bundle.trimEnd().endsWith('});'), true)
  assert.equal(bundle.includes('module.exports'), true)
})

test('flattening left no ESM syntax behind', () => {
  assert.equal(/^\s*import\s/m.test(bundle), false, 'no import statements may survive')
  assert.equal(/^\s*export\s/m.test(bundle), false, 'no export statements may survive')
  assert.equal(bundle.includes('require("react")'), true, 'react is required, not bundled')
})

test('the factory publishes apply and inject and requires only platform modules', () => {
  const definition = loadBundle()
  const required = []
  const exports = definition.factory((id) => {
    required.push(id)
    return { createElement: () => ({}), useState: () => [], useEffect: () => {}, useCallback: (fn) => fn }
  })

  assert.deepEqual(required, ['react'])
  assert.equal(typeof exports.apply, 'function')
  assert.deepEqual(
    [...exports.inject],
    ['slots', 'inputTriggers', 'conversation', 'sessions'],
    'every guarded service the picker touches must be declared',
  )
})

test('apply registers a fresh entry in the composer tool row', () => {
  const definition = loadBundle()
  const exports = definition.factory(() => ({}))

  const injected = []
  const registered = []
  const effects = []
  const ctx = {
    slots: {
      inject(name, build) {
        injected.push(name)
        return build()
      },
      register(options, component) {
        registered.push({ options, component })
        return () => {}
      },
    },
    effect(fn, label) {
      effects.push({ fn, label })
      return () => {}
    },
  }

  exports.apply(ctx)

  assert.deepEqual(injected, ['sidebar.footer.action'])
  assert.equal(registered.length, 1)
  assert.equal(registered[0].options.name, 'sidebar.footer.action')
  assert.equal(registered[0].options.order, 11, 'it must sort just after the Bash widget (order 10)')
  assert.equal(registered[0].options.id, 'element-picker')
  assert.equal(registered[0].options.label, '选择元素')
  assert.equal(typeof registered[0].component, 'function')
  assert.equal(effects.length, 1)
  assert.match(effects[0].label, /dsh-element-picker/)
})

test('the overlay and the stylesheet are installed by apply, and disposed by the effect', () => {
  const doc = createDocument()
  const win = createWindow(doc)
  let captured = null
  win.__ModuleLoader__ = { load: (definition) => { captured = definition } }
  vm.runInNewContext(bundle, { window: win, console })

  const exports = captured.factory(() => ({}))
  const teardowns = []
  exports.apply({
    slots: { inject: (_name, build) => build(), register: () => () => {} },
    effect: (fn) => {
      teardowns.push(fn)
      return () => {}
    },
  })

  assert.equal(doc.getElementById('dsh-element-picker-style') !== null, true, 'styles installed')
  assert.equal(doc.querySelectorAll('[data-dsh-picker-ui="root"]').length, 1, 'overlay mounted')
  assert.equal(doc.querySelectorAll('[data-dsh-picker-ui="highlight"]').length, 1, 'highlight mounted')
  assert.equal(
    doc.querySelectorAll('[data-dsh-picker-ui="button"]').length,
    0,
    'the overlay must own no button of its own',
  )

  // `ctx.effect(fn)` runs fn, and the function fn returns is the disposer.
  for (const register of teardowns) {
    const dispose = register()
    if (typeof dispose === 'function') dispose()
  }
  assert.equal(doc.getElementById('dsh-element-picker-style'), null, 'styles removed on dispose')
  assert.equal(doc.querySelectorAll('[data-dsh-picker-ui="root"]').length, 0, 'overlay removed on dispose')
})

/**
 * The insertion cascade: which path is chosen, what is verified, and what
 * happens when a path lies about succeeding.
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { createDocument } from './helpers/dom-stub.mjs'
import { DEFAULT_PATHS, findComposerInput, insertBlock } from '../src/insert.js'

const BLOCK = '[元素] button "发送"\n[选择器] button[aria-label="发送消息"]\n'

/** DataTransfer stand-in: the payload has to survive to the listener. */
class FakeDataTransfer {
  constructor() {
    this.data = {}
  }

  setData(type, value) {
    this.data[type] = value
  }
}

/** ClipboardEvent stand-in that honours the init dict (spec behaviour). */
class FakeClipboardEvent {
  constructor(type, init = {}) {
    this.type = type
    this.defaultPrevented = false
    this.clipboardData = init.clipboardData ?? null
  }

  preventDefault() {
    this.defaultPrevented = true
  }
}

/** ClipboardEvent stand-in that DROPS clipboardData (Chromium's old behaviour). */
class DroppingClipboardEvent {
  constructor(type) {
    this.type = type
    this.defaultPrevented = false
    this.clipboardData = null
  }

  preventDefault() {
    this.defaultPrevented = true
  }
}

/** InputEvent stand-in for the beforeinput route. */
class FakeInputEvent {
  constructor(type, init = {}) {
    this.type = type
    this.data = init.data
    this.inputType = init.inputType
    this.defaultPrevented = false
  }

  preventDefault() {
    this.defaultPrevented = true
  }
}

/**
 * Build a document with a Lexical-shaped composer input.
 *
 * @param {object} [options] - Stub options.
 * @param {boolean} [options.composer] - Include the composer input.
 * @returns {{ doc: object, input: object | null }} Fixture pieces.
 */
function fixture(options = {}) {
  const doc = createDocument()
  if (options.composer === false) return { doc, input: null }

  const input = doc.createElement('div')
  input.setAttribute('data-composer-input', '')
  input.setAttribute('contenteditable', 'true')
  doc.body.appendChild(input)
  return { doc, input }
}

test('the documented cascade is paste, then dom, then setDraft', () => {
  assert.deepEqual(DEFAULT_PATHS, ['paste', 'dom', 'setDraft'])
})

test('the shell paste path wins when the build exposes it', () => {
  const { doc } = fixture()
  const seen = []
  const result = insertBlock({
    text: BLOCK,
    doc,
    draft: 'kept',
    inputActions: { paste: (text) => seen.push(text), setDraft: () => assert.fail('setDraft must not run') },
  })

  assert.equal(result.ok, true)
  assert.equal(result.path, 'paste')
  assert.deepEqual(seen, [BLOCK])
})

test('the dom path drives the editable and places a caret first', () => {
  const { doc, input } = fixture()
  doc.exec.run = (command, text) => {
    assert.equal(command, 'insertText')
    input.textContent += text
    return true
  }

  const result = insertBlock({
    text: BLOCK,
    doc,
    draft: '',
    inputActions: { setDraft: () => assert.fail('setDraft must not run') },
  })

  assert.equal(result.ok, true)
  assert.equal(result.path, 'dom')
  assert.match(result.note, /caret=placed/)
  assert.equal(result.note.includes('routes[execCommand:ok]'), true, result.note)
  assert.equal(input.textContent.includes('[元素] button "发送"'), true)
  assert.equal(doc.selection.node, input, 'the caret must be inside the editor')
})

test('a refused execCommand falls through to a synthetic paste event', () => {
  const { doc, input } = fixture()
  doc.exec.run = () => false
  input.addEventListener('paste', (event) => {
    event.preventDefault()
    assert.equal(event.clipboardData.data['text/plain'], BLOCK, 'the payload must be text/plain')
    input.textContent += event.clipboardData.data['text/plain']
  })

  const result = insertBlock({
    text: BLOCK,
    doc,
    draft: '',
    win: { DataTransfer: FakeDataTransfer, ClipboardEvent: FakeClipboardEvent },
    inputActions: { setDraft: () => assert.fail('setDraft must not run') },
  })

  assert.equal(result.ok, true)
  assert.equal(result.path, 'dom')
  assert.equal(result.note.includes('routes[execCommand:refused, paste-event:ok]'), true, result.note)
})

test('the paste payload survives a constructor that drops clipboardData', () => {
  const { doc, input } = fixture()
  doc.exec.run = () => false
  input.addEventListener('paste', (event) => {
    event.preventDefault()
    input.textContent += event.clipboardData.data['text/plain']
  })

  const result = insertBlock({
    text: BLOCK,
    doc,
    draft: '',
    win: { DataTransfer: FakeDataTransfer, ClipboardEvent: DroppingClipboardEvent },
    inputActions: { setDraft: () => assert.fail('setDraft must not run') },
  })

  assert.equal(result.path, 'dom')
  assert.equal(result.note.includes('routes[execCommand:refused, paste-event:ok]'), true, result.note)
})

test('beforeinput is the last DOM route', () => {
  const { doc, input } = fixture()
  doc.exec.run = () => false
  input.addEventListener('beforeinput', (event) => {
    event.preventDefault()
    input.textContent += event.data
  })

  const result = insertBlock({
    text: BLOCK,
    doc,
    draft: '',
    win: { InputEvent: FakeInputEvent },
    inputActions: { setDraft: () => assert.fail('setDraft must not run') },
  })

  assert.equal(result.ok, true)
  assert.equal(result.path, 'dom')
  assert.equal(
    result.note.includes('routes[execCommand:refused, paste-event:refused, beforeinput:ok]'),
    true,
    result.note,
  )
})

test('a dom route that reports success without changing the editor is rejected', () => {
  const { doc } = fixture()
  doc.exec.run = () => true // claims success, changes nothing
  const drafts = []

  const result = insertBlock({
    text: BLOCK,
    doc,
    draft: 'draft>',
    inputActions: { setDraft: (next) => drafts.push(next) },
  })

  assert.equal(result.path, 'setDraft', 'the unverified dom attempt must not be trusted')
  assert.deepEqual(drafts, [`draft>${BLOCK}`])
  assert.match(result.tried[1].error, /applied-but-no-text/)
})

test('setDraft is the last resort and preserves the existing draft', () => {
  const { doc } = fixture({ composer: false })
  const drafts = []

  const result = insertBlock({
    text: BLOCK,
    doc,
    draft: 'existing text ',
    inputActions: { setDraft: (next) => drafts.push(next) },
  })

  assert.equal(result.ok, true)
  assert.equal(result.path, 'setDraft')
  assert.equal(drafts[0], `existing text ${BLOCK}`)
})

test('an empty draft is treated as empty, not as the string "undefined"', () => {
  const { doc } = fixture({ composer: false })
  let written = null
  insertBlock({ text: BLOCK, doc, draft: undefined, inputActions: { setDraft: (next) => { written = next } } })
  assert.equal(written, BLOCK)
})

test('each failure is recorded when nothing can insert', () => {
  const { doc } = fixture({ composer: false })
  const result = insertBlock({ text: BLOCK, doc })

  assert.equal(result.ok, false)
  assert.equal(result.tried.length, 3)
  assert.match(result.tried[0].error, /paste is not exposed/)
  assert.match(result.tried[1].error, /composer input not found/)
  assert.match(result.tried[2].error, /setDraft is not available/)
})

test('the dom failure names every route it tried', () => {
  const { doc } = fixture()
  const result = insertBlock({ text: BLOCK, doc, paths: ['dom'] })

  assert.equal(result.ok, false)
  assert.match(result.tried[0].error, /dom routes exhausted/)
  assert.match(result.tried[0].error, /execCommand:refused/)
  assert.match(result.tried[0].error, /paste-event:refused/)
  assert.match(result.tried[0].error, /beforeinput:refused/)
})

test('a non-editable input is refused rather than written into', () => {
  const { doc, input } = fixture()
  input.setAttribute('contenteditable', 'false')

  const result = insertBlock({ text: BLOCK, doc, paths: ['dom'] })
  assert.equal(result.ok, false)
  assert.match(result.tried[0].error, /not editable/)
})

test('the composer lookup returns the last live input', () => {
  const { doc } = fixture()
  const second = doc.createElement('div')
  second.setAttribute('data-composer-input', '')
  doc.body.appendChild(second)

  assert.equal(findComposerInput(doc), second, 'the last composer input is the live one')
  assert.equal(findComposerInput(createDocument()), null)
})

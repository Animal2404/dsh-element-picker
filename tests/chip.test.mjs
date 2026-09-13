/**
 * Chip insertion: the DSH-native shape for a pick. The chip is compact in the
 * composer and its codec expands it into the locating block at submit time, so
 * these tests pin both halves — the registration that makes serialization
 * possible, and the guarded insertion that must fall back cleanly when any part
 * of the pipeline is missing.
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { createDocument, createEvent, createWindow } from './helpers/dom-stub.mjs'
import {
  CHIP_REMOVE_MARKER,
  CHIP_SOURCE,
  chipLabel,
  decorateChips,
  insertElementChip,
  registerChipSource,
  removeChipElement,
} from '../src/chip.js'

/** The single-line block a chip carries. */
const BLOCK = '[元素] button "发送" ｜ [选择器] button.x ｜ [源码] …/InputBar.tsx'

/**
 * Build a document with an editable holding one picker chip.
 *
 * @returns {{ doc: object, win: object, input: object, chip: object }} Fixture.
 */
function chipFixture() {
  const doc = createDocument()
  const win = createWindow(doc)
  win.KeyboardEvent = class StubKeyboardEvent {
    constructor(type, init = {}) {
      this.type = type
      Object.assign(this, init)
    }
  }
  const input = doc.createElement('div')
  input.setAttribute('data-composer-input', '')
  input.setAttribute('contenteditable', 'true')
  const chip = doc.createElement('span')
  chip.setAttribute('data-composer-chip', CHIP_SOURCE)
  input.appendChild(chip)
  doc.body.appendChild(input)
  return { doc, win, input, chip }
}

/**
 * Build a context stub with a working session, facade, and trigger registry.
 *
 * @param {object} [overrides] - Per-part replacements.
 * @returns {{ ctx: object, calls: object, facade: object }} Stubs.
 */
function stubs(overrides = {}) {
  const calls = { registered: [], inserted: [] }
  const facade = {
    state: { getSnapshot: () => ({ draftRev: 7, draft: 'draft text' }) },
    caretSpan: () => ({ start: 11, end: 11 }),
    insertReference: (ref, span) => {
      calls.inserted.push({ ref, span })
      return true
    },
    ...overrides.facade,
  }
  const ctx = {
    sessions: { scope: (id) => ({ id }) },
    conversation: { input: { for: (actx) => (actx === undefined || actx === null ? undefined : facade) } },
    inputTriggers: {
      registerSource: (source) => {
        calls.registered.push(source)
        return () => {}
      },
    },
    ...overrides.ctx,
  }
  return { ctx, calls, facade }
}

test('the chip source is registered with a codec that expands the block', async () => {
  const { ctx, calls } = stubs()
  assert.equal(registerChipSource(ctx), true)
  assert.equal(calls.registered.length, 1)

  const source = calls.registered[0]
  assert.equal(source.name, CHIP_SOURCE)
  assert.equal(source.trigger, '@')
  assert.deepEqual(await source.candidates(), [], 'the source is inert in the @ menu')

  const block = '[元素] button "发送" ｜ [选择器] button.x ｜ [源码] …/InputBar.tsx'
  assert.equal(source.codec.clipboardText(block), block)
  assert.equal(await source.codec.serialize(block), block, 'the model receives the block, not the label')
})

test('registering without a trigger registry reports failure instead of throwing', () => {
  assert.equal(registerChipSource(undefined), false)
  assert.equal(registerChipSource({}), false)
  assert.equal(
    registerChipSource({ inputTriggers: { registerSource: () => { throw new Error('nope') } } }),
    false,
  )
})

test('a chip is inserted with the block as both ref and clipboard text', () => {
  const { ctx, calls } = stubs()
  const events = []
  const result = insertElementChip({
    ctx,
    sessionId: 'session-1',
    text: '[元素] button "发送"',
    label: '元素 button「发送」',
    onEvent: (message) => events.push(message),
  })

  assert.equal(result, 'chip')
  assert.equal(calls.inserted.length, 1)
  const { ref, span } = calls.inserted[0]
  assert.equal(ref.source, CHIP_SOURCE)
  assert.equal(ref.ref, '[元素] button "发送"')
  assert.equal(ref.clipboardText, ref.ref)
  assert.equal(ref.label, '元素 button「发送」')
  assert.deepEqual(span, { start: 11, end: 11, draftRev: 7 }, 'the span is guarded by the published revision')
  assert.deepEqual(events, [])
})

test('without a caret accessor the chip anchors at the end of the draft', () => {
  const { ctx, calls } = stubs({ facade: { caretSpan: undefined } })
  assert.equal(insertElementChip({ ctx, sessionId: 's', text: 'block', label: 'l' }), 'chip')
  assert.deepEqual(calls.inserted[0].span, { start: 10, end: 10, draftRev: 7 })
})

test('a refused chip is reported, not forced', () => {
  const { ctx, calls } = stubs({ facade: { insertReference: () => false } })
  const events = []
  assert.equal(insertElementChip({ ctx, sessionId: 's', text: 'b', label: 'l', onEvent: (m) => events.push(m) }), null)
  assert.equal(calls.inserted.length, 0)
  assert.match(events.join(' '), /phase or revision guard/)
})

test('every missing piece of the pipeline falls back with a reason', () => {
  const cases = [
    [{ ctx: undefined, sessionId: 's' }, /no session-bound context/],
    [{ ctx: stubs().ctx, sessionId: undefined }, /no session-bound context/],
    [{ ctx: { sessions: { scope: () => undefined }, conversation: {} }, sessionId: 's' }, /no session scope/],
    [{ ctx: { sessions: { scope: () => ({}) }, conversation: { input: {} } }, sessionId: 's' }, /facade is unavailable/],
    [
      { ctx: stubs({ facade: { state: { getSnapshot: () => ({}) } } }).ctx, sessionId: 's' },
      /no published draft revision/,
    ],
  ]
  for (const [options, expected] of cases) {
    const events = []
    const result = insertElementChip({ ...options, text: 'b', label: 'l', onEvent: (m) => events.push(m) })
    assert.equal(result, null, JSON.stringify(options))
    assert.match(events.join(' '), expected)
  }
})

test('a throwing pipeline is contained, never propagated', () => {
  const { ctx } = stubs({ facade: { insertReference: () => { throw new Error('boom') } } })
  const events = []
  assert.equal(insertElementChip({ ctx, sessionId: 's', text: 'b', label: 'l', onEvent: (m) => events.push(m) }), null)
  assert.match(events.join(' '), /boom/)
})

test('the chip label names the tag and clips long text', () => {
  const doc = createDocument()
  const short = doc.createElement('button')
  short.textContent = '发送'
  assert.equal(chipLabel(short), '元素 button「发送」')

  const long = doc.createElement('div')
  long.textContent = 'x'.repeat(120)
  const label = chipLabel(long)
  assert.equal(label.endsWith('…」'), true)
  assert.equal(label.length < 70, true)

  const empty = doc.createElement('section')
  assert.equal(chipLabel(empty), '元素 section')
})

test('a chip gains an × that swallows the editor event', () => {
  const { doc, chip } = chipFixture()
  const removed = []

  assert.equal(decorateChips({ doc, onRemove: (element) => removed.push(element) }), 1)
  const button = chip.querySelector(`[${CHIP_REMOVE_MARKER}]`)
  assert.equal(button.textContent, '×')
  assert.equal(button.getAttribute('contenteditable'), 'false')
  assert.equal(button.getAttribute('aria-label'), '移除该元素')
  assert.equal(decorateChips({ doc, onRemove: () => {} }), 0, 'decoration must be idempotent')

  const event = createEvent('click')
  button.dispatchEvent(event)
  assert.deepEqual(removed, [chip], 'the × reports the chip it belongs to')
  assert.equal(event.prevented, true, 'the editor must not also act on the click')
  assert.equal(event.stopped, true)
})

test('removal uses the editor gesture when the editor honours it', () => {
  const { doc, win, input, chip } = chipFixture()
  input.addEventListener('keydown', (event) => {
    assert.equal(event.key, 'Backspace')
    chip.remove()
  })

  assert.equal(removeChipElement({ doc, win, chip }), 'backspace')
})

test('removal falls back to the facade when the editor ignores the gesture', () => {
  const { doc, win, chip } = chipFixture()
  const drafts = []
  const facade = {
    state: { getSnapshot: () => ({ draft: `draft text ${BLOCK}` }) },
    setDraft: (text) => {
      drafts.push(text)
      chip.remove()
    },
  }

  assert.equal(removeChipElement({ doc, win, chip, facade, blockText: BLOCK }), 'setDraft')
  assert.deepEqual(drafts, ['draft text '], 'only the chip line is dropped')
})

test('removal reports failure instead of pretending', () => {
  const { doc, win, chip } = chipFixture()
  const events = []

  assert.equal(removeChipElement({ doc, win, chip, onEvent: (message) => events.push(message) }), null)
  assert.match(events.join(' '), /ignored a synthetic Backspace/)
  assert.match(events.join(' '), /could not be removed/)
})

test('removal is a no-op when no picker chip is present', () => {
  const doc = createDocument()
  const win = createWindow(doc)
  const orphan = doc.createElement('span')
  const events = []

  assert.equal(removeChipElement({ doc, win, chip: orphan, onEvent: (m) => events.push(m) }), null)
  assert.match(events.join(' '), /no picker chip is present/)
})

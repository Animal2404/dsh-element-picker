/**
 * Chip lifecycle: the chip is the DSH-native shape for a pick (compact in the
 * composer, expanded by its codec on send), and it carries its own remove
 * affordance. These tests pin the three halves — registration/insertion, the
 * remove hit region, and the removal itself, which must delete exactly one chip
 * and never rewrite the draft.
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { createDocument, createEvent, createWindow } from './helpers/dom-stub.mjs'
import {
  CHIP_SELECTOR,
  parsePreviewItems,
  GROUP_LABEL_PREFIX,
  groupElementChips,
  buildGroupPayload,
  CHIP_SOURCE,
  REMOVE_ZONE_PX,
  chipIndexOf,
  chipLabel,
  chipPayloadOf,
  chipSpan,
  insertElementChip,
  registerChipSource,
  removeAllChips,
  removeChipElement,
  removePreviewItem,
  watchChipRemoval,
} from '../src/chip.js'

/** The single-line block a chip carries. */
const BLOCK = '[元素] button "发送" ｜ [选择器] button.x ｜ [源码] …/InputBar.tsx'

/**
 * @param {object} target - Window or document stub.
 * @param {string} type - Event type.
 * @param {object} event - Event object.
 * @returns {void}
 */
function fire(target, type, event) {
  for (const handler of target.listeners.get(`${type}:capture`) ?? []) handler(event)
}

/**
 * Build a document with an editable holding the given chips.
 *
 * @param {number} [count] - How many picker chips to create.
 * @returns {{ doc: object, win: object, input: object, chips: object[] }} Fixture.
 */
function fixture(count = 1) {
  const doc = createDocument()
  const win = createWindow(doc)
  const input = doc.createElement('div')
  input.setAttribute('data-composer-input', '')
  input.setAttribute('contenteditable', 'true')
  doc.body.appendChild(input)

  const chips = []
  for (let index = 0; index < count; index += 1) {
    const chip = doc.createElement('span')
    chip.setAttribute('data-composer-chip', CHIP_SOURCE)
    input.appendChild(chip)
    chips.push(chip)
  }
  return { doc, win, input, chips }
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

  assert.equal(source.codec.clipboardText(BLOCK), BLOCK)
  assert.equal(await source.codec.serialize(BLOCK), BLOCK, 'the model receives the block, not the label')
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
    text: BLOCK,
    label: '元素 button「发送」',
    onEvent: (message) => events.push(message),
  })

  assert.equal(result, 'chip')
  assert.equal(calls.inserted.length, 1)
  const { ref, span } = calls.inserted[0]
  assert.equal(ref.source, CHIP_SOURCE)
  assert.equal(ref.ref, BLOCK)
  assert.equal(ref.clipboardText, BLOCK)
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

test('a chip is located in the composer order, not just among our own', () => {
  const doc = createDocument()
  const input = doc.createElement('div')
  input.setAttribute('data-composer-input', '')
  doc.body.appendChild(input)

  const foreign = doc.createElement('span')
  foreign.setAttribute('data-composer-chip', 'reference')
  input.appendChild(foreign)
  const ours = doc.createElement('span')
  ours.setAttribute('data-composer-chip', CHIP_SOURCE)
  input.appendChild(ours)

  assert.equal(chipIndexOf(doc, foreign), 0, 'a user chip still counts towards the index')
  assert.equal(chipIndexOf(doc, ours), 1)
  assert.equal(chipIndexOf(doc, doc.createElement('span')), -1)
})

test('a chip span is derived from the published occurrences', () => {
  // Occurrences are clipboard coordinates; every chip occupies one detect char.
  const occurrences = [
    { offset: 0, length: 10 },
    { offset: 12, length: 4 },
  ]
  assert.deepEqual(chipSpan(occurrences, 0, 7), { start: 0, end: 1, draftRev: 7 })
  assert.deepEqual(chipSpan(occurrences, 1, 7), { start: 3, end: 4, draftRev: 7 })
  assert.equal(chipSpan(occurrences, 2, 7), null, 'out of range')
  assert.equal(chipSpan(occurrences, 0, undefined), null, 'no revision to guard with')
  assert.equal(chipSpan(undefined, 0, 7), null)
})

test('a click in the chip remove zone reports that chip and is swallowed', () => {
  const { doc, win, chips } = fixture(1)
  const chip = chips[0]
  chip.getBoundingClientRect = () => ({ left: 100, top: 50, right: 200, bottom: 70, width: 100, height: 20 })
  const removed = []
  const stop = watchChipRemoval({ doc, win, onRemove: (element) => removed.push(element) })

  const inZone = createEvent('mousedown', { target: chip, clientX: 200 - REMOVE_ZONE_PX + 2, clientY: 60 })
  fire(win, 'mousedown', inZone)
  assert.deepEqual(removed, [chip])
  assert.equal(inZone.prevented, true, 'the editor must not also handle the click')
  assert.equal(inZone.stopped, true)
  stop()
})

test('a click elsewhere on the chip belongs to the editor', () => {
  const { doc, win, chips } = fixture(1)
  const chip = chips[0]
  chip.getBoundingClientRect = () => ({ left: 100, top: 50, right: 200, bottom: 70, width: 100, height: 20 })
  const removed = []
  const stop = watchChipRemoval({ doc, win, onRemove: (element) => removed.push(element) })

  const middle = createEvent('mousedown', { target: chip, clientX: 140, clientY: 60 })
  fire(win, 'mousedown', middle)
  assert.deepEqual(removed, [])
  assert.equal(middle.prevented, false)
  stop()
})

test('the remove zone stays out of the way while selecting', () => {
  const { doc, win, chips } = fixture(1)
  const chip = chips[0]
  chip.getBoundingClientRect = () => ({ left: 100, top: 50, right: 200, bottom: 70, width: 100, height: 20 })
  const removed = []
  const stop = watchChipRemoval({ doc, win, onRemove: (element) => removed.push(element), isPickerActive: () => true })

  fire(win, 'mousedown', createEvent('mousedown', { target: chip, clientX: 195, clientY: 60 }))
  assert.deepEqual(removed, [], 'a pick must never delete a chip')
  stop()
})

test('removal consumes the chip through the input machine', () => {
  const { doc, chips } = fixture(1)
  const chip = chips[0]
  const calls = []
  const facade = {
    state: { getSnapshot: () => ({ draftRev: 5, occurrences: [{ offset: 0, length: 12 }] }) },
    consumeToken: (guard) => {
      calls.push(guard)
      chip.remove()
      return true
    },
  }

  assert.equal(removeChipElement({ doc, chip, facade }), 'consumeToken:ok')
  assert.deepEqual(calls, [{ kind: 'span', span: { start: 0, end: 1, draftRev: 5 } }])
  assert.equal(doc.querySelectorAll(CHIP_SELECTOR).length, 0)
})

test('a revision race is retried once with a fresh snapshot', () => {
  const { doc, chips } = fixture(1)
  const chip = chips[0]
  let attempt = 0
  const facade = {
    state: { getSnapshot: () => ({ draftRev: 1 + attempt, occurrences: [{ offset: 0, length: 3 }] }) },
    consumeToken: () => {
      attempt += 1
      if (attempt === 1) return false
      chip.remove()
      return true
    },
  }

  assert.equal(removeChipElement({ doc, chip, facade }), 'consumeToken:refused, consumeToken:ok')
})

test('the scoped event is used when the facade hides consumeToken', () => {
  const { doc, chips } = fixture(1)
  const chip = chips[0]
  const events = []
  const actx = {
    bail: (ctx, name, request) => {
      events.push({ name, request })
      chip.remove()
      return true
    },
  }
  const facade = { state: { getSnapshot: () => ({ draftRev: 2, occurrences: [{ offset: 0, length: 3 }] }) } }

  assert.equal(removeChipElement({ doc, chip, facade, actx }), 'event:ok')
  assert.equal(events[0].name, 'slash/input-consume-token')
})

test('removal never rewrites the draft to get rid of a chip', () => {
  const { doc, chips } = fixture(1)
  const chip = chips[0]
  const messages = []
  const facade = {
    state: { getSnapshot: () => ({ draftRev: 2, occurrences: [{ offset: 0, length: 3 }] }) },
    setDraft: () => {
      throw new Error('setDraft would flatten the own chips of the user')
    },
  }

  assert.equal(removeChipElement({ doc, chip, facade, onEvent: (m) => messages.push(m) }), null)
  assert.match(messages.join(' '), /neither consumeToken nor the scoped event/)
})

test('removal reports failure instead of pretending', () => {
  const { doc, chips } = fixture(1)
  const chip = chips[0]
  const messages = []
  const facade = {
    state: { getSnapshot: () => ({ draftRev: 2, occurrences: [{ offset: 0, length: 3 }] }) },
    consumeToken: () => false,
  }

  assert.equal(removeChipElement({ doc, chip, facade, onEvent: (m) => messages.push(m) }), null)
  assert.match(messages.join(' '), /consumeToken:refused/)
  assert.match(messages.join(' '), /was not removed/)
})

test('removal is a no-op when no picker chip is present', () => {
  const doc = createDocument()
  const messages = []
  const orphan = doc.createElement('span')

  assert.equal(removeChipElement({ doc, chip: orphan, onEvent: (m) => messages.push(m) }), null)
  assert.match(messages.join(' '), /no picker chip is present/)
})

test('grouping removes every chip and inserts one carrying all their blocks', () => {
  const { doc } = fixture(0)
  const calls = { consumed: [], inserted: [] }
  let chips = [
    { source: CHIP_SOURCE, offset: 0, length: 10, clipboardText: '[元素] a' },
    { source: CHIP_SOURCE, offset: 13, length: 12, clipboardText: '[元素] b' },
    { source: CHIP_SOURCE, offset: 28, length: 9, clipboardText: '[元素] c' },
  ]
  const facade = {
    state: { getSnapshot: () => ({ draftRev: 7, draft: 'x'.repeat(40), occurrences: chips.slice() }) },
    consumeToken: (guard) => {
      calls.consumed.push(guard.span)
      const index = chips.findIndex((chip, position) => {
        let detect = chip.offset
        for (let i = 0; i < position; i += 1) detect -= chips[i].length - 1
        return guard.span.start === detect
      })
      if (index < 0) return false
      chips = chips.filter((_, position) => position !== index)
      return true
    },
    insertReference: (ref) => {
      calls.inserted.push(ref)
      return true
    },
  }
  const ctx = {
    sessions: { scope: () => ({}) },
    conversation: { input: { for: () => facade } },
  }

  const events = []
  const result = groupElementChips({ ctx, sessionId: 's', onEvent: (message) => events.push(message) })

  assert.deepEqual(result, { grouped: 3 })
  assert.equal(calls.consumed.length, 3, 'each chip is consumed')
  // Removed from the end backwards, so earlier spans stay valid.
  assert.equal(calls.consumed[0].start > calls.consumed[1].start, true)
  assert.equal(calls.inserted.length, 1)
  const payload = calls.inserted[0].ref
  assert.equal(calls.inserted[0].source, CHIP_SOURCE)
  assert.equal(calls.inserted[0].label, '3 个元素')
  assert.equal(payload.startsWith('[元素组] 3 个界面元素'), true)
  for (const block of ['[元素] a', '[元素] b', '[元素] c']) assert.equal(payload.includes(block), true)
  // 1 header + 3 element blocks, each on its own line.
  assert.match(events.join(' '), /grouped 3 chips into one carrying a 4-line block/)
})

test('grouping needs at least two picks', () => {
  const { doc } = fixture(0)
  const facade = {
    state: { getSnapshot: () => ({ draftRev: 7, draft: '', occurrences: [{ source: CHIP_SOURCE, offset: 0, length: 4, clipboardText: '[元素] a' }] }) },
    consumeToken: () => true,
    insertReference: () => true,
  }
  const ctx = { sessions: { scope: () => ({}) }, conversation: { input: { for: () => facade } } }
  const events = []
  assert.equal(groupElementChips({ ctx, sessionId: 's', onEvent: (m) => events.push(m) }), null)
  assert.match(events.join(' '), /at least two picked elements \(found 1\)/)
})

test('grouping leaves the draft alone when the session is unreachable', () => {
  const events = []
  assert.equal(groupElementChips({ ctx: {}, sessionId: 's', onEvent: (m) => events.push(m) }), null)
  assert.match(events.join(' '), /no session scope/)
})

test('a group payload parses back into one preview row per element', () => {
  const payload = [
    '[元素组] 2 个界面元素',
    '',
    '（1）[元素] span "Gemini"',
    '[选择器] span.a',
    '[属性] role="treeitem"',
    '（2）[元素] div "zcode"',
    '[选择器] div.b',
    '',
  ].join(String.fromCharCode(10))

  const rows = parsePreviewItems(payload, 'DeepSeek Harness')
  assert.equal(rows.length, 2)
  assert.deepEqual(
    { summary: rows[0].summary, meta: rows[0].meta, origin: rows[0].origin },
    { summary: 'span "Gemini"', meta: 'span · role=treeitem', origin: 'DeepSeek Harness' },
  )
  assert.deepEqual(
    { summary: rows[1].summary, meta: rows[1].meta, origin: rows[1].origin },
    { summary: 'div "zcode"', meta: 'div', origin: 'DeepSeek Harness' },
  )
  // Each row keeps its own raw block, so dropping a row can rebuild the rest.
  assert.equal(rows[0].block.includes('[选择器] span.a'), true)
  assert.equal(rows[0].block.includes('（2）'), false, 'a block is bare, without its number')
  assert.equal(rows[1].block.includes('[选择器] div.b'), true)
}

test('the payload of a chip is read back from the published occurrences', () => {
  const { doc, chips } = fixture(2)
  const facade = {
    state: {
      getSnapshot: () => ({
        draftRev: 3,
        occurrences: [
          { source: CHIP_SOURCE, offset: 0, length: 4, clipboardText: '[元素] a' },
          { source: CHIP_SOURCE, offset: 9, length: 4, clipboardText: '[元素] b' },
        ],
      }),
    },
  }
  const ctx = { sessions: { scope: () => ({}) }, conversation: { input: { for: () => facade } } }

  assert.equal(chipPayloadOf({ ctx, sessionId: 's', chip: chips[0] }), '[元素] a')
  assert.equal(chipPayloadOf({ ctx, sessionId: 's', chip: chips[1] }), '[元素] b')
  // Nothing to read: no session, and no occurrence at that position.
  assert.equal(chipPayloadOf({ ctx: {}, sessionId: 's', chip: chips[0] }), '')
  assert.equal(chipPayloadOf({ ctx, sessionId: 's', chip: doc.createElement('span') }), '')
})

test('a payload is rebuilt with its elements renumbered and its label updated', () => {
  const blocks = ['[元素] a', '[元素] b', '[元素] c']
  const payload = buildGroupPayload(blocks)
  assert.equal(payload.startsWith('[元素组] 3 个界面元素'), true)
  assert.equal(payload.includes('（1）[元素] a'), true)
  assert.equal(payload.includes('（3）[元素] c'), true)
})

test('dropping a preview row removes that element and keeps the rest grouped', () => {
  const { doc, chips } = fixture(1)
  const before = buildGroupPayload([BLOCK, '[元素] b', '[元素] c'])
  let chipsState = [{ source: CHIP_SOURCE, offset: 0, length: 12, clipboardText: before }]
  const calls = { consumed: 0, inserted: [] }
  const facade = {
    state: { getSnapshot: () => ({ draftRev: 5, draft: 'x'.repeat(20), occurrences: chipsState.slice() }) },
    consumeToken: () => {
      calls.consumed += 1
      chipsState = []
      return true
    },
    insertReference: (ref) => {
      calls.inserted.push(ref)
      return true
    },
  }
  const ctx = { sessions: { scope: () => ({}) }, conversation: { input: { for: () => facade } } }

  const result = removePreviewItem({ ctx, sessionId: 's', chip: chips[0], index: 1, onEvent: () => {} })

  assert.deepEqual(result, { removed: 1, remaining: 2 })
  assert.equal(calls.consumed, 1, 'the group chip goes through consumeToken, never setDraft')
  assert.equal(calls.inserted.length, 1)
  const payload = calls.inserted[0].ref
  assert.equal(calls.inserted[0].label, '2 个元素')
  assert.equal(payload.includes('[元素] a'), true)
  assert.equal(payload.includes('（2）[元素] c'), true, 'elements are renumbered from one')
  assert.equal(payload.includes('[元素] b'), false, 'the dropped element is gone')
})

test('dropping the last preview row just removes the chip', () => {
  const { doc, chips } = fixture(1)
  let chipsState = [{ source: CHIP_SOURCE, offset: 0, length: 9, clipboardText: BLOCK }]
  let inserted = 0
  const facade = {
    state: { getSnapshot: () => ({ draftRev: 5, draft: 'x'.repeat(20), occurrences: chipsState.slice() }) },
    consumeToken: () => {
      chipsState = []
      return true
    },
    insertReference: () => {
      inserted += 1
      return true
    },
  }
  const ctx = { sessions: { scope: () => ({}) }, conversation: { input: { for: () => facade } } }

  assert.deepEqual(removePreviewItem({ ctx, sessionId: 's', chip: chips[0], index: 0, onEvent: () => {} }), { removed: 1, remaining: 0 })
  assert.equal(inserted, 0, 'nothing is re-inserted when no element is left')
})

test('dropping a row that does not exist changes nothing', () => {
  const { doc, chips } = fixture(1)
  let consumed = 0
  const facade = {
    state: {
      getSnapshot: () => ({
        draftRev: 5,
        occurrences: [{ source: CHIP_SOURCE, offset: 0, length: 9, clipboardText: BLOCK }],
      }),
    },
    consumeToken: () => {
      consumed += 1
      return true
    },
    insertReference: () => true,
  }
  const ctx = { sessions: { scope: () => ({}) }, conversation: { input: { for: () => facade } } }
  const events = []
  assert.equal(removePreviewItem({ ctx, sessionId: 's', chip: chips[0], index: 4, onEvent: (m) => events.push(m) }), null)
  assert.equal(consumed, 0)
  assert.match(events.join(' '), /cannot drop row 4/)
})

test('the outer delete clears every picked element in one call', () => {
  const calls = []
  let chips = [
    { source: CHIP_SOURCE, offset: 0, length: 10, clipboardText: '[元素] a' },
    { source: 'other-source', offset: 12, length: 8, clipboardText: 'not ours' },
    { source: CHIP_SOURCE, offset: 22, length: 10, clipboardText: '[元素] b' },
    { source: CHIP_SOURCE, offset: 34, length: 10, clipboardText: '[元素] c' },
  ]
  const facade = {
    state: { getSnapshot: () => ({ draftRev: 2, draft: 'x'.repeat(48), occurrences: chips.slice() }) },
    consumeToken: (guard) => {
      calls.push(guard.span)
      const index = chips.findIndex((chip, position) => {
        let detect = chip.offset
        for (let i = 0; i < position; i += 1) detect -= chips[i].length - 1
        return guard.span.start === detect
      })
      if (index < 0) return false
      chips = chips.filter((_, position) => position !== index)
      return true
    },
  }
  const ctx = { sessions: { scope: () => ({}) }, conversation: { input: { for: () => facade } } }
  const events = []

  const result = removeAllChips({ ctx, sessionId: 's', onEvent: (message) => events.push(message) })

  assert.deepEqual(result, { removed: 3, before: 3 })
  assert.equal(calls.length, 3, 'every picker chip is consumed')
  assert.equal(calls[0].start > calls[1].start && calls[1].start > calls[2].start, true, 'removed from the end backwards')
  assert.equal(chips.length, 1, 'a foreign chip is left alone')
  assert.equal(chips[0].source, 'other-source')
  assert.match(events.join(' '), /cleared 3 of 3 picked chips/)
})

test('clearing with nothing picked reports rather than throws', () => {
  const facade = { state: { getSnapshot: () => ({ draftRev: 1, occurrences: [] }) }, consumeToken: () => true }
  const ctx = { sessions: { scope: () => ({}) }, conversation: { input: { for: () => facade } } }
  const events = []
  assert.deepEqual(removeAllChips({ ctx, sessionId: 's', onEvent: (m) => events.push(m) }), { removed: 0, before: 0 })
  assert.match(events.join(' '), /no picked chips/)
  assert.equal(removeAllChips({ ctx: {}, sessionId: 's', onEvent: () => {} }), null)
})

test('a single element payload is one row, and junk is none', () => {
  const single = parsePreviewItems('[元素] button "发送"' + String.fromCharCode(10) + '[HTML] <button>')
  assert.equal(single.length, 1)
  assert.equal(single[0].summary, 'button "发送"')
  assert.equal(single[0].meta, 'button')

  assert.deepEqual(parsePreviewItems(''), [])
  assert.deepEqual(parsePreviewItems('只是一段普通文字'), [])
  assert.deepEqual(parsePreviewItems(undefined), [])
})

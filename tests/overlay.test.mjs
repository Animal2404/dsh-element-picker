/**
 * Selection mode: the hover highlight, click-to-pick, event swallowing,
 * cancellation, and teardown.
 *
 * The picker deliberately owns no button: its single control lives in the
 * composer tool row and just calls `toggle()`, so the controller is driven
 * directly here and the suite asserts there is nothing clickable in the overlay.
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { createDocument, createEvent, createWindow } from './helpers/dom-stub.mjs'
import { PICKER_MARKER, createPicker } from '../src/overlay.js'

/**
 * Build a document with a hooked target element.
 *
 * @returns {{ doc: object, win: object, target: object }} Fixture pieces.
 */
function fixture() {
  const doc = createDocument()
  const win = createWindow(doc)
  const target = doc.createElement('button')
  target.setAttribute('data-composer-card', '')
  target.textContent = '发送'
  doc.body.appendChild(target)

  target.getBoundingClientRect = () => ({ left: 100, top: 200, width: 44, height: 30 })
  doc.elementsFromPoint = () => [target]

  return { doc, win, target }
}

/**
 * @param {object} doc - Document stub.
 * @param {string} type - Event type.
 * @param {object} event - Event object.
 * @returns {void}
 */
function fire(doc, type, event) {
  for (const handler of doc.listeners.get(`${type}:capture`) ?? []) handler(event)
}

/**
 * Find one of the picker's nodes by marker.
 *
 * @param {object} doc - Document stub.
 * @param {string} marker - Marker value.
 * @returns {object | null} The node.
 */
function node(doc, marker) {
  return doc.querySelectorAll(`[${PICKER_MARKER}="${marker}"]`)[0] ?? null
}

test('the overlay mounts a highlight and a hint, and nothing clickable', () => {
  const { doc, win } = fixture()
  const picker = createPicker({ doc, win, onPick: () => {} })

  assert.equal(node(doc, 'root') !== null, true)
  assert.equal(node(doc, 'highlight') !== null, true)
  assert.match(node(doc, 'hint').textContent, /选择模式/)
  assert.equal(node(doc, 'button'), null, 'the overlay must not own a button of its own')
  assert.equal(picker.isActive(), false)
  assert.equal(node(doc, 'root').getAttribute('data-dsh-picker-active'), 'false')
})

test('selection mode toggles both ways', () => {
  const { doc, win } = fixture()
  const picker = createPicker({ doc, win, onPick: () => {} })

  assert.equal(picker.toggle(), true)
  assert.equal(node(doc, 'root').getAttribute('data-dsh-picker-active'), 'true')
  assert.equal(picker.toggle(), false)
  assert.equal(node(doc, 'root').getAttribute('data-dsh-picker-active'), 'false')
  assert.equal(picker.setActive(true), true)
  assert.equal(picker.isActive(), true)
})

test('hovering highlights the resolved element in viewport coordinates', () => {
  const { doc, win, target } = fixture()
  // The highlight is fixed, so scroll must not shift it: the box is reported in
  // viewport coordinates and repainted on scroll instead.
  win.scrollX = 10
  win.scrollY = 30
  const picker = createPicker({ doc, win, onPick: () => {} })
  picker.setActive(true)

  fire(doc, 'pointermove', createEvent('pointermove', { clientX: 5, clientY: 5 }))

  const highlight = node(doc, 'highlight')
  assert.equal(highlight.getAttribute('data-dsh-picker-visible'), 'true')
  assert.equal(highlight.style.left, '100px')
  assert.equal(highlight.style.top, '200px')
  assert.equal(highlight.style.width, '44px')
  assert.equal(highlight.style.height, '30px')
  assert.equal(target.textContent, '发送')
})

test('a click picks the element, swallows the event, and leaves selection mode', () => {
  const { doc, win, target } = fixture()
  const picks = []
  const picker = createPicker({ doc, win, onPick: (element) => picks.push(element) })
  picker.setActive(true)

  const event = createEvent('click', { target, clientX: 5, clientY: 5 })
  fire(doc, 'click', event)

  assert.deepEqual(picks, [target])
  assert.equal(event.prevented, true, 'the application must not receive the click')
  assert.equal(event.stopped, true)
  assert.equal(picker.isActive(), false)
})

test('a swallowed pointerdown never reaches the application', () => {
  const { doc, win, target } = fixture()
  const picker = createPicker({ doc, win, onPick: () => {} })
  picker.setActive(true)

  const event = createEvent('pointerdown', { target, clientX: 5, clientY: 5 })
  fire(doc, 'pointerdown', event)
  assert.equal(event.prevented, true)

  picker.setActive(false)
  const after = createEvent('pointerdown', { target, clientX: 5, clientY: 5 })
  fire(doc, 'pointerdown', after)
  assert.equal(after.prevented, false, 'ordinary clicks must pass through when the picker is off')
})

test('the picker never picks its own UI', () => {
  const { doc, win } = fixture()
  const picks = []
  const picker = createPicker({ doc, win, onPick: (element) => picks.push(element) })
  picker.setActive(true)

  const own = node(doc, 'hint')
  const event = createEvent('click', { target: own, clientX: 1, clientY: 1 })
  fire(doc, 'click', event)

  assert.deepEqual(picks, [])
  assert.equal(picker.isActive(), true, 'clicking the overlay is not a pick and does not exit')
})

test('Escape leaves selection mode without picking', () => {
  const { doc, win } = fixture()
  const picks = []
  const picker = createPicker({ doc, win, onPick: (element) => picks.push(element) })
  picker.setActive(true)

  fire(doc, 'keydown', createEvent('keydown', { key: 'Escape' }))
  assert.deepEqual(picks, [])
  assert.equal(picker.isActive(), false)

  const other = createEvent('keydown', { key: 'a' })
  fire(doc, 'keydown', other)
  assert.equal(other.prevented, false, 'other keys are untouched')
})

test('moving onto empty space clears the highlight', () => {
  const { doc, win, target } = fixture()
  doc.elementsFromPoint = (x) => (x < 0 ? [] : [target])
  const picker = createPicker({ doc, win, onPick: () => {} })
  picker.setActive(true)

  fire(doc, 'pointermove', createEvent('pointermove', { clientX: 5, clientY: 5 }))
  assert.equal(node(doc, 'highlight').getAttribute('data-dsh-picker-visible'), 'true')

  // Off-screen space hit-tests to nothing at all: no element to outline.
  fire(doc, 'pointermove', createEvent('pointermove', { clientX: -50, clientY: 5 }))
  assert.equal(node(doc, 'highlight').getAttribute('data-dsh-picker-visible'), null)
})

test('dispose removes the overlay and stops listening', () => {
  const { doc, win, target } = fixture()
  const picks = []
  const picker = createPicker({ doc, win, onPick: (element) => picks.push(element) })
  picker.setActive(true)
  picker.dispose()

  assert.equal(node(doc, 'root'), null)
  fire(doc, 'click', createEvent('click', { target, clientX: 5, clientY: 5 }))
  assert.deepEqual(picks, [])
})

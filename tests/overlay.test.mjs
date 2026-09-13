/**
 * Selection mode: the floating button, the hover highlight, click-to-pick,
 * event swallowing, cancellation, and teardown.
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { createDocument, createEvent, createWindow } from './helpers/dom-stub.mjs'
import { PICKER_MARKER, createPicker } from '../src/overlay.js'

/**
 * Build a document with a hooked target element.
 *
 * @returns {{ doc: object, win: object, target: object, rects: WeakMap<object, object> }}
 *   Fixture pieces; `rects` overrides getBoundingClientRect per element.
 */
function fixture() {
  const doc = createDocument()
  const win = createWindow(doc)
  const target = doc.createElement('button')
  target.setAttribute('data-composer-card', '')
  target.textContent = '发送'
  doc.body.appendChild(target)

  const rects = new WeakMap()
  rects.set(target, { left: 100, top: 200, width: 44, height: 30 })
  target.getBoundingClientRect = () => rects.get(target)

  doc.elementsFromPoint = () => [target]

  return { doc, win, target, rects }
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

test('the overlay mounts a floating button, a highlight, and a hint', () => {
  const { doc, win } = fixture()
  const picker = createPicker({ doc, win, onPick: () => {} })

  assert.equal(node(doc, 'root') !== null, true)
  assert.equal(node(doc, 'button').getAttribute('aria-label'), '选择界面元素加入聊天')
  assert.equal(node(doc, 'button').title, '选择界面元素加入聊天')
  assert.equal(node(doc, 'highlight') !== null, true)
  assert.match(node(doc, 'hint').textContent, /选择模式/)
  assert.equal(picker.isActive(), false)
})

test('the floating button toggles selection mode both ways', () => {
  const { doc, win } = fixture()
  const picker = createPicker({ doc, win, onPick: () => {} })
  const button = node(doc, 'button')

  button.dispatchEvent(createEvent('click'))
  assert.equal(picker.isActive(), true)
  assert.equal(node(doc, 'root').getAttribute('data-dsh-picker-active'), 'true')
  assert.equal(button.getAttribute('aria-pressed'), 'true')

  button.dispatchEvent(createEvent('click'))
  assert.equal(picker.isActive(), false)
  assert.equal(node(doc, 'root').getAttribute('data-dsh-picker-active'), 'false')
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

test('the floating button anchors above the composer card instead of the corner', () => {
  const doc = createDocument()
  const win = createWindow(doc)
  win.innerWidth = 1280
  const card = doc.createElement('div')
  card.setAttribute('data-composer-card', '')
  card.getBoundingClientRect = () => ({ left: 700, top: 600, width: 300, height: 120, right: 1000, bottom: 720 })
  doc.body.appendChild(card)

  createPicker({ doc, win, onPick: () => {} })

  const button = node(doc, 'button')
  assert.equal(button.style.bottom, 'auto', 'the corner offset must be released')
  assert.equal(button.style.top, '552px', 'sits 48px above the card')
  assert.equal(button.style.right, '288px', 'right-aligned to the card with an 8px gap')
})

test('without a composer card the corner placement stands', () => {
  const doc = createDocument()
  const win = createWindow(doc)
  const picker = createPicker({ doc, win, onPick: () => {} })

  const button = node(doc, 'button')
  assert.equal(button.style.top, 'auto')
  assert.equal(button.style.bottom, '20px')
  assert.equal(button.style.right, '20px')
  assert.equal(picker.isActive(), false)
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

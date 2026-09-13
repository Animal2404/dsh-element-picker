/**
 * Selector generation, XPath, hook resolution, and element summaries.
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { createDocument } from './helpers/dom-stub.mjs'
import {
  describeElement,
  generateSelector,
  generateXPath,
  hasStableHook,
  isUniqueSelector,
  resolveTarget,
} from '../src/selector.js'

/**
 * Build the fixture DSH-shaped subtree used by most cases.
 *
 * @returns {{ doc: object, card: object, input: object, send: object, plain: object }}
 *   The document and the elements under test.
 */
function fixture() {
  const doc = createDocument()
  const card = doc.createElement('div')
  card.setAttribute('data-composer-card', '')

  const scroll = doc.createElement('div')
  scroll.setAttribute('data-input-scroll', '')

  const input = doc.createElement('div')
  input.setAttribute('data-composer-input', '')
  input.setAttribute('contenteditable', 'true')

  const send = doc.createElement('button')
  send.setAttribute('aria-label', '发送消息')
  send.textContent = '发送'

  const plain = doc.createElement('span')
  plain.textContent = 'cell'

  card.appendChild(scroll)
  scroll.appendChild(input)
  doc.body.appendChild(card)
  doc.body.appendChild(send)
  doc.body.appendChild(plain)

  return { doc, card, input, send, plain }
}

test('a DSH presence flag anchors the selector and keeps it short', () => {
  const { send } = fixture()
  assert.equal(generateSelector(send), 'button[aria-label="发送消息"]')
})

test('ambient build-hash classes are used only when nothing stable exists', () => {
  const { doc, plain } = fixture()
  plain.classList.add('hHd-Xa_cell')
  const selector = generateSelector(plain)
  assert.equal(selector, 'span.hHd-Xa_cell')
  assert.equal(isUniqueSelector(plain, selector), true)
})

test('a unique id wins over every other candidate', () => {
  const { doc, card } = fixture()
  card.setAttribute('id', 'composer-card')
  assert.equal(generateSelector(card), '#composer-card')
})

test('an ambiguous short candidate falls back to an anchored path', () => {
  const { doc, input } = fixture()
  const twin = doc.createElement('span')
  twin.classList.add('twin')
  const twinInside = doc.createElement('span')
  twinInside.classList.add('twin')
  input.appendChild(twinInside)
  doc.body.appendChild(twin)

  const selector = generateSelector(twinInside)
  assert.equal(selector, 'div[data-composer-input] > span')
  assert.equal(isUniqueSelector(twinInside, selector), true)
})

test('with no stable attribute at all the positional path still resolves', () => {
  const { doc } = fixture()
  const wrapper = doc.createElement('section')
  const first = doc.createElement('p')
  const second = doc.createElement('p')
  wrapper.appendChild(first)
  wrapper.appendChild(second)
  doc.body.appendChild(wrapper)

  const selector = generateSelector(second)
  assert.equal(isUniqueSelector(second, selector), true)
  assert.match(selector, /p:nth-of-type\(2\)/)
})

test('XPath is absolute and counts same-tag siblings', () => {
  const { doc, plain } = fixture()
  assert.equal(generateXPath(plain), '/html/body/span')
})

test('targets are component hooks and controls — not every marked container', () => {
  const { doc, card, input, send, plain } = fixture()
  assert.equal(hasStableHook(card), true, 'a composer hook is a target')
  assert.equal(hasStableHook(input), true)
  assert.equal(hasStableHook(send), true, 'a button is a target')
  assert.equal(hasStableHook(plain), false, 'a bare span is not')

  // DSH marks whole panels with data-phase (a session root carries
  // data-phase="active"). Treating that as a target is what made a click inside
  // a panel select the entire panel.
  const panel = doc.createElement('div')
  panel.setAttribute('data-phase', 'active')
  const title = doc.createElement('span')
  title.textContent = 'session title'
  panel.appendChild(title)
  doc.body.appendChild(panel)

  assert.equal(hasStableHook(panel), false, 'data-phase is not a target hook')
  assert.equal(resolveTarget(title, doc), title, 'the pointed-at element wins')
  assert.equal(resolveTarget(panel, doc), panel)
})

test('an application mount point does not capture everything inside it', () => {
  const doc = createDocument()
  // DSH mounts the whole app under #root; stopping the climb on any id made a
  // click on a session header outline the entire application.
  const mount = doc.createElement('div')
  mount.setAttribute('id', 'root')
  const panel = doc.createElement('div')
  panel.setAttribute('data-phase', 'active')
  const header = doc.createElement('header')
  const title = doc.createElement('h2')
  title.textContent = 'session title'
  header.appendChild(title)
  panel.appendChild(header)
  mount.appendChild(panel)
  doc.body.appendChild(mount)

  assert.equal(hasStableHook(mount), false, 'a mount point is not a target')
  assert.equal(resolveTarget(header, doc), header, 'the header stays the header')
  assert.equal(resolveTarget(title, doc), title, 'a plain title stays itself')
})

test('a pick resolves upward to the nearest hooked element', () => {
  const { doc, card, input } = fixture()
  const inner = doc.createElement('span')
  inner.textContent = 'x'
  input.appendChild(inner)

  assert.equal(resolveTarget(inner, doc), input, 'the closest hooked node wins')
  assert.equal(resolveTarget(input, doc), input)
  assert.equal(resolveTarget(card, doc), card)
})

test('an icon inside a control resolves to the control', () => {
  const { doc, send } = fixture()
  const svg = doc.createElement('svg')
  const path = doc.createElement('path')
  svg.appendChild(path)
  send.appendChild(svg)

  assert.equal(resolveTarget(path, doc), send, 'the path climbs to the button')
  assert.equal(resolveTarget(svg, doc), send)
})

test('an element with an interactive role is its own target', () => {
  const doc = createDocument()
  const row = doc.createElement('div')
  row.setAttribute('role', 'button')
  const label = doc.createElement('span')
  label.textContent = 'open'
  row.appendChild(label)
  doc.body.appendChild(row)

  assert.equal(hasStableHook(row), true, 'role=button is a control')
  assert.equal(resolveTarget(label, doc), row, 'the label climbs to the control')
})

test('an element with no hook above it is returned unchanged', () => {
  const { doc, plain } = fixture()
  assert.equal(resolveTarget(plain, doc), plain)
})

test('describeElement summarises tag, id, class, and clipped text', () => {
  const { doc, send } = fixture()
  send.classList.add('primary')
  assert.equal(describeElement(send), 'button.primary "发送"')

  const long = doc.createElement('div')
  long.textContent = 'x'.repeat(60)
  assert.equal(describeElement(long).endsWith('…"'), true)
})

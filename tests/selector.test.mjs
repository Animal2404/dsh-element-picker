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

test('hooks are recognised on the element itself', () => {
  const { card, plain } = fixture()
  assert.equal(hasStableHook(card), true)
  assert.equal(hasStableHook(plain), false)
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

/**
 * Transcript folding: a sent element block shows as a pill, and clicking it
 * brings the full block back. The message text itself is never modified — the
 * model already received it — so these tests pin the presentation contract:
 * fold once, never fold inside the composer, and expand on click.
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { createDocument, createEvent } from './helpers/dom-stub.mjs'
import { FOLD_MARKER, PILL_MARKER, foldTranscriptBlocks, watchTranscript } from '../src/transcript.js'

const BLOCK_LINES = [
  '[元素] span "完全权限"',
  '[选择器] span.x',
  '[XPath] /html/body/div[1]',
  '[位置] 156x32 @ viewport(770,310) page(770,310)',
  '[样式] color #F9FAFB; display inline',
  '[源码] …/skeleton/InputBar.tsx',
  '[HTML] <span>完全权限</span>',
]

/**
 * Build a document whose transcript holds one sent message made of block lines.
 *
 * @param {object} [options] - Fixture options.
 * @param {boolean} [options.inComposer] - Put the block in the composer instead.
 * @returns {{ doc: object, lines: object[], container: object }} Fixture pieces.
 */
function fixture(options = {}) {
  const doc = createDocument()
  const container = doc.createElement('div')
  container.classList.add('transcript')

  let host = container
  if (options.inComposer === true) {
    host = doc.createElement('div')
    host.setAttribute('data-composer-card', '')
    container.appendChild(host)
  }

  const lines = BLOCK_LINES.map((text) => {
    const line = doc.createElement('p')
    line.textContent = text
    host.appendChild(line)
    return line
  })
  doc.body.appendChild(container)
  return { doc, lines, container }
}

test('a sent block folds into one pill and hides its lines', () => {
  const { doc, lines } = fixture()

  assert.equal(foldTranscriptBlocks(doc), 1)
  const pill = doc.querySelectorAll(`[${PILL_MARKER}]`)
  assert.equal(pill.length, 1)
  assert.equal(pill[0].getAttribute('aria-expanded'), 'false')
  // The label is the element summary without its marker.
  assert.equal(pill[0].textContent.includes('span "完全权限"'), true)
  assert.equal(pill[0].textContent.includes('[元素]'), false)

  // Every line of the block is hidden, and the text is still there to copy.
  for (const line of lines) {
    assert.equal(line.style.display, 'none')
    assert.equal(line.textContent.startsWith('['), true)
  }
  assert.equal(lines[0].getAttribute(FOLD_MARKER), 'true')
})

test('folding is idempotent, and the pill is its own toggle', () => {
  const { doc, lines } = fixture()
  foldTranscriptBlocks(doc)
  assert.equal(foldTranscriptBlocks(doc), 0, 'a second pass must not re-fold')
  assert.equal(doc.querySelectorAll(`[${PILL_MARKER}]`).length, 1)

  const pill = doc.querySelectorAll(`[${PILL_MARKER}]`)[0]
  const event = createEvent('click')
  pill.dispatchEvent(event)
  assert.equal(event.prevented, true, 'the click must not reach the message')
  assert.equal(pill.getAttribute('aria-expanded'), 'true')
  for (const line of lines) assert.equal(line.style.display, '', 'expanding shows the block again')

  pill.dispatchEvent(createEvent('click'))
  assert.equal(pill.getAttribute('aria-expanded'), 'false')
  for (const line of lines) assert.equal(line.style.display, 'none')
})

test('the composer is never folded', () => {
  const { doc } = fixture({ inComposer: true })
  assert.equal(foldTranscriptBlocks(doc), 0)
  assert.equal(doc.querySelectorAll(`[${PILL_MARKER}]`).length, 0)
})

test('a plain message that merely mentions a field is left alone', () => {
  const doc = createDocument()
  const paragraph = doc.createElement('p')
  paragraph.textContent = '把 [选择器] 这个词写在文档里'
  doc.body.appendChild(paragraph)

  assert.equal(foldTranscriptBlocks(doc), 0)
  assert.equal(doc.querySelectorAll(`[${PILL_MARKER}]`).length, 0)
})

test('the pill is marked so the picker ignores it', () => {
  const { doc } = fixture()
  foldTranscriptBlocks(doc)
  const pill = doc.querySelectorAll(`[${PILL_MARKER}]`)[0]
  assert.equal(pill.getAttribute('data-dsh-picker-ui'), 'transcript-pill')
})

test('watching folds blocks that arrive later, and stops on teardown', () => {
  const doc = createDocument()
  const observers = []
  const win = {
    requestAnimationFrame: (callback) => {
      callback()
      return 0
    },
    MutationObserver: class StubObserver {
      constructor(callback) {
        this.callback = callback
        this.disconnected = false
        observers.push(this)
      }

      observe() {}

      disconnect() {
        this.disconnected = true
      }
    },
  }

  const stop = watchTranscript({ doc, win, onEvent: () => {} })
  assert.equal(doc.querySelectorAll(`[${PILL_MARKER}]`).length, 0, 'nothing to fold yet')

  const first = doc.createElement('p')
  first.textContent = BLOCK_LINES[0]
  const second = doc.createElement('p')
  second.textContent = BLOCK_LINES[1]
  doc.body.appendChild(first)
  doc.body.appendChild(second)

  observers[0].callback([])
  assert.equal(doc.querySelectorAll(`[${PILL_MARKER}]`).length, 1, 'a later message folds on the next pass')

  stop()
  assert.equal(observers[0].disconnected, true)
})

/**
 * The inserted block: every line, the DSH source mapping, and the guards that
 * keep a partial DOM from producing a malformed block.
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { createDocument, createWindow } from './helpers/dom-stub.mjs'
import { buildElementBlock, knownHooks } from '../src/describe.js'

/** Computed style returned by the window stub. */
const STYLE = {
  color: '#F9FAFB',
  fontSize: '16px',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC"',
  fontWeight: '600',
  display: 'flex',
}

/**
 * Build a document with one hooked send button.
 *
 * @returns {{ doc: object, win: object, button: object }} Fixture pieces.
 */
function fixture() {
  const doc = createDocument()
  const card = doc.createElement('div')
  card.setAttribute('data-composer-card', '')

  const button = doc.createElement('button')
  button.setAttribute('aria-label', '发送消息')
  button.setAttribute('data-phase', 'idle')
  button.textContent = '发送'
  button.getBoundingClientRect = () => ({
    left: 1032,
    top: 688,
    width: 44,
    height: 44,
    right: 1076,
    bottom: 732,
  })

  card.appendChild(button)
  doc.body.appendChild(card)

  return { doc, win: createWindow(doc, STYLE), button }
}

test('the block carries element, selector, xpath, position, style, attributes, source, and html', () => {
  const { doc, win, button } = fixture()
  const block = buildElementBlock(button, {
    doc,
    win,
    scroll: { x: 0, y: 120 },
    rect: button.getBoundingClientRect(),
  })
  const lines = block.trimEnd().split('\n')

  assert.equal(lines[0], '[元素] button "发送"')
  assert.equal(lines[1], '[选择器] button[aria-label="发送消息"]')
  assert.equal(lines[2], '[XPath] /html/body/div/button')
  assert.equal(lines[3], '[位置] 44x44 @ viewport(1032,688) page(1032,808)')
  assert.match(lines[4], /^\[样式\] color #F9FAFB; font 16px -apple-system/)
  assert.match(lines[4], /font-weight 600; display flex$/)
  assert.equal(lines[5], '[属性] aria-label="发送消息"')
  assert.equal(
    lines[6],
    '[源码] packages/client/ui-conversation/src/client/skeleton/InputBar.tsx (data-composer-card)',
  )
  assert.match(lines[7], /^\[HTML\] <button aria-label="发送消息" data-phase="idle">发送<\/button>$/)
})

test('the source line names the hook that matched, or is omitted entirely', () => {
  const { doc, win, button } = fixture()
  const block = buildElementBlock(button, { doc, win, rect: button.getBoundingClientRect() })
  assert.match(block, /\(data-composer-card\)/, 'the nearest hooked ancestor supplies the mapping')

  const orphan = doc.createElement('div')
  orphan.textContent = 'plain'
  const bare = buildElementBlock(orphan, { doc, win })
  assert.equal(bare.includes('[源码]'), false)
})

test('a source-less element still produces a usable block', () => {
  const { doc, win } = fixture()
  const orphan = doc.createElement('section')
  orphan.textContent = 'no hooks here'
  doc.body.appendChild(orphan)

  const block = buildElementBlock(orphan, { doc, win })
  assert.match(block, /^\[元素\] section "no hooks here"$/m)
  assert.match(block, /^\[选择器\] /m)
  assert.equal(block.endsWith('\n'), true)
})

test('the hook map is not empty and every entry points at a repository path', () => {
  const hooks = knownHooks()
  assert.equal(hooks.length > 0, true)
  for (const hook of hooks) assert.match(hook, /^data-[\w-]+$/)
})

test('a missing getComputedStyle degrades instead of throwing', () => {
  const { doc, button } = fixture()
  const block = buildElementBlock(button, { doc, win: undefined })
  assert.equal(block.includes('[样式]'), false)
  assert.match(block, /^\[元素\] /m)
})

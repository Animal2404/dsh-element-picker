/**
 * Transcript folding: show a sent element reference as a compact pill.
 *
 * The message itself is unchanged — the model already received the full block —
 * but the transcript renders whatever text the message holds, so an eight-line
 * block sits in the conversation forever. DSH offers no way for a plugin to
 * register how a sent message renders (chips exist only in the composer), so the
 * pill is a presentation-layer fold: the block's lines are wrapped by a pill and
 * hidden, and clicking the pill brings them back.
 *
 * Nothing here touches the message text: the folded nodes stay in the DOM, so
 * selecting, copying, and the model's own view are all unaffected.
 */

import { chipGlyph, chipLabelFromBlock, isModelLead } from './chip.js'

/** Marker on the pill this module renders. Also keeps the picker off it. */
export const PILL_MARKER = 'data-dsh-picker-transcript-pill'

/** Marker on the block's first line element, which owns the fold. */
export const FOLD_MARKER = 'data-dsh-picker-folded'

/** A line that continues a block, and therefore hides with it. */
const FIELD_RE = /^(?:（\d+）)?\s*\[(?:元素|选择器|XPath|位置|样式|属性|源码|HTML)\]/

/** Every line a block may hold, including the header a group payload opens with. */
const BLOCK_LINE_RE = /^(?:（\d+）)?\s*\[(?:元素组|元素|选择器|XPath|位置|样式|属性|源码|HTML)\]/

/** The line that opens a block, group payloads included. */
const OPENS_ANY_RE = /^(?:（\d+）)?\s*\[(?:元素组|元素)\]\s*/


/**
 * Whether a pill already owns the block this element starts.
 *
 * Walks back over the block's own lines — the lead sentence and the field lines
 * after it — because a re-render can drop the markers while leaving the pill, and
 * folding again would stack one pill on another.
 *
 * @param {Element} element - Candidate block owner.
 * @returns {boolean} True when one of the preceding siblings is a pill.
 */
function hasPillBefore(element) {
  let node = element.previousElementSibling
  let guard = 0
  while (node !== null && node !== undefined && guard < 40) {
    if (typeof node.getAttribute === 'function' && node.getAttribute(PILL_MARKER) !== null) return true
    const text = (node.textContent ?? '').trim()
    if (!isModelLead(text) && !FIELD_RE.test(text)) return false
    node = node.previousElementSibling
    guard += 1
  }
  return false
}

/**
 * Whether the element sits in the composer rather than in the transcript.
 *
 * @param {Element} element - Candidate element.
 * @returns {boolean} True inside the composer.
 */
function inComposer(element) {
  return (
    element.closest('[data-composer-card]') !== null ||
    element.closest('[data-composer-input]') !== null ||
    element.closest('[data-composer-seat]') !== null ||
    element.closest('[class*="composerStack"]') !== null
  )
}

/** Any field tag, used to spot two fields joined without their separator. */
const TAG_ANY_RE = /\[(?:元素组|元素|选择器|XPath|位置|样式|属性|源码|HTML)\]/

/**
 * Whether one rendered line holds a single block field.
 *
 * A compact block packs the element, its selector and its source path onto one
 * line, separated by `｜`; a container whose block lines are separate children
 * concatenates them with no separator at all, and that is what must be rejected —
 * joining `[元素] x` and `[选择器] y` starts with the block opener too.
 *
 * @param {string} line - One line of element text.
 * @returns {boolean} True when the line is block content.
 */
function isBlockLine(line) {
  const trimmed = String(line ?? '').trim()
  if (!BLOCK_LINE_RE.test(trimmed)) return false
  const pieces = trimmed.split('｜')
  const head = pieces[0].trim()
  const rest = head.slice(head.indexOf(']') + 1)
  // A further tag is expected when the fields are separated by spaces (one text
  // node, as the trajectory table renders it) but not when they abut, which is a
  // container whose block lines are separate child elements joined by nothing.
  const stray = rest.search(TAG_ANY_RE)
  if (stray >= 0 && !/\s$/.test(rest.slice(0, stray))) return false
  for (const piece of pieces.slice(1)) {
    if (!TAG_ANY_RE.test(piece)) return false
  }
  return true
}

/**
 * Whether a piece of text is nothing but element-block lines.
 *
 * This is what keeps one element to one pill. The transcript renders the block
 * inside a container that may also hold the thinking entry, the context
 * injections and the answer, and such a container starts with the block too —
 * folding it would hide the whole section and leave a pill whose own content is
 * another pill, one level per pass.
 *
 * @param {string} text - Element text.
 * @returns {boolean} True when every line belongs to a block.
 */
function isBlockOnly(text) {
  const lines = String(text ?? '')
    .split(String.fromCharCode(10))
    .map((line) => line.trim())
    .filter((line) => line !== '')
  if (lines.length === 0) return false
  // A block that the model form introduces with a sentence still folds whole.
  const body = isModelLead(lines[0]) ? lines.slice(1) : lines
  if (body.length === 0) return false
  return body.every((line) => isBlockLine(line))
}

/**
 * The summary shown on the pill: the `[元素]` line's element, on one line.
 *
 * A compact block packs the element, the selector and the source path onto one
 * line, so only the first `｜`-separated piece is the label.
 *
 * @param {string} text - The element's text.
 * @returns {string} The pill's label.
 */
function pillLabel(text) {
  const body = String(text ?? '')
  const group = /\[元素组\]\s*(\d+)\s*个界面元素/.exec(body)
  if (group !== null) return `${group[1]} 个元素`
  return chipLabelFromBlock(body)
}

/**
 * Fold one block into a pill.
 *
 * @param {object} options - Fold request.
 * @param {Document} options.doc - Owning document.
 * @param {Element} options.first - The block's first line element.
 * @returns {boolean} Whether a pill was created.
 */
function foldBlock({ doc, first }) {
  if (first.hasAttribute(FOLD_MARKER)) return false

  // A block may be one element (newlines inside it) or one element per field;
  // both shapes are collected the same way.
  const folded = [first]
  // The sentence the model form starts with belongs to the block: hide it too, so
  // the conversation shows the pill and no stray line of prose.
  let leading = first.previousElementSibling
  while (leading !== null && leading !== undefined && isModelLead(leading.textContent ?? '')) {
    folded.unshift(leading)
    leading = leading.previousElementSibling
  }
  let sibling = first.nextElementSibling
  while (sibling !== null && sibling !== undefined) {
    const text = (sibling.textContent ?? '').trim()
    if (OPENS_ANY_RE.test(text)) break
    if (!FIELD_RE.test(text)) break
    folded.push(sibling)
    sibling = sibling.nextElementSibling
  }

  const { pill } = createPill({ doc, text: first.textContent })

  const toggle = (event) => {
    event.preventDefault()
    event.stopPropagation()
    const open = pill.getAttribute('aria-expanded') === 'true'
    pill.setAttribute('aria-expanded', open ? 'false' : 'true')
    for (const element of folded) element.style.display = open ? 'none' : ''
  }

  pill.addEventListener('click', toggle)
  pill.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') toggle(event)
  })

  first.setAttribute(FOLD_MARKER, 'true')
  const anchor = folded[0]
  const host = anchor.parentElement ?? first.parentElement
  host?.insertBefore(pill, anchor)
  for (const element of folded) element.style.display = 'none'
  return true
}

/** A block hidden inside a text run, split out of the run's own text node. */
const RUN_MARKER = 'data-dsh-picker-folded-run'
const LF = String.fromCharCode(10)

/**
 * Build the pill that stands in for a block.
 *
 * @param {object} options - Pill request.
 * @param {Document} options.doc - Owning document.
 * @param {string} options.text - The block the pill stands for.
 * @returns {{ pill: Element, label: Element }} The pill and its label node.
 */
function createPill({ doc, text }) {
  const pill = doc.createElement('span')
  pill.setAttribute(PILL_MARKER, 'true')
  // `data-dsh-picker-ui` keeps the picker from picking our own pill.
  pill.setAttribute('data-dsh-picker-ui', 'transcript-pill')
  pill.setAttribute('role', 'button')
  pill.setAttribute('tabindex', '0')
  pill.setAttribute('title', '点击展开/收起完整定位信息')
  pill.setAttribute('aria-expanded', 'false')

  // The same window glyph the composer's chip carries, so a sent pick reads as
  // the same badge it was before it was sent.
  const icon = chipGlyph(doc)
  const glyph = doc.createElement('span')
  glyph.setAttribute('data-dsh-picker-pill-glyph', 'true')
  glyph.setAttribute('aria-hidden', 'true')
  if (icon === null) glyph.textContent = '❯'
  else glyph.appendChild(icon)

  const label = doc.createElement('span')
  label.setAttribute('data-dsh-picker-pill-label', 'true')
  label.textContent = pillLabel(text)

  pill.appendChild(glyph)
  pill.appendChild(label)
  return { pill, label }
}

/**
 * The character range the element block occupies inside one run of text.
 *
 * The block is line-shaped even when the application renders the whole message as
 * a single text node: the lead sentence (when present) and then the field lines.
 * Anything after them — the words the user typed themselves — stays outside the
 * range, so folding never takes text it did not write.
 *
 * @param {string} text - The run's text, newlines included.
 * @returns {{ start: number, end: number } | null} Offsets, or null when the text holds no block.
 */
function blockRangeIn(text) {
  const lines = String(text ?? '').split(LF)
  if (lines.length < 2) return null
  let start = -1
  let end = -1
  let offset = 0
  for (const line of lines) {
    const trimmed = line.trim()
    if (start < 0) {
      if (isModelLead(trimmed) || OPENS_ANY_RE.test(trimmed)) {
        start = offset
        end = offset + line.length
      }
    } else if (trimmed === '' || isModelLead(trimmed) || isBlockLine(trimmed)) {
      // A blank line inside a group payload is part of the block; anything that
      // is not a block line ends it.
      if (trimmed !== '') end = offset + line.length
    } else {
      break
    }
    offset += line.length + 1
  }
  return start < 0 ? null : { start, end }
}

/**
 * Put one text node back into an element, without assuming text-node support.
 *
 * @param {object} options - Append request.
 * @param {Document} options.doc - Owning document.
 * @param {Element} options.host - Element to append to.
 * @param {string} options.text - Text to append.
 * @returns {void}
 */
function appendText({ doc, host, text }) {
  if (text === '') return
  if (typeof doc.createTextNode === 'function') {
    host.appendChild(doc.createTextNode(text))
    return
  }
  const span = doc.createElement('span')
  span.setAttribute('data-dsh-picker-run-text', 'true')
  span.textContent = text
  host.appendChild(span)
}

/**
 * Fold only the block inside a run that also carries the user's own words.
 *
 * The run's text is split at the block's edges — the words before and after it
 * stay exactly where they were, as text — and the block itself moves into a
 * wrapper this module hides. Copying the message still sees every character.
 *
 * @param {object} options - Fold request.
 * @param {Document} options.doc - Owning document.
 * @param {Element} options.element - The element holding the run.
 * @param {{ start: number, end: number }} options.range - Where the block sits.
 * @returns {boolean} Whether a pill was created.
 */
function foldRunBlock({ doc, element, range }) {
  if (element.hasAttribute(FOLD_MARKER) || element.querySelector(`[${FOLD_MARKER}]`) !== null) return false
  if (element.children !== undefined && element.children.length > 0) return false
  const text = element.textContent ?? ''
  const block = text.slice(range.start, range.end)
  if (block.trim() === '') return false

  const { pill } = createPill({ doc, text: block })
  const wrapper = doc.createElement('span')
  wrapper.setAttribute(FOLD_MARKER, 'true')
  wrapper.setAttribute(RUN_MARKER, 'true')
  wrapper.textContent = block
  wrapper.style.display = 'none'

  const before = text.slice(0, range.start)
  const after = text.slice(range.end)
  element.textContent = ''
  appendText({ doc, host: element, text: before })
  element.appendChild(pill)
  element.appendChild(wrapper)
  appendText({ doc, host: element, text: after })

  const toggle = (event) => {
    event.preventDefault()
    event.stopPropagation()
    const open = pill.getAttribute('aria-expanded') === 'true'
    pill.setAttribute('aria-expanded', open ? 'false' : 'true')
    wrapper.style.display = open ? 'none' : ''
  }
  pill.addEventListener('click', toggle)
  pill.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') toggle(event)
  })
  return true
}

/**
 * Fold every sent element block that is not folded yet.
 *
 * Candidates are walked deepest first: the innermost element that holds nothing
 * but the block takes the pill. The application wraps a message several levels
 * deep, so the outermost match is usually a section that also holds the thinking
 * entry and the context injections — folding that hides the section itself and
 * leaves a pill inside a pill, one level per pass, which is what made a single
 * element need four clicks to open.
 *
 * @param {Document} doc - Owning document.
 * @returns {number} How many blocks were folded.
 */
export function foldTranscriptBlocks(doc) {
  let folded = 0
  const candidates = [...doc.querySelectorAll('p, li, div, pre, code, span')]
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const element = candidates[index]
    if (element.hasAttribute(FOLD_MARKER)) continue
    if (inComposer(element)) continue
    // A cell's content wrapper is a span, and the trajectory grid is a table: a
    // pill inserted among rows would move the columns, so only the innermost
    // element under a cell is folded.
    const parentTag = String(element.parentElement?.tagName ?? '').toUpperCase()
    if (parentTag === 'TR' || parentTag === 'TBODY' || parentTag === 'THEAD' || parentTag === 'TABLE') continue
    // A block already folded inside this element owns it, and so does a pill that
    // survived a re-render: folding again would stack one pill on another.
    if (element.querySelector(`[${FOLD_MARKER}]`) !== null) continue
    if (element.querySelector(`[${PILL_MARKER}]`) !== null) continue
    if (hasPillBefore(element)) continue
    const raw = element.textContent ?? ''
    const text = raw.trim()
    if (isBlockOnly(text)) {
      // An element that opens with the lead sentence and then lists the block is
      // the same block in another rendering (one text node, e.g. a table cell).
      if (!OPENS_ANY_RE.test(text) && !isModelLead(text.split(String.fromCharCode(10))[0])) continue
      if (foldBlock({ doc, first: element })) folded += 1
      continue
    }
    // A run that holds the block *and* the words the user typed around it: fold
    // the block on its own, so their sentence stays in the conversation.
    const range = blockRangeIn(raw)
    if (range === null) continue
    if (foldRunBlock({ doc, element, range })) folded += 1
  }
  return folded
}

/**
 * Keep sent element blocks folded as the transcript renders.
 *
 * @param {object} options - Watch request.
 * @param {Document} options.doc - Owning document.
 * @param {Window} options.win - Owning window.
 * @param {(message: string) => void} [options.onEvent] - Diagnostics sink.
 * @returns {() => void} Teardown.
 */
export function watchTranscript({ doc, win, onEvent }) {
  const note = typeof onEvent === 'function' ? onEvent : () => {}
  let queued = false

  const pass = () => {
    queued = false
    try {
      const folded = foldTranscriptBlocks(doc)
      if (folded > 0) note(`folded ${folded} sent element block(s) into pills`)
    } catch (error) {
      note(`transcript fold failed: ${String(error)}`)
    }
  }
  const schedule = () => {
    if (queued) return
    queued = true
    if (typeof win.requestAnimationFrame === 'function') win.requestAnimationFrame(pass)
    else setTimeout(pass, 16)
  }

  pass()
  if (typeof win.MutationObserver === 'function') {
    const observer = new win.MutationObserver(schedule)
    observer.observe(doc.body ?? doc.documentElement, { childList: true, subtree: true })
    return () => observer.disconnect()
  }
  return () => {}
}

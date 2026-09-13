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

/** Marker on the pill this module renders. Also keeps the picker off it. */
export const PILL_MARKER = 'data-dsh-picker-transcript-pill'

/** Marker on the block's first line element, which owns the fold. */
export const FOLD_MARKER = 'data-dsh-picker-folded'

/** A line that continues a block, and therefore hides with it. */
const FIELD_RE = /^(?:（\d+）)?\s*\[(?:元素|选择器|XPath|位置|样式|属性|源码|HTML)\]/

/** Every line a block may hold, including the header a group payload opens with. */
const BLOCK_LINE_RE = /^(?:（\d+）)?\s*\[(?:元素组|元素|选择器|XPath|位置|样式|属性|源码|HTML)\]/

/** The line that opens a block. */
const OPENS_RE = /^(?:（\d+）)?\s*\[元素\]\s*/

/** The line that opens a block, group payloads included. */
const OPENS_ANY_RE = /^(?:（\d+）)?\s*\[(?:元素组|元素)\]\s*/

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
  if (TAG_ANY_RE.test(rest)) return false
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
  return lines.every((line) => isBlockLine(line))
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
  const first = String(text ?? '')
    .split(String.fromCharCode(10))
    .find((line) => OPENS_RE.test(line.trim()) || /^\s*\[元素组\]/.test(line))
  const line = (first ?? '').trim()
  const piece = line.split('｜')[0]
  const label = piece.replace(/^\[元素组\]\s*/, '').replace(OPENS_RE, '').trim()
  return label.length > 60 ? `${label.slice(0, 60)}…` : label
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
  let sibling = first.nextElementSibling
  while (sibling !== null && sibling !== undefined) {
    const text = (sibling.textContent ?? '').trim()
    if (OPENS_ANY_RE.test(text)) break
    if (!FIELD_RE.test(text)) break
    folded.push(sibling)
    sibling = sibling.nextElementSibling
  }

  const pill = doc.createElement('span')
  pill.setAttribute(PILL_MARKER, 'true')
  // `data-dsh-picker-ui` keeps the picker from picking our own pill.
  pill.setAttribute('data-dsh-picker-ui', 'transcript-pill')
  pill.setAttribute('role', 'button')
  pill.setAttribute('tabindex', '0')
  pill.setAttribute('title', '点击展开/收起完整定位信息')
  pill.setAttribute('aria-expanded', 'false')

  const glyph = doc.createElement('span')
  glyph.setAttribute('data-dsh-picker-pill-glyph', 'true')
  glyph.textContent = '❯'
  glyph.setAttribute('aria-hidden', 'true')

  const label = doc.createElement('span')
  label.setAttribute('data-dsh-picker-pill-label', 'true')
  label.textContent = pillLabel(first.textContent)

  pill.appendChild(glyph)
  pill.appendChild(label)

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
  first.parentElement?.insertBefore(pill, first)
  for (const element of folded) element.style.display = 'none'
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
  const candidates = [...doc.querySelectorAll('p, li, div, pre')]
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const element = candidates[index]
    if (element.hasAttribute(FOLD_MARKER)) continue
    if (inComposer(element)) continue
    // Table rows are a virtualised grid: a pill among them moves the columns.
    const parentTag = String(element.parentElement?.tagName ?? '').toUpperCase()
    if (parentTag === 'TR' || parentTag === 'TBODY' || parentTag === 'THEAD') continue
    // A block already folded inside this element owns it, and so does a pill that
    // survived a re-render: folding again would stack one pill on another.
    if (element.querySelector(`[${FOLD_MARKER}]`) !== null) continue
    if (element.querySelector(`[${PILL_MARKER}]`) !== null) continue
    const before = element.previousElementSibling
    if (before !== null && before !== undefined && before.getAttribute(PILL_MARKER) !== null) continue
    const text = (element.textContent ?? '').trim()
    if (!OPENS_ANY_RE.test(text)) continue
    if (!isBlockOnly(text)) continue
    if (foldBlock({ doc, first: element })) folded += 1
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

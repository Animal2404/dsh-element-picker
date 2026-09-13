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

/** Field lines a folded block may contain. */
const FIELD_RE = /^\[(?:元素|选择器|XPath|位置|样式|属性|源码|HTML)\]/

/** The line that opens a block. */
const OPENS_RE = /^\[元素\]\s*/

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

/**
 * The summary shown on the pill: the `[元素]` line without its marker.
 *
 * @param {string} text - The block's first line.
 * @returns {string} The pill's label.
 */
function pillLabel(text) {
  const label = text.replace(OPENS_RE, '').trim()
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
  while (sibling !== null && FIELD_RE.test((sibling.textContent ?? '').trim())) {
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
  label.textContent = pillLabel((first.textContent ?? '').trim())

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
 * @param {Document} doc - Owning document.
 * @returns {number} How many blocks were folded.
 */
export function foldTranscriptBlocks(doc) {
  let folded = 0
  const candidates = doc.querySelectorAll('p, li, div')
  for (const element of candidates) {
    if (element.hasAttribute(FOLD_MARKER)) continue
    if (inComposer(element)) continue
    // Only the outermost element of a rendered line can start a block: a
    // container whose text merely contains the block is skipped in favour of
    // its child.
    const text = (element.textContent ?? '').trim()
    if (!OPENS_RE.test(text)) continue
    const inner = element.querySelector('p, li')
    if (inner !== null && OPENS_RE.test((inner.textContent ?? '').trim())) continue
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

/**
 * Selection mode: the floating pointer button, the hover highlight, the hint
 * bar, and the capture-phase event handling that turns a page click into a
 * picked element.
 *
 * Flow (matching ZCode's behaviour):
 *   click the floating button -> selection mode on, hovering outlines the
 *   resolved element -> click an element -> the pick is reported and selection
 *   mode exits -> click the button again (or press Escape) to leave without
 *   picking.
 *
 * While selection mode is on, the click must NOT reach the application: every
 * relevant event is swallowed in the capture phase, and the picker's own nodes
 * are excluded from hit-testing by their `data-dsh-picker-ui` marker.
 *
 * Plain DOM (no framework): the plugin's React entry only calls `toggle()`.
 */
import { resolveTarget } from './selector.js'

/** Marker attribute on every node this overlay owns. */
export const PICKER_MARKER = 'data-dsh-picker-ui'

/** Hint text shown while selection mode is on. */
export const HINT_TEXT = '选择模式：点击界面元素插入定位信息 · 再点按钮或 Esc 取消'

/** Event types swallowed in the capture phase while selection mode is on. */
const SWALLOWED_EVENTS = [
  'pointerdown',
  'mousedown',
  'mouseup',
  'pointerup',
  'contextmenu',
  'submit',
]

/**
 * @param {Document} doc - Owning document.
 * @returns {boolean} Whether the marker attribute names one of our nodes.
 */
function isOwnNode(node, doc) {
  if (node === null || node.nodeType !== 1) return false
  if (typeof node.closest !== 'function') return false
  return node.closest(`[${PICKER_MARKER}]`) !== null
}

/**
 * The mouse-pointer glyph, built without JSX so the bundle stays a classic
 * script.
 *
 * @param {Document} doc - Owning document.
 * @returns {Element} An inline SVG icon.
 */
function createIcon(doc) {
  const ns = 'http://www.w3.org/2000/svg'
  const svg = doc.createElementNS(ns, 'svg')
  svg.setAttribute('width', '20')
  svg.setAttribute('height', '20')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('aria-hidden', 'true')

  const path = doc.createElementNS(ns, 'path')
  path.setAttribute('d', 'M5 3l14 8-6 1.6L10.6 19z')
  path.setAttribute('fill', 'currentColor')
  svg.appendChild(path)

  const rays = doc.createElementNS(ns, 'path')
  rays.setAttribute('d', 'M3 3l2.4 2.4M3 8.4h3M8.4 3v3')
  rays.setAttribute('stroke', 'currentColor')
  rays.setAttribute('stroke-width', '1.6')
  rays.setAttribute('stroke-linecap', 'round')
  svg.appendChild(rays)

  return svg
}

/**
 * Create the picker controller for one document.
 *
 * @param {object} options - Controller options.
 * @param {Document} options.doc - Owning document.
 * @param {Window} options.win - Owning window.
 * @param {(element: Element, event: Event) => void} options.onPick - Called with
 *   the resolved element; selection mode has already been left.
 * @param {(event: { type: string, [key: string]: unknown }) => void} [options.onEvent]
 *   - Diagnostics sink (entering/leaving/undecided picks).
 * @returns {{ toggle: () => boolean, setActive: (next: boolean) => boolean,
 *   isActive: () => boolean, dispose: () => void, element: Element }} The
 *   controller.
 */
export function createPicker({ doc, win, onPick, onEvent }) {
  const emit = (event) => {
    if (typeof onEvent === 'function') onEvent(event)
  }

  const root = doc.createElement('div')
  root.id = 'dsh-element-picker-root'
  root.setAttribute(PICKER_MARKER, 'root')

  const button = doc.createElement('button')
  button.type = 'button'
  button.setAttribute(PICKER_MARKER, 'button')
  button.setAttribute('aria-label', '选择界面元素加入聊天')
  button.title = '选择界面元素加入聊天'
  button.appendChild(createIcon(doc))

  const highlight = doc.createElement('div')
  highlight.setAttribute(PICKER_MARKER, 'highlight')

  const hint = doc.createElement('div')
  hint.setAttribute(PICKER_MARKER, 'hint')
  hint.textContent = HINT_TEXT

  root.appendChild(button)
  root.appendChild(highlight)
  root.appendChild(hint)

  const host = doc.body ?? doc.documentElement
  host.appendChild(root)

  let active = false
  let current = null

  /**
   * @returns {{ x: number, y: number }} The current page scroll offset.
   */
  const scrollOffset = () => ({
    x: win.scrollX ?? doc.documentElement.scrollLeft ?? 0,
    y: win.scrollY ?? doc.documentElement.scrollTop ?? 0,
  })

  /**
   * Reposition the highlight over the current target, following scroll.
   *
   * @returns {void}
   */
  const paint = () => {
    if (current === null) {
      highlight.removeAttribute('data-dsh-picker-visible')
      return
    }
    const box = current.getBoundingClientRect()
    const scroll = scrollOffset()
    highlight.style.left = `${Math.round(box.left + scroll.x)}px`
    highlight.style.top = `${Math.round(box.top + scroll.y)}px`
    highlight.style.width = `${Math.round(box.width)}px`
    highlight.style.height = `${Math.round(box.height)}px`
    highlight.setAttribute('data-dsh-picker-visible', 'true')
  }

  /**
   * Resolve the element under a viewport point, ignoring the picker's own nodes.
   *
   * @param {number} x - Viewport x.
   * @param {number} y - Viewport y.
   * @returns {Element | null} The resolved target, else null.
   */
  const targetAt = (x, y) => {
    const stack =
      typeof doc.elementsFromPoint === 'function'
        ? doc.elementsFromPoint(x, y)
        : [doc.elementFromPoint(x, y)]
    for (const node of stack) {
      if (node === null || isOwnNode(node, doc)) continue
      return resolveTarget(node, doc)
    }
    return null
  }

  const onPointerMove = (event) => {
    if (!active) return
    const next = targetAt(event.clientX, event.clientY)
    if (next === current) return
    current = next
    paint()
  }

  const swallow = (event) => {
    if (!active) return
    if (isOwnNode(event.target, doc)) return
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
  }

  const onClick = (event) => {
    if (!active) return
    if (isOwnNode(event.target, doc)) return
    swallow(event)

    const element = targetAt(event.clientX, event.clientY)
    setActive(false)
    if (element === null) {
      emit({ type: 'pick-missed' })
      return
    }
    emit({ type: 'pick', selectorReady: true })
    onPick(element, event)
  }

  const onKeyDown = (event) => {
    if (!active) return
    if (event.key !== 'Escape') return
    swallow(event)
    setActive(false)
    emit({ type: 'cancel-escape' })
  }

  const onScrollOrResize = () => {
    if (active) paint()
  }

  /**
   * Enter or leave selection mode.
   *
   * @param {boolean} next - Desired state.
   * @returns {boolean} The state after the call.
   */
  function setActive(next) {
    if (next === active) return active
    active = next
    root.setAttribute('data-dsh-picker-active', active ? 'true' : 'false')
    button.setAttribute('aria-pressed', active ? 'true' : 'false')

    if (!active) {
      current = null
      highlight.removeAttribute('data-dsh-picker-visible')
    }
    emit({ type: active ? 'enter' : 'leave' })
    return active
  }

  button.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    setActive(!active)
  })

  doc.addEventListener('pointermove', onPointerMove, true)
  doc.addEventListener('click', onClick, true)
  doc.addEventListener('keydown', onKeyDown, true)
  for (const type of SWALLOWED_EVENTS) doc.addEventListener(type, swallow, true)
  win.addEventListener('scroll', onScrollOrResize, true)
  win.addEventListener('resize', onScrollOrResize, true)

  return {
    element: root,
    isActive: () => active,
    setActive,
    toggle: () => setActive(!active),
    dispose: () => {
      doc.removeEventListener('pointermove', onPointerMove, true)
      doc.removeEventListener('click', onClick, true)
      doc.removeEventListener('keydown', onKeyDown, true)
      for (const type of SWALLOWED_EVENTS) doc.removeEventListener(type, swallow, true)
      win.removeEventListener('scroll', onScrollOrResize, true)
      win.removeEventListener('resize', onScrollOrResize, true)
      root.remove()
    },
  }
}

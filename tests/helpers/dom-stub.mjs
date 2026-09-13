/**
 * Minimal DOM stand-in for the suites that must run under plain `node --test`
 * in CI, with zero dependencies.
 *
 * It implements only what the picker touches: element creation and attributes,
 * a small selector matcher (tag / #id / .class / [attr] / [attr="v"] /
 * :nth-of-type with `>` combinators — exactly the subset `selector.js` emits),
 * event listeners with capture ordering, and a configurable `execCommand` so the
 * insertion cascade can be exercised both ways.
 */

/**
 * Parse a compound selector such as `button[aria-label="x"].primary` into
 * matchers.
 *
 * @param {string} compound - One compound selector (no combinators).
 * @returns {{ tag: string | null, id: string | null, classes: string[], attrs: { name: string, value: string | null }[], nth: number | null }}
 *   The parsed pieces.
 */
function parseCompound(compound) {
  const result = { tag: null, id: null, classes: [], attrs: [], nth: null }
  const pattern = /([a-zA-Z][\w-]*)|#([\w-]+)|\.([\w-]+)|\[([\w-]+)(?:="([^"]*)")?\]|:nth-of-type\((\d+)\)/g
  let match
  let first = true
  while ((match = pattern.exec(compound)) !== null) {
    if (match[1] !== undefined) {
      if (first) result.tag = match[1].toUpperCase()
    } else if (match[2] !== undefined) {
      result.id = match[2]
    } else if (match[3] !== undefined) {
      result.classes.push(match[3])
    } else if (match[4] !== undefined) {
      result.attrs.push({ name: match[4], value: match[5] ?? null })
    } else if (match[6] !== undefined) {
      result.nth = Number(match[6])
    }
    first = false
  }
  return result
}

/**
 * @param {object} node - Candidate node.
 * @param {string} compound - Compound selector.
 * @returns {boolean} Whether the node matches.
 */
function matchesCompound(node, compound) {
  const parsed = parseCompound(compound)
  if (node === null || node.nodeType !== 1) return false
  if (parsed.tag !== null && node.tagName !== parsed.tag) return false
  if (parsed.id !== null && node.getAttribute('id') !== parsed.id) return false
  for (const name of parsed.classes) {
    if (!node.classList.contains(name)) return false
  }
  for (const attr of parsed.attrs) {
    const value = node.getAttribute(attr.name)
    if (value === null) return false
    if (attr.value !== null && value !== attr.value) return false
  }
  if (parsed.nth !== null) {
    const parent = node.parentElement
    if (parent === null) return false
    const sameTag = parent.children.filter((child) => child.tagName === node.tagName)
    if (sameTag.indexOf(node) + 1 !== parsed.nth) return false
  }
  return true
}

/**
 * Test a node against a selector built from `>` combinators.
 *
 * @param {object} node - Candidate node.
 * @param {string} selector - Selector text.
 * @returns {boolean} Whether the node matches.
 */
export function matchesSelector(node, selector) {
  // A comma-separated list matches when any of its selectors matches.
  if (selector.includes(',')) {
    return selector.split(',').some((part) => matchesSelector(node, part.trim()))
  }
  const compounds = selector.split('>').map((part) => part.trim())
  if (compounds.length === 0) return false
  let current = node
  for (let index = compounds.length - 1; index >= 0; index -= 1) {
    if (current === null || !matchesCompound(current, compounds[index])) return false
    current = current.parentElement
  }
  return true
}

/**
 * Create a document-like object with an optional <html><body> skeleton.
 *
 * @param {object} [options] - Stub options.
 * @param {boolean} [options.skeleton] - Create html/head/body.
 * @returns {object} The document stub.
 */
export function createDocument(options = {}) {
  const listeners = new Map()
  const exec = { result: false }
  // Selection/Range stubs: the insert cascade places a caret inside the editor
  // before driving it, and both facts are asserted by the suites.
  const selection = {
    anchorNode: null,
    node: null,
    removeAllRanges() {
      selection.node = null
    },
    addRange(range) {
      selection.node = range.node
    },
  }

  const doc = {
    nodeType: 9,
    listeners,
    exec,
    selection,
    getSelection() {
      return selection
    },
    createRange() {
      return {
        node: null,
        selectNodeContents(element) {
          this.node = element
        },
        collapse() {},
      }
    },
    createElement(tag) {
      return createElement(tag, doc)
    },
    createElementNS(_ns, tag) {
      return createElement(tag, doc)
    },
    getElementById(id) {
      return doc.querySelectorAll(`#${id}`)[0] ?? null
    },
    querySelectorAll(selector) {
      const out = []
      const visit = (node) => {
        if (node.nodeType === 1 && matchesSelector(node, selector)) out.push(node)
        for (const child of node.children ?? []) visit(child)
      }
      visit(doc.documentElement)
      return out
    },
    querySelector(selector) {
      return doc.querySelectorAll(selector)[0] ?? null
    },
    addEventListener(type, handler, capture) {
      const key = capture ? `${type}:capture` : type
      if (!listeners.has(key)) listeners.set(key, [])
      listeners.get(key).push(handler)
    },
    removeEventListener(type, handler, capture) {
      const key = capture ? `${type}:capture` : type
      const list = listeners.get(key) ?? []
      const index = list.indexOf(handler)
      if (index >= 0) list.splice(index, 1)
    },
    execCommand(command, _ui, text) {
      return exec.run !== undefined ? exec.run(command, text) : exec.result
    },
  }

  if (options.skeleton !== false) {
    const html = createElement('html', doc)
    const head = createElement('head', doc)
    const body = createElement('body', doc)
    html.appendChild(head)
    html.appendChild(body)
    doc.documentElement = html
    doc.head = head
    doc.body = body
  } else {
    doc.documentElement = null
    doc.head = null
    doc.body = null
  }

  return doc
}

/**
 * Create an element stub.
 *
 * @param {string} tag - Tag name.
 * @param {object} doc - Owning document stub.
 * @returns {object} The element stub.
 */
export function createElement(tag, doc) {
  const attrs = new Map()
  const listeners = new Map()
  const classes = []
  let text = ''

  const node = {
    nodeType: 1,
    tagName: tag.toUpperCase(),
    children: [],
    parentElement: null,
    ownerDocument: doc,
    style: {},
    title: '',
    type: '',
    focused: false,
    classList: {
      get length() {
        return classes.length
      },
      item: (index) => classes[index] ?? null,
      contains: (name) => classes.includes(name),
      add: (name) => {
        if (!classes.includes(name)) classes.push(name)
      },
      remove: (name) => {
        const index = classes.indexOf(name)
        if (index >= 0) classes.splice(index, 1)
      },
      // `selector.js` reads classes with Array.from(...), so the stub must be
      // iterable rather than merely array-like.
      [Symbol.iterator]: () => classes[Symbol.iterator](),
    },
    get textContent() {
      if (text !== '') return text
      return node.children.map((child) => child.textContent).join('')
    },
    set textContent(value) {
      text = value
    },
    get outerHTML() {
      const attrsText = [...attrs.entries()]
        .map(([name, value]) => (value === '' ? ` ${name}` : ` ${name}="${value}"`))
        .join('')
      return `<${tag}${attrsText}>${node.textContent}</${tag}>`
    },
    getAttribute: (name) => (attrs.has(name) ? attrs.get(name) : null),
    setAttribute: (name, value) => {
      attrs.set(name, String(value))
    },
    removeAttribute: (name) => {
      attrs.delete(name)
    },
    hasAttribute: (name) => attrs.has(name),
    appendChild(child) {
      child.parentElement = node
      node.children.push(child)
      return child
    },
    removeChild(child) {
      const index = node.children.indexOf(child)
      if (index >= 0) node.children.splice(index, 1)
      child.parentElement = null
      return child
    },
    remove() {
      if (node.parentElement !== null) node.parentElement.removeChild(node)
    },
    contains(other) {
      if (other === node) return true
      return node.children.some((child) => child.contains?.(other) === true)
    },
    querySelectorAll(selector) {
      const found = []
      const visit = (parent) => {
        for (const child of parent.children ?? []) {
          if (matchesSelector(child, selector)) found.push(child)
          visit(child)
        }
      }
      visit(node)
      return found
    },
    querySelector(selector) {
      return node.querySelectorAll(selector)[0] ?? null
    },
    get nextElementSibling() {
      const parent = node.parentElement
      if (parent === null) return null
      const index = parent.children.indexOf(node)
      return index < 0 ? null : (parent.children[index + 1] ?? null)
    },
    get previousElementSibling() {
      const parent = node.parentElement
      if (parent === null) return null
      const index = parent.children.indexOf(node)
      return index <= 0 ? null : (parent.children[index - 1] ?? null)
    },
    closest(selector) {
      let current = node
      while (current !== null) {
        if (matchesSelector(current, selector)) return current
        current = current.parentElement
      }
      return null
    },
    matches: (selector) => matchesSelector(node, selector),
    focus() {
      node.focused = true
      if (doc.activeElement !== undefined) doc.activeElement = node
    },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 }),
    addEventListener(type, handler, capture) {
      const key = capture ? `${type}:capture` : type
      if (!listeners.has(key)) listeners.set(key, [])
      listeners.get(key).push(handler)
    },
    removeEventListener(type, handler, capture) {
      const key = capture ? `${type}:capture` : type
      const list = listeners.get(key) ?? []
      const index = list.indexOf(handler)
      if (index >= 0) list.splice(index, 1)
    },
    dispatchEvent(event) {
      for (const key of [event.type, `${event.type}:capture`]) {
        for (const handler of listeners.get(key) ?? []) handler(event)
      }
      return event.defaultPrevented !== true
    },
  }

  return node
}

/**
 * Create a window-like object over a document stub.
 *
 * @param {object} doc - Document stub.
 * @param {object} [computedStyle] - Style object returned by getComputedStyle.
 * @returns {object} The window stub.
 */
export function createWindow(doc, computedStyle = {}) {
  const listeners = new Map()
  const observers = []

  /**
   * Minimal MutationObserver stub: records the observer so a test can fire it
   * explicitly, which is how the layout re-anchor is exercised.
   */
  class StubMutationObserver {
    constructor(callback) {
      this.callback = callback
      this.target = null
      this.disconnected = false
      observers.push(this)
    }

    observe(target, options) {
      this.target = target
      this.options = options
    }

    disconnect() {
      this.disconnected = true
    }

    /** @returns {void} Invoke the callback the way a mutation would. */
    trigger() {
      this.callback([])
    }
  }

  return {
    document: doc,
    scrollX: 0,
    scrollY: 0,
    listeners,
    observers,
    MutationObserver: StubMutationObserver,
    requestAnimationFrame: (callback) => {
      callback()
      return 0
    },
    getComputedStyle: () => computedStyle,
    addEventListener(type, handler, capture) {
      const key = capture ? `${type}:capture` : type
      if (!listeners.has(key)) listeners.set(key, [])
      listeners.get(key).push(handler)
    },
    removeEventListener(type, handler, capture) {
      const key = capture ? `${type}:capture` : type
      const list = listeners.get(key) ?? []
      const index = list.indexOf(handler)
      if (index >= 0) list.splice(index, 1)
    },
  }
}

/**
 * Build a click-like event object for the overlay's capture listeners.
 *
 * @param {string} type - Event type.
 * @param {object} [init] - Overrides (clientX, clientY, key, target).
 * @returns {object} The event stub.
 */
export function createEvent(type, init = {}) {
  return {
    type,
    target: init.target ?? null,
    clientX: init.clientX ?? 0,
    clientY: init.clientY ?? 0,
    key: init.key ?? '',
    defaultPrevented: false,
    prevented: false,
    stopped: false,
    preventDefault() {
      this.defaultPrevented = true
      this.prevented = true
    },
    stopPropagation() {
      this.stopped = true
    },
    stopImmediatePropagation() {
      this.stopped = true
    },
  }
}

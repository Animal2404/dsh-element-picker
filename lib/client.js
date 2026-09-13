window.__ModuleLoader__.load({ id: "@dsh-external/dsh-element-picker",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;

	//#region @dsh-external/dsh-element-picker/src
/**
 * Overlay styles, injected as a single <style> element by the plugin.
 *
 * Namespaced under the picker's own root and its `data-dsh-picker-ui` markers,
 * so nothing here can collide with DSH's CSS-module classes. No `!important`:
 * the overlay is its own stacking layer, not a fight with the app's styles.
 *
 * The picker owns no button of its own — its one control is the entry in the
 * composer tool row — so this layer is purely the highlight and the hint, and it
 * never intercepts pointer events.
 */
const PICKER_CSS = `
#dsh-element-picker-root {
  position: fixed;
  inset: 0;
  width: 0;
  height: 0;
  z-index: 2147483000;
  pointer-events: none;
}

/* ZCode's selection box. The colour comes from DSH's own palette — blue-500,
   the vivid blue DSH uses for its primary surfaces — rather than a hardcoded
   accent, with a 16% tint of the same colour as the fill.
   (Note: --dsw-alias-brand-primary is near-white in this theme, so it is not the
   right token here.) */
[data-dsh-picker-ui="highlight"] {
  position: fixed;
  display: none;
  pointer-events: none;
  background: rgba(59, 130, 246, 0.16);
  background: color-mix(in srgb, var(--dsw-static-blue-500, #3b82f6) 16%, transparent);
  outline: 2px solid var(--dsw-static-blue-500, #3b82f6);
  outline-offset: -1px;
  border-radius: 2px;
}

[data-dsh-picker-ui="highlight"][data-dsh-picker-visible="true"] {
  display: block;
}

/* Top centre, not the bottom: parked above the composer it covered the very
   thing the user is typing into. */
/* Hover card: tag and size on the first row, then Color and Font. */
/* DSH's own design tokens (defined on body / body[data-ds-dark-theme] by
   dsh-client-ui-theme) so the card follows the active theme instead of a
   hardcoded dark surface; the literals are only fallbacks for a build without
   them. */
[data-dsh-picker-ui="info"] {
  position: fixed;
  display: none;
  min-width: 180px;
  max-width: 300px;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-2, var(--dsw-alias-bg-layer-3, rgba(20, 22, 27, 0.97)));
  border: 1px solid var(--dsw-elevation-stroke-color, rgba(255, 255, 255, 0.12));
  box-shadow: var(--dsw-elevation-soft, 0 8px 24px rgba(0, 0, 0, 0.45));
  color: var(--dsw-alias-label-primary, #e5e7eb);
  font: 12px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  pointer-events: none;
  z-index: 1;
}

[data-dsh-picker-ui="info"][data-dsh-picker-visible="true"] {
  display: block;
}

[data-dsh-picker-ui="info"] [data-dsh-picker-row] {
  display: flex;
  align-items: baseline;
  gap: 12px;
  justify-content: space-between;
}

[data-dsh-picker-ui="info"] [data-dsh-picker-row="0"] {
  font-weight: 600;
}

[data-dsh-picker-cell^="info-color-label"],
[data-dsh-picker-cell^="info-font-label"] {
  color: var(--dsw-alias-label-secondary, #8b93a1);
}

[data-dsh-picker-cell^="info-"]:not([data-dsh-picker-cell^="info-color-label"]):not([data-dsh-picker-cell^="info-font-label"]) {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Sits below the session header: at the very top it covered the header's own
   controls. The conic ring (same recipe as the control, turning slower because
   this one is always on screen) draws its border. */
[data-dsh-picker-ui="hint"] {
  position: fixed;
  left: 50%;
  top: 88px;
  transform: translateX(-50%);
  display: none;
  max-width: 70vw;
  padding: 6px 14px;
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-2, var(--dsw-alias-bg-layer-3, rgba(22, 24, 29, 0.94)));
  color: var(--dsw-alias-label-primary, #e5e7eb);
  font: 12px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  white-space: nowrap;
  box-shadow: var(--dsw-elevation-soft, 0 6px 20px rgba(0, 0, 0, 0.35));
  pointer-events: none;
}

[data-dsh-picker-ui="hint"]::after {
  content: "";
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  padding: 2px;
  border-radius: 8px;
  background-image: conic-gradient(
    #488cfb,
    #29dbbc,
    #ddf505,
    #ff9f0e,
    #e440bb,
    #655adc,
    #488cfb
  );
  -webkit-mask-image: linear-gradient(#000, #000), linear-gradient(#000, #000);
  mask-image: linear-gradient(#000, #000), linear-gradient(#000, #000);
  -webkit-mask-origin: content-box, padding-box;
  mask-origin: content-box, padding-box;
  -webkit-mask-clip: content-box, padding-box;
  mask-clip: content-box, padding-box;
  mask-composite: exclude;
  -webkit-mask-composite: destination-out;
  filter: hue-rotate(0);
  animation: dsh-picker-rotate-hue linear 6s infinite;
  animation-play-state: running;
  pointer-events: none;
}

/* Neon ring on the picker's control, adapted from the Uiverse
   "ShadowShahriar" button: a conic gradient masked down to the border box only.
   Two adaptations were needed. (1) It is scoped to our control instead of every
   button. (2) The source geometry targets a large button (15px radius, 4px
   ring); this control is a 28x28 icon button, so the ring is 2px and its radius
   matches the control's own 6px, which is what keeps the ring hugging its edge.
   The radius and width stay custom properties, so tuning is one value. */
/* The anchor is sized inline: zero when the control is offset onto a row, and
   control-sized when it takes part in the layout (see the measure step). */
[data-dsh-picker-ui="slot-anchor"] {
  position: relative;
  pointer-events: none;
}

[data-dsh-picker-ui="slot-button"] {
  --dsh-picker-ring-width: 2px;
  --dsh-picker-ring-radius: 6px;
  position: relative;
  z-index: 2;
  /* The zero-size anchor is pointer-events:none so it never intercepts the
     footer; the control itself must stay clickable. */
  pointer-events: auto;
}

[data-dsh-picker-ui="slot-button"]::after {
  content: "";
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  padding: var(--dsh-picker-ring-width);
  border-radius: var(--dsh-picker-ring-radius);
  background-image: conic-gradient(
    #488cfb,
    #29dbbc,
    #ddf505,
    #ff9f0e,
    #e440bb,
    #655adc,
    #488cfb
  );
  -webkit-mask-image: linear-gradient(#000, #000), linear-gradient(#000, #000);
  mask-image: linear-gradient(#000, #000), linear-gradient(#000, #000);
  -webkit-mask-origin: content-box, padding-box;
  mask-origin: content-box, padding-box;
  -webkit-mask-clip: content-box, padding-box;
  mask-clip: content-box, padding-box;
  mask-composite: exclude;
  -webkit-mask-composite: destination-out;
  filter: hue-rotate(0);
  /* Slow and always on: the ring is the control's only state cue, so it turns
     before the click (inviting one) and keeps turning after it. */
  animation: dsh-picker-rotate-hue linear 3s infinite;
  animation-play-state: running;
  pointer-events: none;
}

/* Selecting is the working state, so the ring turns faster. */
[data-dsh-picker-ui="slot-button"][aria-pressed="true"]::after {
  animation-duration: 900ms;
}

[data-dsh-picker-ui="slot-button"]:active {
  --dsh-picker-ring-width: 3px;
}

@keyframes dsh-picker-rotate-hue {
  to {
    filter: hue-rotate(1turn);
  }
}

/* A sent element block folded into a pill. The tokens are DSH's own chip
   tokens (interactive-bg-hover surface, business-primary text, 22px pill), so
   the transcript pill matches the composer chip exactly. */
[data-dsh-picker-transcript-pill] {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  height: 22px;
  max-width: 240px;
  padding: 0 6px;
  border-radius: 6px;
  background: var(--dsw-alias-interactive-bg-hover, rgba(255, 255, 255, 0.06));
  color: var(--dsw-alias-state-business-primary, #4d6bfe);
  font-size: 13px;
  line-height: 22px;
  vertical-align: bottom;
  cursor: pointer;
  user-select: none;
}

[data-dsh-picker-transcript-pill]:hover {
  background: var(--dsw-alias-bg-layer-3, rgba(255, 255, 255, 0.1));
}

[data-dsh-picker-pill-label] {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

[data-dsh-picker-pill-glyph] {
  flex: none;
  transition: transform 120ms ease;
}

[data-dsh-picker-transcript-pill][aria-expanded="true"] [data-dsh-picker-pill-glyph] {
  transform: rotate(90deg);
}

/* Hovering a picker chip lists what it holds, like ZCode's picked-element pill.
   It takes pointer events so the list can actually be scrolled, and scrolls with
   DSH's own scrollbar colours. */
[data-dsh-picker-ui="chip-preview"] {
  position: fixed;
  display: none;
  z-index: 2147483001;
  min-width: 220px;
  max-width: 340px;
  max-height: 40vh;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
  scrollbar-color: var(--dsh-scrollbar-thumb, rgba(255, 255, 255, 0.2)) transparent;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-2, rgba(20, 22, 27, 0.98));
  border: 1px solid var(--dsw-elevation-stroke-color, rgba(255, 255, 255, 0.12));
  box-shadow: var(--dsw-elevation-soft, 0 8px 24px rgba(0, 0, 0, 0.45));
  color: var(--dsw-alias-label-primary, #e5e7eb);
  font: 12px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  pointer-events: auto;
}

[data-dsh-picker-ui="chip-preview"][data-dsh-picker-visible="true"] {
  display: block;
}

[data-dsh-picker-ui="chip-preview"]::-webkit-scrollbar {
  width: 8px;
}

[data-dsh-picker-ui="chip-preview"]::-webkit-scrollbar-thumb {
  border-radius: 4px;
  background: var(--dsh-scrollbar-thumb, rgba(255, 255, 255, 0.2));
}

[data-dsh-picker-preview-item] {
  padding: 4px 0;
}

[data-dsh-picker-preview-item] + [data-dsh-picker-preview-item] {
  border-top: 1px solid var(--dsw-elevation-stroke-color, rgba(255, 255, 255, 0.08));
}

[data-dsh-picker-preview-summary] {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

[data-dsh-picker-preview-meta] {
  color: var(--dsw-alias-label-secondary, #cfd3d6);
  font-size: 12px;
}

[data-dsh-picker-preview-origin] {
  color: var(--dsw-alias-label-tertiary, #8b93a1);
  font-size: 11px;
}

/* The remove affordance on a picker chip, drawn as a pseudo-element on the chip's
   own span: the span is React's portal container, so a real injected child would
   sit outside React's managed tree and could be dropped by a re-render. The
   matching hit region is handled in JS (see watchChipRemoval). */
[data-composer-chip="element-picker"]::after {
  content: "×";
  margin-left: 4px;
  padding: 0 2px;
  border-radius: 4px;
  color: var(--dsw-alias-label-tertiary, #9aa1ac);
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
}

[data-composer-chip="element-picker"]:hover::after {
  background: var(--dsw-alias-bg-layer-3, rgba(255, 255, 255, 0.16));
  color: var(--dsw-alias-label-primary, #ffffff);
}

/* While selecting, clicks belong to the picker, so the × cannot act: it is shown
   dimmed rather than looking clickable. */
[data-dsh-picker-active="true"] [data-composer-chip="element-picker"]::after {
  opacity: 0.35;
  cursor: default;
}

[data-dsh-picker-active="true"] [data-dsh-picker-ui="hint"] {
  display: block;
}

[data-dsh-picker-active="true"] {
  cursor: crosshair;
}
`

/** Stylesheet element id, used to keep injection idempotent. */
const PICKER_STYLE_ID = 'dsh-element-picker-style'

/**
 * Install the overlay stylesheet once.
 *
 * @param {Document} doc - Owning document.
 * @returns {() => void} Teardown that removes the stylesheet.
 */
function installStyles(doc) {
  if (doc.getElementById(PICKER_STYLE_ID) !== null) return () => {}
  const style = doc.createElement('style')
  // Attribute, not the `id` property: `getElementById` is the idempotence
  // guard, and it reads the attribute.
  style.setAttribute('id', PICKER_STYLE_ID)
  style.textContent = PICKER_CSS
  doc.head.appendChild(style)
  return () => {
    style.remove()
  }
}


	//#region @dsh-external/dsh-element-picker/src
/**
 * CSS selector generation for a picked DOM element.
 *
 * Strategy: prefer a short, stable, unique selector; fall back to an
 * ancestor-anchored path, then to a positional path. The generator never
 * returns a selector that fails `querySelectorAll(...).length === 1` unless the
 * document is genuinely ambiguous, in which case the positional path wins by
 * construction.
 *
 * Pure functions only (element in, string out) so the suite runs under plain
 * `node --test` against a DOM stub, and the same code runs unchanged inside the
 * DSH page.
 */

/**
 * Attributes whose values are stable enough to build a readable selector from.
 *
 * Used only when generating a selector for an element that has already been
 * chosen. `data-phase` is deliberately absent: DSH puts it on whole panels
 * (a session root, the composer) with values that change at runtime, so it is
 * neither a unique nor a stable selector anchor.
 */
const STABLE_ATTRIBUTES = [
  'data-composer-card',
  'data-input-scroll',
  'data-composer-input',
  'data-composer-seat',
  'data-composer-placeholder',
  'data-shell-overlay',
  'data-testid',
  'data-test-id',
  'data-id',
  'name',
  'aria-label',
  'role',
  'type',
]

/** Elements that may carry an `id` worth using verbatim. */
const ID_SAFE = /^[A-Za-z_][\w-]*$/

/**
 * @param {string} value - Raw attribute value.
 * @returns {string} The value with quotes and backslashes escaped.
 */
function escapeAttrValue(value) {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

/**
 * @param {string} value - Raw identifier text.
 * @returns {string} A CSS-escaped identifier.
 */
function escapeIdent(value) {
  return value.replace(/([^\w-])/g, '\\$1')
}

/**
 * Test whether a selector matches exactly one element in its document.
 *
 * @param {Element} element - The element the selector should resolve to.
 * @param {string} selector - Candidate selector.
 * @returns {boolean} True when `selector` resolves to exactly `element`.
 */
function isUniqueSelector(element, selector) {
  try {
    const found = element.ownerDocument.querySelectorAll(selector)
    return found.length === 1 && found[0] === element
  } catch {
    return false
  }
}

/**
 * Build a `tag > tag:nth-of-type(n)` path from the document root down to the
 * element, optionally stopping above an exclusive ancestor.
 *
 * @param {Element} element - Target element.
 * @param {Element | null} stopAbove - Ancestor to stop above, exclusive.
 * @returns {string} A CSS selector resolving to `element`.
 */
function positionalSteps(element, stopAbove) {
  const steps = []
  let node = element
  while (node !== null && node.nodeType === 1 && node !== stopAbove) {
    const tag = node.tagName.toLowerCase()
    const parent = node.parentElement
    if (parent === null || parent === stopAbove) {
      steps.unshift(tag)
      break
    }
    const sameTag = Array.from(parent.children).filter(
      (child) => child.tagName === node.tagName,
    )
    const index = sameTag.indexOf(node) + 1
    steps.unshift(sameTag.length === 1 ? tag : `${tag}:nth-of-type(${index})`)
    node = parent
  }
  return steps.join(' > ')
}

/**
 * Collect short candidate selectors, ordered from most to least readable. Each
 * candidate is validated for uniqueness by the caller.
 *
 * @param {Element} element - Target element.
 * @returns {string[]} Candidate selectors, possibly empty.
 */
function shortCandidates(element) {
  const candidates = []
  const tag = element.tagName.toLowerCase()

  const id = element.getAttribute('id')
  if (id !== null && ID_SAFE.test(id)) candidates.push(`#${id}`)

  for (const attr of STABLE_ATTRIBUTES) {
    const value = element.getAttribute(attr)
    if (value === null) continue
    // Presence flags carry no value (`data-composer-card`), so an empty value
    // must yield the bare attribute form instead of being skipped.
    candidates.push(
      value === ''
        ? `${tag}[${attr}]`
        : `${tag}[${attr}="${escapeAttrValue(value)}"]`,
    )
  }

  const classes = Array.from(element.classList).filter((name) => name !== '')
  if (classes.length > 0) {
    candidates.push(`${tag}.${classes.map(escapeIdent).join('.')}`)
    candidates.push(`.${escapeIdent(classes[0])}`)
  }

  return candidates
}

/**
 * @param {Element} element - Candidate ancestor.
 * @returns {string | null} A unique short selector, or null when none is unique.
 */
function uniqueShortSelector(element) {
  for (const candidate of shortCandidates(element)) {
    if (isUniqueSelector(element, candidate)) return candidate
  }
  return null
}

/**
 * Generate the best available selector for an element.
 *
 * @param {Element} element - Target element.
 * @returns {string} A CSS selector resolving to `element`.
 */
function generateSelector(element) {
  const direct = uniqueShortSelector(element)
  if (direct !== null) return direct

  // Short candidates were ambiguous or absent: anchor on the closest ancestor
  // that IS uniquely addressable, then walk down positionally.
  let ancestor = element.parentElement
  while (ancestor !== null && ancestor !== element.ownerDocument.documentElement) {
    const prefix = uniqueShortSelector(ancestor)
    if (prefix !== null) {
      const combined = `${prefix} > ${positionalSteps(element, ancestor)}`
      if (isUniqueSelector(element, combined)) return combined
    }
    ancestor = ancestor.parentElement
  }

  return positionalSteps(element, null)
}

/**
 * Build an absolute XPath for an element, as a complement to the CSS selector
 * (useful when the selector is ambiguous, e.g. inside shadow roots).
 *
 * @param {Element} element - Target element.
 * @returns {string} An XPath resolving to `element`.
 */
function generateXPath(element) {
  const parts = []
  let node = element
  while (node !== null && node.nodeType === 1) {
    const tag = node.tagName.toLowerCase()
    const parent = node.parentElement
    if (parent === null) {
      parts.unshift(tag)
      break
    }
    const sameTag = Array.from(parent.children).filter(
      (child) => child.tagName === node.tagName,
    )
    parts.unshift(
      sameTag.length === 1 ? tag : `${tag}[${sameTag.indexOf(node) + 1}]`,
    )
    node = parent
  }
  return `/${parts.join('/')}`
}

/**
 * A short human-readable summary of an element, e.g. `button.primary "Send"`.
 *
 * @param {Element} element - Target element.
 * @returns {string} A one-line summary.
 */
function describeElement(element) {
  const tag = element.tagName.toLowerCase()
  const id = element.getAttribute('id')
  let head = id !== null && ID_SAFE.test(id) ? `${tag}#${id}` : tag

  const firstClass = element.classList.item(0)
  if (firstClass !== null) head += `.${firstClass}`

  const text = (element.textContent ?? '').replace(/\s+/g, ' ').trim()
  if (text === '') return head
  const clipped = text.length > 40 ? `${text.slice(0, 40)}…` : text
  return `${head} "${clipped}"`
}


	//#region @dsh-external/dsh-element-picker/src
/**
 * Stable DOM hook -> DSH source file.
 *
 * This is what makes the picker worth having inside DSH instead of in a generic
 * browser extension: the inserted block tells the agent which source file
 * renders the element it is looking at, so a request like "move this button"
 * starts from a file path instead of a CSS class hash.
 *
 * Scope: hooks the Web UI sets on purpose (`data-*` markers, not CSS-module
 * class names, which are build-time hashes). Paths are repository paths of the
 * DSH source tree; the hook set is verified against the running 0.1.5-rc.2
 * client bundle, and a hook that no longer exists simply stops matching.
 */
const HOOK_SOURCES = {
  'data-composer-card': {
    path: 'packages/client/ui-conversation/src/client/skeleton/InputBar.tsx',
    note: 'composer card capsule',
  },
  'data-input-scroll': {
    path: 'packages/client/ui-conversation/src/client/skeleton/InputBar.tsx',
    note: 'composer scrollport',
  },
  'data-composer-placeholder': {
    path: 'packages/client/ui-conversation/src/client/skeleton/InputBar.tsx',
    note: 'composer placeholder',
  },
  'data-composer-seat': {
    path: 'packages/client/ui-conversation/src/client/skeleton/ConversationRoot.tsx',
    note: 'composer seat',
  },
  'data-composer-input': {
    path: 'packages/client/ui-conversation/src/client/input/editor/ComposerContentEditable.tsx',
    note: 'the editable input itself',
  },
  'data-composer-chip': {
    path: 'packages/client/ui-conversation/src/client/input/editor/chip-node.tsx',
    note: 'reference chip node',
  },
  'data-composer-text-ref': {
    path: 'packages/client/ui-conversation/src/client/input/editor/text-ref.ts',
    note: 'plain-text reference decoration',
  },
  'data-shell-overlay': {
    path: 'packages/client/ui-layout/src/client/AppFrame.tsx',
    note: 'frame-wide overlay layer',
  },
}

/** Hook attribute names, longest first so a specific hook wins over a prefix. */
const HOOK_NAMES = Object.keys(HOOK_SOURCES).sort((a, b) => b.length - a.length)

/**
 * Resolve the DSH source file responsible for an element by walking up from the
 * element until a known hook is found.
 *
 * @param {Element} element - Target element.
 * @param {Document} doc - Owning document.
 * @returns {{ hook: string, path: string, note: string } | null} The matched
 *   hook and its source file, or null when no hook on the element is known.
 */
function sourceFor(element, doc) {
  let node = element
  const root = doc.documentElement
  while (node !== null && node.nodeType === 1) {
    for (const hook of HOOK_NAMES) {
      if (node.getAttribute(hook) !== null) {
        const entry = HOOK_SOURCES[hook]
        return { hook, path: entry.path, note: entry.note }
      }
    }
    if (node === root) break
    node = node.parentElement
  }
  return null
}


	//#region @dsh-external/dsh-element-picker/src
/**
 * Turn a picked element into the block of locating information that gets
 * inserted into the composer.
 *
 * Shape (aligned with ZCode's element block, plus a DSH-specific `[源码]` line):
 *
 *   [元素] button.primary "发送"
 *   [选择器] [data-composer-card] button[aria-label="发送消息"]
 *   [XPath] /div[1]/div[2]/button[1]
 *   [位置] 44x44 @ viewport(1032,688) page(1032,688)
 *   [样式] color #F9FAFB; font 16px -apple-system,…; font-weight 600; display flex
 *   [属性] data-phase="idle"
 *   [源码] packages/client/ui-conversation/src/client/skeleton/InputBar.tsx (data-composer-card)
 *   [HTML] <button aria-label="发送消息">…</button>
 *
 * Pure string assembly: every DOM read is injected or guarded, so the suite can
 * assert the exact output against a stub element.
 */

/** Attributes worth quoting next to the selector. */
const REPORTED_ATTRIBUTES = [
  'id',
  'name',
  'role',
  'type',
  'aria-label',
  'aria-hidden',
  'placeholder',
]

/** Longest HTML excerpt kept in the block. */
const HTML_LIMIT = 200

/** Longest font-family list kept in the style line. */
const FONT_LIMIT = 32

/**
 * @param {string} text - Raw text.
 * @param {number} limit - Maximum length.
 * @returns {string} Whitespace-collapsed, truncated text.
 */
function clip(text, limit) {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length > limit ? `${clean.slice(0, limit)}…` : clean
}

/**
 * @param {Element} element - Target element.
 * @returns {string} The `[属性]` payload, or '' when nothing is worth quoting.
 */
function attributeLine(element) {
  const parts = []
  for (const name of REPORTED_ATTRIBUTES) {
    const value = element.getAttribute(name)
    if (value !== null) parts.push(`${name}="${value}"`)
  }
  if (parts.length > 4) parts.length = 4
  return parts.join(' ')
}

/**
 * @param {Element} element - Target element.
 * @param {Window | undefined} win - Window used for computed styles.
 * @returns {string} The `[样式]` payload, or '' when unavailable.
 */
function styleLine(element, win) {
  if (win === undefined || typeof win.getComputedStyle !== 'function') return ''
  let style = null
  try {
    style = win.getComputedStyle(element)
  } catch {
    return ''
  }
  if (style === null) return ''

  const parts = []
  const color = style.color
  if (color !== undefined && color !== '') parts.push(`color ${color}`)
  const size = style.fontSize
  const family = style.fontFamily
  if (size !== undefined && size !== '') {
    parts.push(
      family !== undefined && family !== ''
        ? `font ${size} ${clip(family, FONT_LIMIT)}`
        : `font ${size}`,
    )
  }
  const weight = style.fontWeight
  if (weight !== undefined && weight !== '' && weight !== '400') {
    parts.push(`font-weight ${weight}`)
  }
  const display = style.display
  if (display !== undefined && display !== '') parts.push(`display ${display}`)
  return parts.join('; ')
}

/**
 * @param {Element} element - Target element.
 * @param {DOMRect | undefined} rect - Element bounds in viewport coordinates.
 * @param {{ x?: number, y?: number } | undefined} scroll - Page scroll offset.
 * @returns {string} The `[位置]` payload.
 */
function rectLine(element, rect, scroll) {
  const box = rect ?? element.getBoundingClientRect?.()
  if (box === undefined || box === null) return ''
  const width = Math.round(box.width)
  const height = Math.round(box.height)
  const viewportX = Math.round(box.left)
  const viewportY = Math.round(box.top)
  const scrollX = Math.round(scroll?.x ?? 0)
  const scrollY = Math.round(scroll?.y ?? 0)
  return `${width}x${height} @ viewport(${viewportX},${viewportY}) page(${viewportX + scrollX},${viewportY + scrollY})`
}

/**
 * The facts shown in the hover card while selecting, mirroring the small card
 * ZCode floats beside the element under the pointer.
 *
 * @param {Element} element - Element under the pointer.
 * @param {Window | undefined} win - Owning window, for computed styles.
 * @returns {{ title: string, size: string, color: string, font: string }} Card rows.
 */
function hoverFacts(element, win) {
  const box = element.getBoundingClientRect?.()
  const firstClass = element.classList?.item(0) ?? null
  const tag = element.tagName.toLowerCase()

  let style = null
  try {
    style = typeof win?.getComputedStyle === 'function' ? win.getComputedStyle(element) : null
  } catch {
    style = null
  }

  const family = style?.fontFamily ?? ''
  const size = style?.fontSize ?? ''
  return {
    title: firstClass === null ? tag : `${tag}.${firstClass}`,
    size: box === undefined || box === null ? '' : `${Math.round(box.width)}x${Math.round(box.height)}`,
    color: style?.color ?? '',
    font: size === '' ? '' : clip(`${size} ${family}`, FONT_LIMIT + 6),
  }
}

/**
 * Shorten a repository path to its last two segments.
 *
 * The compact block is inserted into a chat composer, so a 70-character path
 * costs more than it earns: `…/skeleton/ConversationRoot.tsx` still says which
 * file to open.
 *
 * @param {string} path - Repository path.
 * @returns {string} A shortened path.
 */
function shortPath(path) {
  const parts = path.split('/')
  if (parts.length <= 2) return path
  return `…/${parts.slice(-2).join('/')}`
}

/**
 * Build the locating information for one element.
 *
 * Two shapes, because the composer is a chat input:
 *
 * - compact (default) — ONE line, the three things an agent needs to start:
 *   `[元素] button.IXshSW_header "任务 6 已完成" ｜ [选择器] button.IXshSW_header ｜ [源码] …/skeleton/ConversationRoot.tsx`
 * - detailed (`detailed: true`) — the full multi-line block with XPath,
 *   geometry, computed style, attributes, and an HTML excerpt.
 *
 * The verbose shape is what the first shipped version always inserted, and a
 * wall of eight lines per pick is the opposite of how ZCode presents a picked
 * element.
 *
 * @param {Element} element - Element under the pointer.
 * @param {object} [env] - Environment overrides.
 * @param {Window} [env.win] - Window for computed styles.
 * @param {Document} [env.doc] - Document for source lookup.
 * @param {DOMRect} [env.rect] - Pre-measured bounds.
 * @param {{ x: number, y: number }} [env.scroll] - Page scroll offset.
 * @param {boolean} [env.detailed] - Emit the full multi-line block.
 * @returns {string} The block, newline-terminated.
 */
function buildElementBlock(element, env = {}) {
  const doc = env.doc ?? element.ownerDocument
  const selector = generateSelector(element)
  const source = sourceFor(element, doc)

  if (env.detailed !== true) {
    const parts = [`[元素] ${describeElement(element)}`]
    if (selector !== '') parts.push(`[选择器] ${selector}`)
    if (source !== null) parts.push(`[源码] ${shortPath(source.path)}`)
    return `${parts.join(' ｜ ')}\n`
  }

  const lines = [`[元素] ${describeElement(element)}`]

  if (selector !== '') lines.push(`[选择器] ${selector}`)

  const xpath = generateXPath(element)
  if (xpath !== '') lines.push(`[XPath] ${xpath}`)

  const position = rectLine(element, env.rect, env.scroll)
  if (position !== '') lines.push(`[位置] ${position}`)

  const style = styleLine(element, env.win)
  if (style !== '') lines.push(`[样式] ${style}`)

  const attributes = attributeLine(element)
  if (attributes !== '') lines.push(`[属性] ${attributes}`)

  if (source !== null) {
    lines.push(`[源码] ${source.path} (${source.hook})`)
  }

  const html = element.outerHTML
  if (typeof html === 'string' && html !== '') {
    lines.push(`[HTML] ${clip(html, HTML_LIMIT)}`)
  }

  return `${lines.join('\n')}\n`
}

/**
 * Hooks known to this build, exposed for diagnostics and tests.
 *
 * @returns {string[]} The mapped hook attribute names.
 */
function knownHooks() {
  return Object.keys(HOOK_SOURCES)
}


	//#region @dsh-external/dsh-element-picker/src
/**
 * Composer insertion: put the locating block into the DSH chat input without
 * destroying the user's draft.
 *
 * The composer is a Lexical `contenteditable` (`[data-composer-input]`), and the
 * public plugin API only exposes "replace the whole draft"
 * (`InputActions.setDraft`). So insertion is a cascade over three paths, best
 * first, each verified before the next is tried:
 *
 *   1. `paste`    - the shell's own `paste(text)`: inserts over the current
 *                   selection, keeps chips, its own undo boundary. It is an
 *                   internal member (absent from the published typings), so it
 *                   is feature-detected and only used when actually present.
 *   2. `dom`      - drive the editable element the way a user keystroke would
 *                   (`execCommand('insertText')`, then a synthetic `beforeinput`
 *                   pair), which Lexical applies to its own document model.
 *   3. `setDraft` - `setDraft(draft + text)`: always available, but it rebuilds
 *                   the document as plain text (reference chips are lost) and
 *                   puts the caret at the end. Last resort, reported as such.
 *
 * The chosen path is returned so callers can surface it and so the cloud e2e
 * can assert which path a real DSH build actually took.
 */

/** Composer input selector: the DSH contenteditable, verified against 0.1.5-rc.2. */
const COMPOSER_INPUT_SELECTOR = '[data-composer-input]'

/** Path order tried by default. */
const DEFAULT_PATHS = ['paste', 'dom', 'setDraft']

/**
 * @param {string} message - Diagnostics text.
 * @returns {{ ok: false, error: string }} A failed attempt result.
 */
function fail(message) {
  return { ok: false, error: message }
}

/**
 * Find the composer's editable element.
 *
 * @param {Document} doc - Owning document.
 * @returns {Element | null} The composer input, else null.
 */
function findComposerInput(doc) {
  const found = doc.querySelectorAll(COMPOSER_INPUT_SELECTOR)
  if (found.length === 0) return null
  return found[found.length - 1]
}

/**
 * Insert through the shell's internal `paste(text)`.
 *
 * @param {object} ctx - Attempt context.
 * @param {string} ctx.text - Block to insert.
 * @param {object | undefined} ctx.inputActions - Public input actions face.
 * @returns {{ ok: boolean, error?: string }} The attempt result.
 */
function insertViaPaste({ text, inputActions }) {
  if (inputActions === undefined || typeof inputActions.paste !== 'function') {
    return fail('inputActions.paste is not exposed by this DSH build')
  }
  try {
    inputActions.paste(text)
    return { ok: true }
  } catch (error) {
    return fail(`inputActions.paste threw: ${String(error)}`)
  }
}

/**
 * Ensure the document selection sits inside the editor.
 *
 * Chromium only applies `execCommand('insertText')` where the selection is; a
 * programmatic `focus()` does not reliably leave a caret inside a Lexical root,
 * which is why the first real-DSH probe could not insert through the DOM. When
 * the selection is elsewhere, a caret is placed at the end of the editable.
 *
 * @param {Element} element - The editable element.
 * @param {Document} doc - Owning document.
 * @returns {boolean} True when a caret inside the editor is (now) selected.
 */
function ensureCaretInside(element, doc) {
  if (typeof doc.getSelection !== 'function') return false
  let selection = null
  try {
    selection = doc.getSelection()
  } catch {
    return false
  }
  if (selection === null || selection === undefined) return false

  try {
    const anchor = selection.anchorNode ?? null
    if (anchor !== null && typeof element.contains === 'function' && element.contains(anchor)) {
      return true
    }
    if (typeof doc.createRange !== 'function') return false
    const range = doc.createRange()
    range.selectNodeContents(element)
    range.collapse(false)
    selection.removeAllRanges()
    selection.addRange(range)
    return true
  } catch {
    return false
  }
}

/**
 * @param {Element} element - The editable element.
 * @param {string} text - Text to insert.
 * @param {Document} doc - Owning document.
 * @returns {boolean} Whether the command reported success.
 */
function runExecCommand(element, text, doc) {
  if (typeof doc.execCommand !== 'function') return false
  try {
    return doc.execCommand('insertText', false, text) === true
  } catch {
    return false
  }
}

/**
 * Dispatch a synthetic paste event carrying the text.
 *
 * Lexical handles `paste` itself and turns a multi-line payload into proper
 * paragraphs, which is the closest thing to "the user pasted this".
 *
 * @param {Element} element - The editable element.
 * @param {string} text - Text to insert.
 * @param {Window | undefined} win - Owning window (for the constructors).
 * @returns {boolean} Whether a listener claimed the event.
 */
function dispatchPasteEvent(element, text, win) {
  const DataTransferCtor = win?.DataTransfer ?? globalThis.DataTransfer
  const ClipboardEventCtor = win?.ClipboardEvent ?? globalThis.ClipboardEvent
  if (typeof DataTransferCtor !== 'function' || typeof ClipboardEventCtor !== 'function') {
    return false
  }
  try {
    const transfer = new DataTransferCtor()
    transfer.setData('text/plain', text)
    const event = new ClipboardEventCtor('paste', {
      bubbles: true,
      cancelable: true,
      clipboardData: transfer,
    })
    // Chromium has historically ignored `clipboardData` in the init dict, so the
    // payload is forced onto the event when the constructor dropped it.
    if (event.clipboardData === null || event.clipboardData === undefined) {
      try {
        Object.defineProperty(event, 'clipboardData', { value: transfer })
      } catch {
        return false
      }
    }
    element.dispatchEvent(event)
    return event.defaultPrevented === true
  } catch {
    return false
  }
}

/**
 * Hand the edit to whoever listens for `beforeinput` on the editable.
 *
 * @param {Element} element - The editable element.
 * @param {string} text - Text to insert.
 * @param {Window | undefined} win - Owning window (for the event constructor).
 * @returns {boolean} Whether a listener claimed the event.
 */
function dispatchBeforeInput(element, text, win) {
  const InputEventCtor = win?.InputEvent ?? globalThis.InputEvent
  if (typeof InputEventCtor !== 'function') return false
  try {
    const before = new InputEventCtor('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertText',
      data: text,
    })
    element.dispatchEvent(before)
    if (before.defaultPrevented !== true) return false
    element.dispatchEvent(
      new InputEventCtor('input', { bubbles: true, inputType: 'insertText', data: text }),
    )
    return true
  } catch {
    return false
  }
}

/**
 * @param {Element} element - The editable element.
 * @param {string} text - The text that should now be present.
 * @returns {boolean} Whether the editable shows the block, in order.
 */
function verifyInserted(element, text) {
  const lines = text.split('\n').filter((line) => line !== '')
  if (lines.length === 0) return true
  // `innerText` keeps paragraph breaks that `textContent` drops, so reading both
  // catches an insert that landed but was reflowed into the wrong order.
  const rendered = `${element.textContent ?? ''}\n${element.innerText ?? ''}`

  const first = lines[0]
  const last = lines[lines.length - 1]
  if (!rendered.includes(first) || !rendered.includes(last)) return false
  if (first === last) return true
  return rendered.indexOf(last) > rendered.indexOf(first)
}

/**
 * Insert by driving the contenteditable directly, trying the DOM routes a user
 * edit would take and verifying each one before believing it.
 *
 * Order matters: DSH's composer is Lexical, whose own `paste` handler is what
 * turns a multi-line payload into proper paragraphs — `execCommand` reflows the
 * same text badly there. So the paste event goes first, and the plain
 * contenteditable routes follow for editors without a paste handler.
 *
 * @param {object} ctx - Attempt context.
 * @param {string} ctx.text - Block to insert.
 * @param {Document} ctx.doc - Owning document.
 * @param {Window} [ctx.win] - Owning window.
 * @returns {{ ok: boolean, error?: string, note?: string }} The attempt result.
 */
function insertViaDom({ text, doc, win }) {
  const element = findComposerInput(doc)
  if (element === null) return fail('composer input not found')

  const editable = element.getAttribute('contenteditable')
  if (editable === null || editable === 'false') {
    return fail('composer input is not editable')
  }

  try {
    if (typeof element.focus === 'function') element.focus({ preventScroll: true })
  } catch {
    /* focus is best-effort: the caret below and the insert are what matter */
  }

  const caret = ensureCaretInside(element, doc)
  const routes = [
    ['paste-event', () => dispatchPasteEvent(element, text, win)],
    ['execCommand', () => runExecCommand(element, text, doc)],
    ['beforeinput', () => dispatchBeforeInput(element, text, win)],
  ]

  const trace = []
  for (const [name, apply] of routes) {
    let claimed = false
    try {
      claimed = apply() === true
    } catch (error) {
      trace.push(`${name}:threw(${String(error).slice(0, 40)})`)
      continue
    }
    if (!claimed) {
      trace.push(`${name}:refused`)
      continue
    }
    if (verifyInserted(element, text)) {
      trace.push(`${name}:ok`)
      return { ok: true, note: `caret=${caret ? 'placed' : 'unavailable'} routes[${trace.join(', ')}]` }
    }
    trace.push(`${name}:applied-but-misplaced`)
  }

  return fail(`dom routes exhausted (${trace.join(', ')})`)
}

/**
 * Insert by replacing the whole draft (chips are lost; caret moves to the end).
 *
 * @param {object} ctx - Attempt context.
 * @param {string} ctx.text - Block to insert.
 * @param {string} ctx.draft - Current draft text.
 * @param {object | undefined} ctx.inputActions - Public input actions face.
 * @returns {{ ok: boolean, error?: string }} The attempt result.
 */
function insertViaSetDraft({ text, draft, inputActions }) {
  if (inputActions === undefined || typeof inputActions.setDraft !== 'function') {
    return fail('inputActions.setDraft is not available')
  }
  try {
    inputActions.setDraft(`${draft ?? ''}${text}`)
    return { ok: true }
  } catch (error) {
    return fail(`inputActions.setDraft threw: ${String(error)}`)
  }
}

const ATTEMPTS = {
  paste: insertViaPaste,
  dom: insertViaDom,
  setDraft: insertViaSetDraft,
}

/**
 * Insert the block, trying each path in order until one is verified.
 *
 * @param {object} options - Insert request.
 * @param {string} options.text - Block to insert (newline-terminated).
 * @param {Document} options.doc - Owning document.
 * @param {Window} [options.win] - Owning window (for event constructors).
 * @param {string} [options.draft] - Current draft text.
 * @param {object} [options.inputActions] - Public input actions face.
 * @param {string[]} [options.paths] - Path order override (used by probes).
 * @returns {{ ok: boolean, path?: string, note?: string,
 *   tried: { path: string, error?: string, note?: string }[] }}
 *   The winning path and the attempt trail, or the full trail when every path
 *   failed.
 */
function insertBlock(options) {
  const paths = options.paths ?? DEFAULT_PATHS
  const tried = []

  for (const path of paths) {
    const attempt = ATTEMPTS[path]
    if (attempt === undefined) {
      tried.push({ path, error: 'unknown path' })
      continue
    }
    const result = attempt(options)
    if (result.ok) {
      tried.push({ path, note: result.note })
      return { ok: true, path, note: result.note, tried }
    }
    tried.push({ path, error: result.error })
  }

  return { ok: false, tried }
}


	//#region @dsh-external/dsh-element-picker/src
/**
 * Chip insertion: put a picked element into the composer as a real reference
 * chip (`data-composer-chip`) instead of a wall of text.
 *
 * This is DSH's own mechanism for "compact in the composer, rich for the model":
 * the chip shows a short label, and the owning source's `codec.serialize` expands
 * it into the full text when the message is submitted. Reaching for it is what
 * makes a pick feel like ZCode's element card rather than a paragraph.
 *
 * The published `SessionInput` face carries `insertReference(ref, span)`; the
 * only piece a plugin has to supply itself is the `TokenSpan`, whose `draftRev`
 * is published in `InputState` and whose coordinates come from the shell's
 * `caretSpan()` (a runtime member, feature-detected here).
 *
 * Every step is optional: anything missing, refusing, or throwing returns null
 * and the caller falls back to plain text. The composer must never be left in a
 * worse state than before the pick.
 */

/** Reference source name our chips belong to; also the registered codec name. */
const CHIP_SOURCE = 'element-picker'

/** Longest chip label kept in the composer. */
const LABEL_LIMIT = 48

/**
 * Build the chip's short label from an element.
 *
 * @param {Element} element - Picked element.
 * @returns {string} A one-line label.
 */
function chipLabel(element) {
  const tag = element.tagName.toLowerCase()
  const text = (element.textContent ?? '').replace(/\s+/g, ' ').trim()
  const head = `元素 ${tag}`
  if (text === '') return head
  const clipped = text.length > LABEL_LIMIT ? `${text.slice(0, LABEL_LIMIT)}…` : text
  return `${head}「${clipped}」`
}

/**
 * Register the source our chips belong to, so they serialize on submit.
 *
 * `source` on the chip must name a registered trigger source that carries a
 * `codec`; otherwise sending the message fails while serializing the chip. The
 * source itself is inert (empty candidates) — the picker inserts directly.
 *
 * @param {object | undefined} ctx - Plugin (root) context.
 * @returns {boolean} Whether a source was registered.
 */
function registerChipSource(ctx) {
  const registry = ctx?.inputTriggers
  if (registry === undefined || typeof registry.registerSource !== 'function') return false
  try {
    registry.registerSource({
      trigger: '@',
      name: CHIP_SOURCE,
      candidates: async () => [],
      onPick: () => undefined,
      codec: {
        clipboardText: (ref) => ref,
        serialize: (ref) => Promise.resolve(ref),
      },
    })
    return true
  } catch {
    return false
  }
}

/**
 * Resolve the per-session input facade, or null when it is not reachable.
 *
 * @param {object | undefined} ctx - Plugin (root) context.
 * @param {string | undefined} sessionId - Session the composer belongs to.
 * @param {(message: string) => void} [note] - Diagnostics sink.
 * @returns {object | null} The facade, or null.
 */
function resolveInputBinding(ctx, sessionId, note) {
  const say = typeof note === 'function' ? note : () => {}
  if (ctx === undefined || sessionId === undefined) {
    say('chip skipped: no session-bound context yet')
    return null
  }
  try {
    const actx = ctx.sessions?.scope?.(sessionId)
    if (actx === undefined || actx === null) {
      say('chip skipped: no session scope for this session')
      return null
    }
    const facade = ctx.conversation?.input?.for?.(actx)
    if (facade === undefined) {
      say('chip skipped: the input facade is unavailable')
      return null
    }
    return { facade, actx }
  } catch (error) {
    say(`chip skipped: ${String(error)}`)
    return null
  }
}

function resolveFacade(ctx, sessionId, note) {
  const say = typeof note === 'function' ? note : () => {}
  if (ctx === undefined || sessionId === undefined) {
    say('chip skipped: no session-bound context yet')
    return null
  }
  try {
    const actx = ctx.sessions?.scope?.(sessionId)
    if (actx === undefined || actx === null) {
      say('chip skipped: no session scope for this session')
      return null
    }
    const facade = ctx.conversation?.input?.for?.(actx)
    if (facade === undefined) {
      say('chip skipped: the input facade is unavailable')
      return null
    }
    return facade
  } catch (error) {
    say(`chip skipped: ${String(error)}`)
    return null
  }
}

/**
 * Insert a picked element as a reference chip.
 *
 * @param {object} options - Insert request.
 * @param {object | undefined} options.ctx - Plugin (root) context.
 * @param {string | undefined} options.sessionId - Session the composer belongs to.
 * @param {string} options.text - The locating block the chip stands for.
 * @param {string} options.label - The chip's visible label.
 * @param {(message: string) => void} [options.onEvent] - Diagnostics sink.
 * @returns {string | null} 'chip' when a chip was inserted, else null.
 */
function insertElementChip({ ctx, sessionId, text, label, onEvent }) {
  const note = (message) => {
    if (typeof onEvent === 'function') onEvent(message)
  }
  const facade = resolveFacade(ctx, sessionId, note)
  if (facade === null || typeof facade.insertReference !== 'function') return null

  try {
    const snapshot = typeof facade.state?.getSnapshot === 'function' ? facade.state.getSnapshot() : undefined
    const draftRev = snapshot?.draftRev
    if (typeof draftRev !== 'number') {
      note('chip skipped: no published draft revision to guard the edit')
      return null
    }

    // `caretSpan()` is the shell's live selection in detect coordinates; without
    // it, the end of the draft is the next best anchor.
    let start = typeof snapshot?.draft === 'string' ? snapshot.draft.length : 0
    let end = start
    if (typeof facade.caretSpan === 'function') {
      const caret = facade.caretSpan()
      if (typeof caret?.start === 'number' && typeof caret?.end === 'number') {
        start = caret.start
        end = caret.end
      }
    }

    const applied = facade.insertReference(
      {
        source: CHIP_SOURCE,
        ref: text,
        label,
        appearance: 'file',
        clipboardText: text,
      },
      { start, end, draftRev },
    )
    if (applied !== true) {
      note('chip refused by the input machine (phase or revision guard)')
      return null
    }
    return 'chip'
  } catch (error) {
    note(`chip insert failed: ${String(error)}`)
    return null
  }
}

/** Width of the chip's right-hand remove hit region. */
const REMOVE_ZONE_PX = 20

/** CSS selector naming the chips this plugin inserted. */
const CHIP_SELECTOR = `[data-composer-chip="${CHIP_SOURCE}"]`

/** Every chip in the composer, in document order. */
const ALL_CHIPS = '[data-composer-chip]'

/**
 * @param {Document} doc - Owning document.
 * @param {Element} chip - One chip element.
 * @returns {number} Its index in the composer's chip order, or -1.
 */
function chipIndexOf(doc, chip) {
  return [...doc.querySelectorAll(ALL_CHIPS)].indexOf(chip)
}

/**
 * The detect-coordinate span of one chip.
 *
 * `occurrences` are published in clipboard coordinates and every chip counts as
 * a single detect character (`U+FFFC`), so a chip's detect start is its clipboard
 * offset minus the excess length of every chip before it.
 *
 * @param {readonly object[]} occurrences - `InputState.occurrences`.
 * @param {number} index - Chip index in document order.
 * @param {number} draftRev - Current editor revision.
 * @returns {{ start: number, end: number, draftRev: number } | null} The span.
 */
function chipSpan(occurrences, index, draftRev) {
  if (!Array.isArray(occurrences) || index < 0 || index >= occurrences.length) return null
  if (typeof draftRev !== 'number') return null
  let start = occurrences[index].offset
  for (let i = 0; i < index; i += 1) {
    start -= Math.max(0, (occurrences[i].length ?? 1) - 1)
  }
  return { start, end: start + 1, draftRev }
}

/**
 * Watch for clicks on a picker chip's remove region.
 *
 * The glyph is drawn by the stylesheet (`::after`) rather than injected as a
 * child: the chip's span is React's portal container, so a foreign child is
 * outside React's managed tree and can be dropped or reordered by any
 * re-render — a pseudo-element cannot be. The hit region is therefore computed
 * from the chip's own box, and the event is swallowed so the editor never moves
 * its caret.
 *
 * @param {object} options - Watch request.
 * @param {Document} options.doc - Owning document.
 * @param {Window} options.win - Owning window.
 * @param {(chip: Element) => void} options.onRemove - Invoked for a chip click.
 * @param {() => boolean} [options.isPickerActive] - Skip while selecting.
 * @returns {() => void} Teardown.
 */
function watchChipRemoval({ doc, win, onRemove, isPickerActive }) {
  const handle = (event) => {
    if (typeof isPickerActive === 'function' && isPickerActive()) return
    const target = event.target
    if (target === null || typeof target.closest !== 'function') return
    const chip = target.closest(CHIP_SELECTOR)
    if (chip === null) return
    const box = chip.getBoundingClientRect()
    if (event.clientX < box.right - REMOVE_ZONE_PX) return
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
    onRemove(chip)
  }

  const target = typeof win.addEventListener === 'function' ? win : doc
  target.addEventListener('mousedown', handle, true)
  target.addEventListener('pointerdown', handle, true)
  return () => {
    target.removeEventListener('mousedown', handle, true)
    target.removeEventListener('pointerdown', handle, true)
  }
}

/**
 * Remove one picked element's chip.
 *
 * `consumeToken` with a span is the honest verb — it is what the composer itself
 * uses to drop a token without inserting a replacement — and it deletes exactly
 * that chip node, leaving every other chip (a user's `@file` mentions included)
 * intact. `setDraft` is deliberately NOT a fallback here: it rebuilds the draft
 * as plain text and would flatten the user's own chips.
 *
 * @param {object} options - Removal request.
 * @param {Document} options.doc - Owning document.
 * @param {Element} options.chip - The chip to remove.
 * @param {object | null} [options.facade] - Session input facade, when reachable.
 * @param {object | null} [options.actx] - Session scope, for the event fallback.
 * @param {(message: string) => void} [options.onEvent] - Diagnostics sink.
 * @returns {string | null} The route that worked, else null.
 */
function removeChipElement({ doc, facade, actx, chip, onEvent }) {
  const note = (message) => {
    if (typeof onEvent === 'function') onEvent(message)
  }
  const before = doc.querySelectorAll(CHIP_SELECTOR).length
  if (before === 0) {
    note('remove skipped: no picker chip is present')
    return null
  }
  const index = chipIndexOf(doc, chip)
  if (index < 0) {
    note('remove skipped: that chip is not in the composer')
    return null
  }

  const attempts = []
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let snapshot = undefined
    try {
      snapshot = typeof facade?.state?.getSnapshot === 'function' ? facade.state.getSnapshot() : undefined
    } catch (error) {
      note(`could not read the input state: ${String(error)}`)
      return null
    }
    const span = chipSpan(snapshot?.occurrences ?? [], index, snapshot?.draftRev)
    if (span === null) {
      note('remove skipped: the chip has no published occurrence to target')
      return null
    }

    let applied = false
    try {
      if (typeof facade?.consumeToken === 'function') {
        applied = facade.consumeToken({ kind: 'span', span }) === true
        attempts.push(`consumeToken:${applied ? 'ok' : 'refused'}`)
      } else if (actx !== undefined && actx !== null && typeof actx.bail === 'function') {
        applied =
          actx.bail(actx, 'slash/input-consume-token', { guard: { kind: 'span', span } }) === true
        attempts.push(`event:${applied ? 'ok' : 'refused'}`)
      } else {
        note('remove skipped: neither consumeToken nor the scoped event is reachable')
        return null
      }
    } catch (error) {
      note(`removal threw: ${String(error)}`)
      return null
    }

    if (applied && doc.querySelectorAll(CHIP_SELECTOR).length < before) {
      return attempts.join(', ')
    }
    // The revision guard is an exact CAS: a keystroke between the read and the
    // call makes it refuse, so one retry with a fresh snapshot is worthwhile.
  }

  note(`the chip was not removed (${attempts.join(', ') || 'no attempt'})`)
  return null
}

/** Label of the chip that stands for a group of picked elements. */
const GROUP_LABEL_PREFIX = '元素组'

/**
 * Fold every picked element's chip in the draft into ONE group chip.
 *
 * The chips are removed from the end backwards (so the earlier spans stay valid)
 * through the same `consumeToken` the × uses, then a single chip carrying all
 * their blocks is inserted — the model reads one grouped block instead of N
 * separate ones, and the composer keeps one pill.
 *
 * @param {object} options - Grouping request.
 * @param {object | undefined} options.ctx - Plugin (root) context.
 * @param {string | undefined} options.sessionId - Session the composer belongs to.
 * @param {(message: string) => void} [options.onEvent] - Diagnostics sink.
 * @returns {{ grouped: number } | null} How many chips were grouped, else null.
 */
function groupElementChips({ ctx, sessionId, onEvent }) {
  const note = (message) => {
    if (typeof onEvent === 'function') onEvent(message)
  }
  const binding = resolveInputBinding(ctx, sessionId, note)
  if (binding === null) return null
  const facade = binding.facade
  const actx = binding.actx

  const ours = () => {
    const snapshot = typeof facade.state?.getSnapshot === 'function' ? facade.state.getSnapshot() : undefined
    const occurrences = Array.isArray(snapshot?.occurrences) ? snapshot.occurrences : []
    const mine = occurrences
      .map((occurrence, index) => ({ occurrence, index }))
      .filter((entry) => entry.occurrence.source === CHIP_SOURCE)
    return { snapshot, occurrences, mine }
  }

  const first = ours()
  if (first.mine.length < 2) {
    note(`grouping needs at least two picked elements (found ${first.mine.length})`)
    return null
  }
  const blocks = first.mine.map((entry) => entry.occurrence.clipboardText)
  const total = blocks.length

  // Remove from the last chip backwards: deleting the last one cannot shift the
  // coordinates of the ones before it.
  for (let remaining = total; remaining > 0; remaining -= 1) {
    const state = ours()
    if (state.mine.length === 0) break
    const target = state.mine[state.mine.length - 1]
    const span = chipSpan(state.occurrences, target.index, state.snapshot?.draftRev)
    if (span === null) {
      note('grouping stopped: a chip had no published occurrence')
      return null
    }
    let applied = false
    try {
      if (typeof facade.consumeToken === 'function') {
        applied = facade.consumeToken({ kind: 'span', span }) === true
      } else if (actx !== null && actx !== undefined && typeof actx.bail === 'function') {
        applied = actx.bail(actx, 'slash/input-consume-token', { guard: { kind: 'span', span } }) === true
      }
    } catch (error) {
      note(`grouping removal threw: ${String(error)}`)
      return null
    }
    if (!applied) {
      note('grouping stopped: a chip refused to be removed')
      return null
    }
  }

  // Insert the group chip where the draft ends.
  const after = ours()
  const occurrences = after.occurrences
  let detectLength = typeof after.snapshot?.draft === 'string' ? after.snapshot.draft.length : 0
  for (const occurrence of occurrences) {
    detectLength -= Math.max(0, (occurrence.length ?? 1) - 1)
  }
  const payload = [`[元素组] ${total} 个界面元素`, '', ...blocks.map((block, index) => `（${index + 1}）${block.trimEnd()}`)].join(String.fromCharCode(10)) + String.fromCharCode(10)

  const inserted = insertElementChip({
    ctx,
    sessionId,
    text: payload,
    label: `${total} 个元素`,
    onEvent: note,
  })
  if (inserted === null) {
    note('grouping removed the chips but could not insert the group chip')
    return null
  }
  note(`grouped ${total} chips into one carrying a ${payload.split(String.fromCharCode(10)).filter((line) => line !== '').length}-line block`)
  return { grouped: total }
}

/** One row of the chip preview: what the user picked, in their words. */
const PREVIEW_SUMMARY_RE = /^\[元素\]\s*/

/**
 * Parse the block a chip stands for into preview rows.
 *
 * The payload is this plugin's own format, so it can be read back without any
 * extra state: a group lists its elements as `（1）…（2）…`, and a single pick is
 * just the block. Each row takes the element summary, its tag and role when the
 * block carries one, and the page it came from.
 *
 * @param {string} text - The chip's payload.
 * @param {string} [origin] - Page title to show on every row.
 * @returns {{ summary: string, meta: string, origin: string }[]} Preview rows.
 */
function parsePreviewItems(text, origin = '') {
  const blocks = String(text ?? '')
    .split(/（\d+）/)
    .map((part) => part.trim())
    .filter((part) => part !== '')

  const rows = []
  for (const block of blocks) {
    const lines = block.split(String.fromCharCode(10)).map((line) => line.trim())
    const headline = lines.find((line) => PREVIEW_SUMMARY_RE.test(line))
    if (headline === undefined) continue

    const summary = headline.replace(PREVIEW_SUMMARY_RE, '').trim()
    const tag = summary.split(/[\s.:#]/)[0] || 'element'
    const attributes = lines.find((line) => line.startsWith('[属性]')) ?? ''
    const role = /role="([^"]+)"/.exec(attributes)
    const meta = role === null ? tag : `${tag} · role=${role[1]}`
    rows.push({ summary, meta, origin })
  }
  return rows
}

/** Delay before a preview hides, so the pointer can travel into it. */
const PREVIEW_HIDE_DELAY_MS = 160

/**
 * Show a preview of what a picker chip holds when the pointer rests on it.
 *
 * ZCode's picked-element pill does the same: hovering it lists the elements, and
 * the list scrolls when there are many. The panel is ours, marked so the picker
 * ignores it, and it takes pointer events so it can actually be scrolled.
 *
 * @param {object} options - Watch request.
 * @param {Document} options.doc - Owning document.
 * @param {Window} options.win - Owning window.
 * @param {() => string} options.payloadOf - Reads the payload of one chip.
 * @returns {() => void} Teardown.
 */
function watchChipPreview({ doc, win, payloadOf }) {
  const host = doc.body ?? doc.documentElement
  let panel = null
  let hideTimer = null
  let currentChip = null

  const build = () => {
    const element = doc.createElement('div')
    element.setAttribute('data-dsh-picker-ui', 'chip-preview')
    element.setAttribute('data-dsh-picker-visible', 'false')
    element.setAttribute('role', 'tooltip')
    host.appendChild(element)
    return element
  }

  const show = (chip) => {
    const rows = parsePreviewItems(payloadOf(chip) ?? '', doc.title ?? '')
    if (rows.length === 0) return
    if (panel === null) panel = build()

    panel.textContent = ''
    for (const row of rows) {
      const item = doc.createElement('div')
      item.setAttribute('data-dsh-picker-preview-item', 'true')

      const summary = doc.createElement('div')
      summary.setAttribute('data-dsh-picker-preview-summary', 'true')
      summary.textContent = row.summary

      const meta = doc.createElement('div')
      meta.setAttribute('data-dsh-picker-preview-meta', 'true')
      meta.textContent = row.meta

      const origin = doc.createElement('div')
      origin.setAttribute('data-dsh-picker-preview-origin', 'true')
      origin.textContent = row.origin

      item.appendChild(summary)
      item.appendChild(meta)
      if (row.origin !== '') item.appendChild(origin)
      panel.appendChild(item)
    }

    const box = chip.getBoundingClientRect()
    const above = box.top > (win.innerHeight ?? 0) / 2
    panel.setAttribute('data-dsh-picker-visible', 'true')
    const height = panel.getBoundingClientRect().height
    panel.style.left = `${Math.max(8, Math.round(box.left))}px`
    panel.style.top = `${Math.round(above ? Math.max(8, box.top - 8 - height) : box.bottom + 8)}px`
    currentChip = chip
  }

  const scheduleHide = () => {
    if (hideTimer !== null) win.clearTimeout(hideTimer)
    hideTimer = win.setTimeout(() => {
      if (panel !== null) panel.setAttribute('data-dsh-picker-visible', 'false')
      currentChip = null
    }, PREVIEW_HIDE_DELAY_MS)
  }

  const owns = (node) => {
    if (node === null || typeof node.closest !== 'function') return false
    return node.closest(CHIP_SELECTOR) !== null || node.closest('[data-dsh-picker-ui="chip-preview"]') !== null
  }

  const onOver = (event) => {
    const node = event.target
    if (node === null || typeof node.closest !== 'function') return
    const chip = node.closest(CHIP_SELECTOR)
    if (chip !== null) {
      if (hideTimer !== null) win.clearTimeout(hideTimer)
      if (chip !== currentChip) show(chip)
      return
    }
    if (node.closest('[data-dsh-picker-ui="chip-preview"]') === null) scheduleHide()
  }

  const onOut = (event) => {
    if (!owns(event.target)) return
    scheduleHide()
  }

  const hide = () => {
    if (hideTimer !== null) win.clearTimeout(hideTimer)
    if (panel !== null) panel.setAttribute('data-dsh-picker-visible', 'false')
    currentChip = null
  }

  const target = typeof win.addEventListener === 'function' ? win : doc
  target.addEventListener('pointerover', onOver, true)
  target.addEventListener('pointerout', onOut, true)
  return {
    hide,
    dispose: () => {
      target.removeEventListener('pointerover', onOver, true)
      target.removeEventListener('pointerout', onOut, true)
      if (hideTimer !== null) win.clearTimeout(hideTimer)
      if (panel !== null) panel.remove()
    },
  }
}


	//#region @dsh-external/dsh-element-picker/src
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
const PILL_MARKER = 'data-dsh-picker-transcript-pill'

/** Marker on the block's first line element, which owns the fold. */
const FOLD_MARKER = 'data-dsh-picker-folded'

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
  while (sibling !== null && sibling !== undefined && FIELD_RE.test((sibling.textContent ?? '').trim())) {
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
function foldTranscriptBlocks(doc) {
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
function watchTranscript({ doc, win, onEvent }) {
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


	//#region @dsh-external/dsh-element-picker/src
/**
 * Selection mode: the hover highlight, the hint bar, and the capture-phase
 * event handling that turns a page click into a picked element.
 *
 * There is exactly ONE picker control — the entry registered in the composer
 * tool row (`conversation.input.left`) — and it drives `toggle()` here. The
 * overlay deliberately owns no button of its own: an earlier floating button
 * duplicated the control and sat over the composer.
 *
 * The pick is exactly the element under the pointer. No climbing: pointing at a
 * row means the row, pointing at an icon means the icon (this is what ZCode
 * does, and climbing to "the nearest control" is what silently handed people an
 * ancestor's `<button>` instead of the thing they outlined).
 *
 * Flow:
 *   click the tool-row button -> selection mode on, hovering outlines the
 *   element under the pointer -> click an element -> the pick is reported and
 *   selection mode STAYS on, so several elements can be picked in a row ->
 *   click the button again (or press Escape) to finish.
 *
 * While selection mode is on, the click must NOT reach the application: every
 * relevant event is swallowed in the capture phase, and the picker's own nodes
 * are excluded from hit-testing by their `data-dsh-picker-ui` marker.
 *
 * Plain DOM (no framework): the plugin's React entry only calls `toggle()`.
 */


/** Marker attribute on every node this overlay owns. */
const PICKER_MARKER = 'data-dsh-picker-ui'

/** Hint text shown while selection mode is on. */
const HINT_TEXT = '连续选择：点元素插入定位信息 · Shift+点击插入完整信息 · Ctrl+Shift+E 进入/退出 · Ctrl+Shift+G 合并为元素组 · Esc 结束'

/**
 * Keyboard toggle. Menus cannot be opened *while* selecting (their opening
 * click is swallowed), so the way to pick inside one is: open the menu, toggle
 * selection mode from the keyboard, then click the item — the picker's
 * window-capture swallow beats the menu's own dismissal.
 */
const TOGGLE_SHORTCUT_KEY = 'e'

/** Keyboard shortcut that groups the picker's chips into one element group. */
const GROUP_SHORTCUT_KEY = 'g'

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
 * @param {Node | null} node - Candidate node.
 * @param {Document} doc - Owning document.
 * @returns {boolean} Whether the node belongs to the picker's own UI.
 */
function isOwnNode(node, doc) {
  if (node === null || node.nodeType !== 1) return false
  if (typeof node.closest !== 'function') return false
  return node.closest(`[${PICKER_MARKER}]`) !== null
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
 *   - Diagnostics sink (entering/leaving/missed picks).
 * @returns {{ toggle: () => boolean, setActive: (next: boolean) => boolean,
 *   isActive: () => boolean, dispose: () => void, element: Element }} The
 *   controller.
 */
function createPicker({ doc, win, onPick, onEvent }) {
  const emit = (event) => {
    if (typeof onEvent === 'function') onEvent(event)
  }

  const root = doc.createElement('div')
  root.id = 'dsh-element-picker-root'
  root.setAttribute(PICKER_MARKER, 'root')
  // Written up front so the overlay's state is readable from the DOM before the
  // first toggle (automation and the stylesheet both key off it).
  root.setAttribute('data-dsh-picker-active', 'false')

  const highlight = doc.createElement('div')
  highlight.setAttribute(PICKER_MARKER, 'highlight')

  const hint = doc.createElement('div')
  hint.setAttribute(PICKER_MARKER, 'hint')
  hint.textContent = HINT_TEXT

  // The hover card: the same three facts ZCode shows beside the element under
  // the pointer, so a pick can be judged before it is made.
  const card = doc.createElement('div')
  card.setAttribute(PICKER_MARKER, 'info')
  const rows = [
    ['info-title', 'info-size'],
    ['info-color-label', 'info-color'],
    ['info-font-label', 'info-font'],
  ].map(([labelKey, valueKey], index) => {
    const row = doc.createElement('div')
    row.setAttribute('data-dsh-picker-row', String(index))
    const label = doc.createElement('span')
    label.setAttribute('data-dsh-picker-cell', labelKey)
    const value = doc.createElement('span')
    value.setAttribute('data-dsh-picker-cell', valueKey)
    row.appendChild(label)
    row.appendChild(value)
    card.appendChild(row)
    return { label, value }
  })
  rows[1].label.textContent = 'Color'
  rows[2].label.textContent = 'Font'

  root.appendChild(card)
  root.appendChild(highlight)
  root.appendChild(hint)

  /**
   * Fill the hover card and place it beside the element.
   *
   * @param {Element} element - Element under the pointer.
   * @returns {void}
   */
  const paintCard = (element) => {
    const facts = hoverFacts(element, win)
    rows[0].label.textContent = facts.title
    rows[0].value.textContent = facts.size
    rows[1].value.textContent = facts.color
    rows[2].value.textContent = facts.font
    card.setAttribute('data-dsh-picker-visible', 'true')

    const box = element.getBoundingClientRect()
    const height = card.getBoundingClientRect?.().height ?? 0
    const below = box.bottom + 8
    const flip = height > 0 && below + height > (win.innerHeight ?? 0)
    card.style.left = `${Math.max(8, Math.round(box.left))}px`
    card.style.top = `${Math.round(flip ? Math.max(8, box.top - 8 - height) : below)}px`
  }

  const host = doc.body ?? doc.documentElement
  host.appendChild(root)

  let active = false
  let current = null

  /**
   * Reposition the highlight over the current target, in viewport coordinates
   * (the highlight is fixed), so scrolling and nested scrollports both stay
   * accurate as long as a scroll repaints.
   *
   * @returns {void}
   */
  const paint = () => {
    if (current === null) {
      highlight.removeAttribute('data-dsh-picker-visible')
      card.removeAttribute('data-dsh-picker-visible')
      return
    }
    const box = current.getBoundingClientRect()
    highlight.style.left = `${Math.round(box.left)}px`
    highlight.style.top = `${Math.round(box.top)}px`
    highlight.style.width = `${Math.round(box.width)}px`
    highlight.style.height = `${Math.round(box.height)}px`
    highlight.setAttribute('data-dsh-picker-visible', 'true')
    paintCard(current)
  }

  /**
   * Depth of an element in the tree, used to pick the innermost candidate when
   * hit-testing cannot answer.
   *
   * @param {Element} element - Candidate element.
   * @returns {number} Ancestor count.
   */
  const depthOf = (element) => {
    let depth = 0
    let node = element.parentElement
    while (node !== null) {
      depth += 1
      node = node.parentElement
    }
    return depth
  }

  /**
   * Last-resort lookup for points where hit-testing returns nothing.
   *
   * `elementsFromPoint` skips anything with `pointer-events: none` (and any
   * region whose whole stack is the picker's own UI), which is exactly the
   * "some elements cannot be selected" case. This walks the tree instead and
   * takes the deepest element whose box contains the point. It only runs when
   * the cheap path failed, so its cost is paid once per click, not per move.
   *
   * @param {number} x - Viewport x.
   * @param {number} y - Viewport y.
   * @returns {Element | null} The innermost containing element, else null.
   */
  const geometricAt = (x, y) => {
    if (typeof doc.querySelectorAll !== 'function') return null
    let best = null
    let bestDepth = -1
    for (const element of doc.querySelectorAll('*')) {
      if (isOwnNode(element, doc)) continue
      if (element === doc.documentElement || element === doc.body) continue
      const box = element.getBoundingClientRect()
      if (box.width === 0 || box.height === 0) continue
      if (x < box.left || x > box.right || y < box.top || y > box.bottom) continue
      const depth = depthOf(element)
      if (depth <= bestDepth) continue
      bestDepth = depth
      best = element
    }
    return best
  }

  /**
   * The element under a viewport point, ignoring the picker's own nodes.
   *
   * @param {number} x - Viewport x.
   * @param {number} y - Viewport y.
   * @returns {Element | null} The element under the pointer, else null.
   */
  const targetAt = (x, y) => {
    const stack =
      typeof doc.elementsFromPoint === 'function'
        ? doc.elementsFromPoint(x, y)
        : [doc.elementFromPoint(x, y)]
    for (const node of stack) {
      if (node === null || node.nodeType !== 1) continue
      if (isOwnNode(node, doc)) continue
      // The page itself is never the answer: picking `html`/`body` is noise.
      if (node === doc.documentElement || node === doc.body) continue
      return node
    }
    return geometricAt(x, y)
  }

  const onPointerMove = (event) => {
    if (!active) return
    const next = targetAt(event.clientX, event.clientY)
    if (next === current) return
    current = next
    paint()
  }

  const stopEvent = (event) => {
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
  }

  const swallow = (event) => {
    if (!active) return
    if (isOwnNode(event.target, doc)) return
    stopEvent(event)
  }

  const onClick = (event) => {
    if (!active) return
    if (isOwnNode(event.target, doc)) return
    swallow(event)

    const element = targetAt(event.clientX, event.clientY)
    if (element === null) {
      emit({ type: 'pick-missed' })
      return
    }
    // Selection mode deliberately stays on: picking several elements in a row is
    // the normal case, and the mode ends only on the button or Escape.
    emit({ type: 'pick' })
    onPick(element, event)
  }

  const onKeyDown = (event) => {
    // Grouping works whether or not selection mode is on: it acts on the draft.
    if (event.ctrlKey === true && event.shiftKey === true && event.key.toLowerCase() === GROUP_SHORTCUT_KEY) {
      stopEvent(event)
      emit({ type: 'group' })
      return
    }
    if (event.ctrlKey === true && event.shiftKey === true && event.key.toLowerCase() === TOGGLE_SHORTCUT_KEY) {
      // Ours in both directions: the chord must not reach the application even
      // when it is turning selection mode on.
      stopEvent(event)
      setActive(!active)
      emit({ type: 'toggle-shortcut' })
      return
    }
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

    if (!active) {
      current = null
      highlight.removeAttribute('data-dsh-picker-visible')
      card.removeAttribute('data-dsh-picker-visible')
    }
    emit({ type: active ? 'enter' : 'leave' })
    return active
  }

  // Window capture, not document capture: DSH dismisses its own menus
  // (model/effort, slash and @ menus, command cards) from window-capture
  // pointerdown listeners, which run before any document-level handler. Bound
  // here, the picker sees the event first, swallows it, and the menu survives
  // long enough to be picked instead of vanishing under the pointer.
  const captureTarget = typeof win.addEventListener === 'function' ? win : doc
  captureTarget.addEventListener('pointermove', onPointerMove, true)
  captureTarget.addEventListener('click', onClick, true)
  captureTarget.addEventListener('keydown', onKeyDown, true)
  for (const type of SWALLOWED_EVENTS) captureTarget.addEventListener(type, swallow, true)
  win.addEventListener('scroll', onScrollOrResize, true)
  win.addEventListener('resize', onScrollOrResize, true)

  return {
    element: root,
    isActive: () => active,
    setActive,
    toggle: () => setActive(!active),
    dispose: () => {
      captureTarget.removeEventListener('pointermove', onPointerMove, true)
      captureTarget.removeEventListener('click', onClick, true)
      captureTarget.removeEventListener('keydown', onKeyDown, true)
      for (const type of SWALLOWED_EVENTS) captureTarget.removeEventListener(type, swallow, true)
      win.removeEventListener('scroll', onScrollOrResize, true)
      win.removeEventListener('resize', onScrollOrResize, true)
      root.remove()
    },
  }
}


	//#region @dsh-external/dsh-element-picker/src
/**
 * Plugin entry for the browser half.
 *
 * Registers one compact control in the composer tool row
 * (`conversation.input.left`) and owns the frame-wide overlay: the floating
 * pointer button, the highlight, and selection mode.
 *
 * The overlay is plain DOM; React is only used for the slot component, because
 * slot entries must render React. `react` is a DSH platform module, so the
 * bundle requires it instead of shipping it.
 */
const React = require("react")


/**
 * Slot the control opts into: the sidebar foot, beside Settings.
 *
 * This slot is root-scoped, so it renders whether or not a session is open —
 * and its props carry no session id or input actions. Both are therefore
 * resolved from services at pick time (see `resolveSessionId` and the facade),
 * which keeps the picker working from any slot.
 */
const SLOT = 'sidebar.footer.action'

/**
 * Order within that list; lower sorts first.
 *
 * DSH sorts these entries ascending, and the Bash widget registers at 10 — so
 * this lands immediately after it, which is the line our control is offset from
 * (see POSITION_SELECTORS).
 */
const ENTRY_ORDER = 11

/**
 * What the control aligns itself beside, in order of preference.
 *
 * The footer is a wrapping flex row, and the Bash widget's wrapper claims the
 * full row width, so an entry that takes part in that flow can only ever end up
 * on the next line. The control is therefore offset out of the flow onto that
 * row's right-hand end, re-measured as the footer changes instead of assumed.
 */
const POSITION_SELECTORS = ['.sbw-wrap', '[class*="footerActions"]', '[class*="footArea"]']

/** Services this plugin's browser half consumes (declared in package.json too). */

/** Entry id (a fresh id adds a cell beside the shipped entries). */
const ENTRY_ID = 'element-picker'

/** Console prefix for every diagnostic this plugin prints. */
const LOG_PREFIX = '[dsh-element-picker]'

/** Edge length of the control, in px. */
const CONTROL_SIZE = 28

/**
 * Cordis services this plugin needs.
 *
 * Every service property is guarded: reading one that is not declared here
 * throws ("cannot get property X without inject"), and a throw inside apply
 * aborts the host's boot. So each service the picker touches is listed, even the
 * ones only used on the pick path.
 */
const inject = ['slots', 'inputTriggers', 'conversation', 'sessions']

/**
 * @param {...unknown} args - Values to log.
 * @returns {void}
 */
function log(...args) {
  // eslint-disable-next-line no-console
  console.log(LOG_PREFIX, ...args)
}

/**
 * The mouse-pointer glyph used by the composer control.
 *
 * @returns {unknown} A React element.
 */
function PointerIcon() {
  return React.createElement(
    'svg',
    {
      width: 16,
      height: 16,
      viewBox: '0 0 24 24',
      fill: 'none',
      'aria-hidden': 'true',
    },
    React.createElement('path', {
      d: 'M5 3l14 8-6 1.6L10.6 19z',
      fill: 'currentColor',
    }),
  )
}

/**
 * The composer tool-row control: toggles selection mode and keeps the slot's
 * live input face reachable from the DOM-side picker.
 *
 * @param {object} props - Slot props (session scope standard props).
 * @returns {unknown} A React element.
 */
function PickerButton(props) {
  const anchorRef = React.useRef(null)
  const [offset, setOffset] = React.useState({ absolute: false, dx: 0, dy: 0 })
  const inputActions = props.inputActions
  const state = PICKER_STATE
  state.inputActions = inputActions
  state.sessionId = props.sessionId
  state.draft = typeof props.useInput === 'function' ? props.useInput((s) => s.draft) : ''

  const [active, setActive] = React.useState(state.picker === null ? false : state.picker.isActive())
  React.useEffect(() => {
    if (state.picker === null) return undefined
    state.subscribe(setActive)
    return () => state.unsubscribe(setActive)
  }, [])

  const onClick = React.useCallback((event) => {
    event.preventDefault()
    event.stopPropagation()
    if (state.picker !== null) state.picker.toggle()
  }, [])

  React.useLayoutEffect(() => {
    let queued = false
    const measure = () => {
      queued = false
      const anchor = anchorRef.current
      if (anchor === null) return
      // Only a box with real size can anchor anything: an empty slot host or a
      // row with no entries measures 0 and would place the control at a guess.
      let target = null
      for (const selector of POSITION_SELECTORS) {
        const candidate = anchor.ownerDocument.querySelector(selector)
        if (candidate === null) continue
        const box = candidate.getBoundingClientRect()
        if (box.width > 0 && box.height > 0) {
          target = candidate
          break
        }
      }
      if (target === null) {
        setOffset({ absolute: false, dx: 0, dy: 0 })
        return
      }
      const row = target.getBoundingClientRect()
      const here = anchor.getBoundingClientRect()
      const size = CONTROL_SIZE

      // The row already holds DSH's own footer widget (full width when expanded,
      // a rail when collapsed). Sit after it only when that leaves room; in a
      // collapsed sidebar there is none, and offsetting anyway is what made the
      // control overlap that widget. No room means no offset: the wrapping flex
      // row then stacks the entries, which is the top/middle/bottom the narrow
      // sidebar should have.
      let neighbour = null
      for (const child of target.children) {
        // Never treat our own anchor as the neighbour: in flow mode it is sized,
        // and using it would make the placement depend on itself.
        if (typeof child.closest === 'function' && child.closest('[data-dsh-picker-ui]') !== null) continue
        const childBox = child.getBoundingClientRect()
        if (childBox.width === 0 || childBox.height === 0) continue
        neighbour = childBox
        break
      }

      const desired = neighbour === null ? row.right - 6 - size : neighbour.right + 8
      const fits = desired >= row.left && desired + size <= row.right - 6
      if (!fits) {
        // No room beside the neighbour: take part in the layout instead of being
        // painted from a zero-size anchor, so the wrapping row stacks us on our
        // own line rather than letting the button hang out of the sidebar.
        setOffset({ absolute: false, dx: 0, dy: 0 })
        return
      }

      setOffset({
        absolute: true,
        dx: Math.round(desired - here.left),
        dy: Math.round(row.top + (row.height - size) / 2 - here.top),
      })
    }
    const schedule = () => {
      if (queued) return
      queued = true
      if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(measure)
      else setTimeout(measure, 16)
    }

    measure()
    window.addEventListener('resize', schedule)
    const observer = new MutationObserver(schedule)
    observer.observe(document.body, { childList: true, subtree: true })

    // Collapsing the sidebar only changes widths, which produces no mutation, so
    // a mutation-only watch left the offset stale until the next chat update —
    // seconds of a misplaced or invisible control. A ResizeObserver follows the
    // layout itself.
    let resizeObserver = null
    if (typeof window.ResizeObserver === 'function') {
      resizeObserver = new window.ResizeObserver(schedule)
      const anchor = anchorRef.current
      const watched = new Set([anchor?.parentElement, document.querySelector('[class*="sidebarCol"]'), document.querySelector('[class*="footArea"]')])
      for (const element of watched) {
        if (element !== null && element !== undefined) resizeObserver.observe(element)
      }
    }

    return () => {
      window.removeEventListener('resize', schedule)
      observer.disconnect()
      if (resizeObserver !== null) resizeObserver.disconnect()
    }
  }, [])

  return React.createElement(
    'div',
    {
      ref: anchorRef,
      'data-dsh-picker-ui': 'slot-anchor',
      'data-dsh-picker-mode': offset.absolute ? 'offset' : 'flow',
      style: offset.absolute
        ? { position: 'relative', width: 0, height: 0, pointerEvents: 'none' }
        : { position: 'relative', width: CONTROL_SIZE, height: CONTROL_SIZE, pointerEvents: 'none' },
    },
    React.createElement(
      'button',
      {
      type: 'button',
      onClick,
      'data-dsh-picker-ui': 'slot-button',
      'aria-label': '选择界面元素加入聊天',
      'aria-pressed': active ? 'true' : 'false',
      title: '选择界面元素加入聊天（Ctrl+Shift+E 切换，菜单内选择请用快捷键进入选择模式）',
      // The control keeps exactly one look in every state: the ring carries the
      // feedback, and a background swap on press was reading as a different
      // button. State still rides `aria-pressed` for assistive tech.
      style: {
        position: offset.absolute ? 'absolute' : 'static',
        left: 0,
        top: 0,
        transform: offset.absolute ? `translate(${offset.dx}px, ${offset.dy}px)` : 'none',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: CONTROL_SIZE,
        height: CONTROL_SIZE,
        padding: 0,
        border: 'none',
        borderRadius: 6,
        background: 'transparent',
        color: 'inherit',
        cursor: 'pointer',
      },
    },
      React.createElement(PointerIcon, null),
    ),
  )
}

/**
 * Shared state between the React slot control and the DOM-side picker: slot
 * props are the only place the live input face exists, and the picker callback
 * is the only place the pick arrives.
 */
const PICKER_STATE = {
  picker: null,
  inputActions: undefined,
  draft: '',
  // A pick inserts a chip (compact in the composer, expanded on send); holding
  // Shift while picking inserts the full text block instead.
  detailed: false,
  sessionId: undefined,
  ctx: undefined,
  // A chip whose source has no registered codec would fail to serialize when the
  // message is sent, so a chip is only inserted once the codec is confirmed.
  chipReady: false,
  listeners: new Set(),
  subscribe(listener) {
    PICKER_STATE.listeners.add(listener)
  },
  unsubscribe(listener) {
    PICKER_STATE.listeners.delete(listener)
  },
  publish() {
    if (PICKER_STATE.picker === null) return
    for (const listener of PICKER_STATE.listeners) listener(PICKER_STATE.picker.isActive())
  },
}

/**
 * Insert one picked element's locating block into the composer.
 *
 * @param {Element} element - The resolved element.
 * @returns {void}
 */
/**
 * The session a pick should land in.
 *
 * A root-scoped entry has no `sessionId` prop, so the current selection is read
 * from the session list service instead.
 *
 * @param {object | undefined} ctx - Plugin (root) context.
 * @param {string | undefined} fromProps - A session-scoped prop, when present.
 * @returns {string | undefined} A session id, when one is known.
 */
function resolveSessionId(ctx, fromProps) {
  if (typeof fromProps === 'string' && fromProps !== '') return fromProps
  try {
    const current = ctx?.sessions?.list?.getSnapshot?.()?.current
    if (typeof current === 'string' && current !== '') return current
  } catch (error) {
    log('could not read the current session:', String(error))
  }
  return undefined
}


function insertPickedElement(element, detailed = false) {
  const doc = element.ownerDocument
  const win = doc.defaultView ?? undefined
  let text = ''
  try {
    text = buildElementBlock(element, {
      doc,
      win,
      scroll: { x: win?.scrollX ?? 0, y: win?.scrollY ?? 0 },
      detailed: detailed === true,
    })
  } catch (error) {
    log('failed to describe element:', String(error))
    return
  }

  // A root-scoped entry gets no session or input face through props, so both are
  // resolved from services here — per pick, not per render, so a session switch
  // is picked up without any subscription.
  const ctx = PICKER_STATE.ctx
  const sessionId = resolveSessionId(ctx, PICKER_STATE.sessionId)
  const binding = resolveInputBinding(ctx, sessionId, (message) => log(message))
  const facade = binding === null ? null : binding.facade

  // A chip is the DSH-native shape for this: compact in the composer, expanded
  // into the block above by the chip's codec when the message is sent.
  if (detailed !== true) {
    // The trigger registry may not have been up when the plugin applied
    // (service ordering), so registration is retried before the first chip use.
    if (PICKER_STATE.chipReady !== true) {
      PICKER_STATE.chipReady = registerChipSource(ctx)
      if (PICKER_STATE.chipReady) log('chip codec registered on retry')
    }
  }

  if (detailed !== true && PICKER_STATE.chipReady === true) {
    // The chip is a short label in the composer, but what it stands for — and
    // therefore what the model receives on send — is the FULL block: selector,
    // XPath, geometry, computed style, attributes, source, and an HTML excerpt.
    // The composer stays clean because none of that is rendered there.
    let payload = text
    try {
      payload = buildElementBlock(element, {
        doc,
        win,
        scroll: { x: win?.scrollX ?? 0, y: win?.scrollY ?? 0 },
        detailed: true,
      })
    } catch (error) {
      log('falling back to the compact payload:', String(error))
    }

    const chip = insertElementChip({
      ctx,
      sessionId,
      text: payload,
      label: chipLabel(element),
      onEvent: (message) => log(message),
    })
    if (chip !== null) {
      const lines = payload.split(String.fromCharCode(10)).filter((line) => line !== '').length
      log(`inserted a ${chip} for ${element.tagName.toLowerCase()} carrying a ${lines}-line block`)
      // ZCode merges as you go: the picks are one group chip, not a row of them.
      const chips = doc.querySelectorAll(`[data-composer-chip="element-picker"]`).length
      if (chips > 1) groupPickedChips()
      return
    }
  }

  // The text fallback needs a draft and a way to write one; both come from the
  // facade when the slot props do not carry them.
  let draft = PICKER_STATE.draft
  let inputActions = PICKER_STATE.inputActions
  if (facade !== null) {
    try {
      const snapshot = facade.state?.getSnapshot?.()
      if (typeof snapshot?.draft === 'string') draft = snapshot.draft
    } catch {
      /* the prop-derived draft stands */
    }
    if (inputActions === undefined && typeof facade.setDraft === 'function') {
      inputActions = { setDraft: (next) => facade.setDraft(next) }
    }
  }

  const result = insertBlock({ text, doc, win, draft, inputActions })

  if (result.ok) {
    const earlier = result.tried.slice(0, -1)
    const trail = earlier.length === 0 ? '' : ` after ${JSON.stringify(earlier)}`
    log(`inserted via "${result.path}" (${result.note ?? 'no note'})${trail}`)
    return
  }
  log('insert failed; attempt trail:', JSON.stringify(result.tried))
}

/**
 * The block a chip stands for, read back from the published occurrences.
 *
 * Reading it from the input state rather than from what we inserted means the
 * preview still works after a reload, when nothing of ours is in memory.
 *
 * @param {Element} chip - One of our chips.
 * @returns {string} The payload, or '' when it cannot be read.
 */
function chipPayload(chip) {
  try {
    const doc = chip.ownerDocument
    const binding = resolveInputBinding(PICKER_STATE.ctx, resolveSessionId(PICKER_STATE.ctx, PICKER_STATE.sessionId), () => {})
    const snapshot = typeof binding?.facade?.state?.getSnapshot === 'function' ? binding.facade.state.getSnapshot() : undefined
    const occurrences = Array.isArray(snapshot?.occurrences) ? snapshot.occurrences : []
    const index = chipIndexOf(doc, chip)
    const occurrence = index >= 0 ? occurrences[index] : undefined
    return typeof occurrence?.clipboardText === 'string' ? occurrence.clipboardText : ''
  } catch (error) {
    log('could not read a chip payload:', String(error))
    return ''
  }
}

/**
 * Fold every picked element's chip in the draft into one group chip.
 *
 * @returns {void}
 */
function groupPickedChips() {
  const ctx = PICKER_STATE.ctx
  if (PICKER_STATE.chipReady !== true) {
    PICKER_STATE.chipReady = registerChipSource(ctx)
  }
  if (PICKER_STATE.chipReady !== true) {
    log('grouping skipped: the chip codec is not registered')
    return
  }
  const result = groupElementChips({
    ctx,
    sessionId: resolveSessionId(ctx, PICKER_STATE.sessionId),
    onEvent: (message) => log(message),
  })
  if (result === null) log('grouping produced nothing')
}

/**
 * Remove the chip a click landed on.
 *
 * @param {Element} chip - The chip to drop.
 * @returns {void}
 */
function removePickedChip(chip) {
  const doc = chip.ownerDocument
  // Same resolution as a pick: the control lives in a root-scoped slot, so the
  // session comes from the service rather than from slot props.
  const sessionId = resolveSessionId(PICKER_STATE.ctx, PICKER_STATE.sessionId)
  const binding = resolveInputBinding(PICKER_STATE.ctx, sessionId, (message) => log(message))
  const path = removeChipElement({
    doc,
    chip,
    facade: binding === null ? null : binding.facade,
    actx: binding === null ? null : binding.actx,
    onEvent: (message) => log(message),
  })
  log(path === null ? 'the chip was not removed' : `removed a chip via "${path}"`)
}

/**
 * Mount the overlay and register the composer control.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx - Plugin context.
 * @returns {void}
 */
function apply(ctx) {
  try {
    applyPicker(ctx)
  } catch (error) {
    // A throwing loader entry aborts the host's boot (an empty page, not a
    // missing button), so the picker contains its own failures.
    log('apply failed; the picker stays inert:', String(error))
  }
}

/**
 * Mount the overlay and register the composer control.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx - Plugin context.
 * @returns {void}
 */
function applyPicker(ctx) {
  const win = window
  const doc = win.document
  PICKER_STATE.ctx = ctx
  const chipsRegistered = registerChipSource(ctx)
  PICKER_STATE.chipReady = chipsRegistered
  const teardownStyles = installStyles(doc)

  const picker = createPicker({
    doc,
    win,
    onPick: (element, event) => {
      // Shift is the escape hatch to the verbose block; no config plumbing.
      insertPickedElement(element, event !== undefined && event.shiftKey === true)
    },
    onEvent: (event) => {
      if (event.type === 'pick' || event.type === 'cancel-escape' || event.type === 'pick-missed') {
        log('overlay event:', event.type)
      }
      if (event.type === 'group') {
        groupPickedChips()
        return
      }
      PICKER_STATE.publish()
    },
  })
  PICKER_STATE.picker = picker

  log(
    `mode: chip with a text fallback${chipsRegistered ? '' : ' — chip codec not registered yet'}` +
      '; Shift+click inserts the full text block',
  )

  ctx.slots.inject(SLOT, () =>
    ctx.slots.register(
      { name: SLOT, id: ENTRY_ID, order: ENTRY_ORDER, label: '选择元素' },
      PickerButton,
    ),
  )

  // Sent element blocks fold into pills in the transcript (the message text is
  // untouched; this is how it renders).
  const stopWatchingTranscript = watchTranscript({ doc, win, onEvent: (message) => log(message) })

  const chipPreview = watchChipPreview({ doc, win, payloadOf: (chip) => chipPayload(chip) })

  const stopWatchingChips = watchChipRemoval({
    doc,
    win,
    onRemove: removePickedChip,
    isPickerActive: () => picker.isActive(),
  })

  ctx.effect(() => () => {
    stopWatchingTranscript()
    chipPreview.dispose()
    stopWatchingChips()
    picker.dispose()
    PICKER_STATE.picker = null
    PICKER_STATE.listeners.clear()
    teardownStyles()
  }, 'dsh-element-picker: overlay and stylesheet')
}


		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	},
});

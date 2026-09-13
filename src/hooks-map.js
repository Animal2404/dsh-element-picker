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
export const HOOK_SOURCES = {
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
export function sourceFor(element, doc) {
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

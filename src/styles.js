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
export const PICKER_CSS = `
#dsh-element-picker-root {
  position: fixed;
  inset: 0;
  width: 0;
  height: 0;
  z-index: 2147483000;
  pointer-events: none;
}

[data-dsh-picker-ui="highlight"] {
  position: fixed;
  display: none;
  pointer-events: none;
  background: rgba(255, 138, 61, 0.16);
  outline: 2px solid #ff8a3d;
  outline-offset: -1px;
  border-radius: 2px;
}

[data-dsh-picker-ui="highlight"][data-dsh-picker-visible="true"] {
  display: block;
}

[data-dsh-picker-ui="hint"] {
  position: fixed;
  left: 50%;
  bottom: 24px;
  transform: translateX(-50%);
  display: none;
  max-width: 70vw;
  padding: 8px 14px;
  border-radius: 8px;
  background: rgba(22, 24, 29, 0.94);
  border: 1px solid rgba(255, 255, 255, 0.12);
  color: #e5e7eb;
  font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  white-space: nowrap;
  pointer-events: none;
}

[data-dsh-picker-active="true"] [data-dsh-picker-ui="hint"] {
  display: block;
}

[data-dsh-picker-active="true"] {
  cursor: crosshair;
}
`

/** Stylesheet element id, used to keep injection idempotent. */
export const PICKER_STYLE_ID = 'dsh-element-picker-style'

/**
 * Install the overlay stylesheet once.
 *
 * @param {Document} doc - Owning document.
 * @returns {() => void} Teardown that removes the stylesheet.
 */
export function installStyles(doc) {
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

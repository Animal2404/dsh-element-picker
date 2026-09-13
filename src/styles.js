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
  background: var(--dsw-alias-bg-overlay, var(--dsw-alias-bg-layer-3, rgba(20, 22, 27, 0.97)));
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

[data-dsh-picker-ui="hint"] {
  position: fixed;
  left: 50%;
  top: 10px;
  transform: translateX(-50%);
  display: none;
  max-width: 70vw;
  padding: 6px 12px;
  border-radius: 8px;
  background: var(--dsw-alias-bg-overlay, var(--dsw-alias-bg-layer-3, rgba(22, 24, 29, 0.94)));
  border: 1px solid var(--dsw-elevation-stroke-color, rgba(255, 255, 255, 0.12));
  color: var(--dsw-alias-label-primary, #e5e7eb);
  font: 12px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  white-space: nowrap;
  box-shadow: var(--dsw-elevation-soft, 0 6px 20px rgba(0, 0, 0, 0.35));
  pointer-events: none;
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
  background: var(--dsw-alias-bg-layer-1, rgba(255, 255, 255, 0.16));
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

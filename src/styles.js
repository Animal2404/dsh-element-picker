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
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
}

[data-dsh-picker-preview-text] {
  flex: 1 1 auto;
  min-width: 0;
}

[data-dsh-picker-preview-item] + [data-dsh-picker-preview-item] {
  border-top: 1px solid var(--dsw-elevation-stroke-color, rgba(255, 255, 255, 0.08));
}

/* The row's delete button: ZCode puts a trash glyph on every row of the list. */
[data-dsh-picker-ui="preview-remove"] {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--dsw-alias-label-tertiary, #8b93a1);
  cursor: pointer;
  pointer-events: auto;
}

[data-dsh-picker-ui="preview-remove"]:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(255, 255, 255, 0.08));
  color: var(--dsw-alias-label-primary, #e5e7eb);
}

[data-dsh-picker-ui="preview-remove"]:active {
  transform: scale(0.92);
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

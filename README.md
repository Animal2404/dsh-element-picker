# DSH Element Picker

A native picker for the DeepSeek Harness Web UI: click the pointer button in the
composer tool row to enter selection mode, hover to outline a UI element, click
it to insert its locating information into the chat composer, and click the
button again (or press Escape) to leave selection mode.

Built for DSH itself — the button lives inside the app, and the elements it
picks are the app's own UI. Picking elements on arbitrary websites is a
different job (a browser extension), not this one.

## Behaviour

1. One control, in the sidebar foot beside Settings (`sidebar.footer.action`), so
   it is present whether or not a session is open: a pointer icon with a slowly
   turning conic-gradient ring. The ring is the state cue — it speeds up while
   selecting — and the control itself looks identical in every state (an earlier
   version repainted its background while selecting, which read as a different
   button; `aria-pressed` carries the state for assistive tech). Because that
   slot is root-scoped, the session and the input face are resolved from services
   at pick time rather than from slot props. The overlay owns no button of its
   own: an earlier floating button duplicated the control and sat on top of the
   composer's send button. While selecting, the chips' `×` is dimmed: clicks
   belong to the picker until the selection ends.
2. Click it: selection mode turns on, the hint bar appears, and hovering
   outlines the element that will be picked.
3. Click an element: it becomes a chip in the composer (or the compact text line
   where chips are unavailable). **Selection mode stays on**, so elements can be
   picked one after another.
4. Click the button again, or press Escape: the selection ends. That is the only
   way out — a pick never ends it.
5. `Ctrl+Shift+E` toggles selection mode from the keyboard. That is how you pick
   inside a menu: open the menu first, toggle with the shortcut, then click the
   item — entering selection mode by click would dismiss the menu, and clicking
   inside it while selecting is swallowed by the picker before the menu's own
   `pointerdown` dismissal can fire.
5. Selector generation prefers the hooks DSH exposes on purpose (`data-*`
   markers) over CSS-module class names, which are build-time hashes, and still
   falls back to a unique positional path when nothing stable exists.

### What gets picked: exactly what you pointed at

The pick is the element under the pointer, with no climbing. That is what ZCode
does, and it is what people expect: outline a row and you get the row.

Earlier versions climbed to "the nearest thing that looks like a target", and the
result was silently wrong: pointing at a goal row handed back the `<button>` of
the collapsible section above it. Two field measurements had already shown how
fragile that heuristic is — DSH marks whole panels with `data-phase` (a session
root carries `data-phase="active"`) and mounts the entire app under `div#root`,
so accepting a generic marker or any id as a target outlined a 907×815
application-sized box.

### What cannot be picked, and why

Two surfaces are structurally unreachable from a picker that lives in the page's
top document, both in the right-sidebar document preview:

- an **HTML file preview**, rendered in a `sandbox="allow-scripts"` iframe with a
  blob URL and *no* `allow-same-origin`, so its document is an opaque origin the
  parent cannot read or script;
- a **PDF preview**, drawn by the bundled PDF.js straight into a `<canvas>` with
  no text layer, so there is no element to point at.

Everything else in the UI is either reachable or recovered: menus and popovers
that dismiss themselves on `pointerdown` are why the picker listens on **window**
capture rather than document capture — it has to see the event before the app's
own window-capture dismissal closes the menu under the pointer.

Two deliberate limits remain:

- `html`/`body` are never picked (a `[元素] body` insert is noise);
- when hit-testing returns nothing at all — a point covered only by
  `pointer-events: none` surfaces — the picker falls back to the deepest element
  whose box contains the point. That fallback is why regions which used to be
  unselectable now respond.

## What a pick inserts

By default a pick inserts a **reference chip** — the DSH-native shape for
"compact in the composer, rich for the model". The composer shows one short
label plus a small `×`; when the message is sent, the chip's codec expands it
into the **full** locating block (selector, XPath, geometry, computed style,
attributes, source file, HTML excerpt) — eight lines, none of which the composer
renders. Nothing else lands in the draft.

Clicking the `×` drops that chip. The glyph is a CSS `::after` on the chip (the
chip's span is React's portal container, so an injected child would sit outside
React's managed tree), and the click is resolved from the chip's own right-hand
box. Removal itself goes through `consumeToken` over the chip's detect span —
the composer's own verb for dropping a token —— so a user's `@file` chips in the
same draft are untouched. `setDraft` is deliberately never used for removal:
it rebuilds the draft as plain text and would flatten them.

Where the chip is unavailable — no session-bound context yet, the input machine
refusing the edit, or the codec source not registered — the picker falls back to
a single compact text line, because a chip whose source has no codec would fail
to serialize and block the send.

The compact line (also what the fallback inserts):

```
[元素] button.IXshSW_header "任务 6 已完成 · 1 进行中" ｜ [选择器] button.IXshSW_header ｜ [源码] …/skeleton/ConversationRoot.tsx
```

`[源码]` is the DSH-specific part: stable hooks are mapped to the source files
that render them, so a follow-up request ("move this button") starts from a path
instead of a class hash. The path is shortened to its last two segments, because
every character lands in the user's composer.

Hold **Shift** while picking to insert the full block instead of a chip.

It emits: — `[元素] [选择器] [XPath] [位置] [样式] [属性] [源码] [HTML]`:

```
[元素] button.primary "发送"
[选择器] [data-composer-card] button[aria-label="发送消息"]
[XPath] /html/body/div[2]/div[3]/button
[位置] 44x44 @ viewport(1032,688) page(1032,808)
[样式] color #F9FAFB; font 16px -apple-system,…; font-weight 600; display flex
[属性] aria-label="发送消息"
[源码] packages/client/ui-conversation/src/client/skeleton/InputBar.tsx (data-composer-card)
[HTML] <button aria-label="发送消息" data-phase="idle">发送</button>
```

## Insertion

The composer is a Lexical `contenteditable` (`[data-composer-input]`), and the
published plugin API only offers "replace the whole draft". Insertion is
therefore a cascade, each step verified before the next is tried:

| Path | How | Effect |
| --- | --- | --- |
| `paste` | the shell's internal `paste(text)` | inserts at the caret, keeps reference chips |
| `dom` | a synthetic paste event, then `execCommand('insertText')`, then `beforeinput`, with the caret placed inside the editor first | Lexical applies it as a user edit |
| `setDraft` | `setDraft(draft + text)` | last resort: the draft is rebuilt as plain text, so reference chips flatten to their text form |

The path actually used is logged, together with the reason every earlier path was
skipped: `[dsh-element-picker] inserted via "…" (caret=placed routes[…])`.

### What real DSH 0.1.5-rc.2 actually does (measured, not assumed)

- `inputActions.paste` is **not exposed** to plugins, so the first path only
  exists as a feature-detected placeholder for a build that does expose it.
- The `dom` path loses there in every variant: a synthetic paste event is
  **refused** (no listener claims it), `execCommand('insertText')` **flattens the
  newlines** of a multi-line block and reorders its fields, and in a later state
  both `insertText` and `insertParagraph` **report success while changing
  nothing** at all. `undo` does not roll such an insert back either.
- `setDraft` therefore carries the insert, and the result is structurally right:
  the editor's DOM shows one `<p>` per field, in order, with the text already in
  the draft kept on the first line. The cost is that a reference chip already in
  the draft is flattened to its plain-text form (`@path` stays as text, but is no
  longer a chip).
- `setDraft(draft + text)` is idempotent, so it also repairs anything a failed
  DOM route might have left behind.

## Repository policy: cloud-only

Nothing in this repository is built, tested, or run on a developer machine.
`.github/workflows/ci.yml` is the only producer:

- `npm run lint` — manifest contract, flattenability, CSS namespacing, no
  Node/network access in browser code;
- `npm run build` — flattens `src/` into `lib/client.js` in the DSH loader
  format (`window.__ModuleLoader__.load({ id, factory })`, a classic script);
- `npm run verify` — asserts the artifact's loader contract;
- `npm test` — selector, describe, insertion-cascade, overlay, and
  loader/registration suites, all dependency-free;
- `.github/workflows/e2e.yml` — a real Chromium, driven through the whole
  interaction, over a harness page that reproduces the composer's DOM contract
  and loads the built bundle through a loader stub with the real React UMD
  build. It asserts the highlight geometry against the element's bounding box,
  that the swallowed click never reaches the application, that ordinary
  interaction resumes afterwards, and that Escape cancels without inserting.
  Screenshots are uploaded as the evidence artifact. What it does **not** prove
  is that DSH's real Lexical editor behaves like the harness editable — that is
  the remaining unknown, and it needs a real DSH build (see Verification
  status);
- `publish-lib` — commits the built `lib/` back to `main`, because a DSH client
  plugin must ship a built `./client` export and local builds are not allowed.

## Verification status

| Layer | Evidence |
| --- | --- |
| Selector, block, cascade, overlay logic | `node:test` suites, green in CI |
| Built artifact contract | `verify-bundle` + the loader/registration suite, green in CI |
| Real browser behaviour | Playwright run over the harness page, green in CI, screenshots archived |
| **Real DSH 0.1.5-rc.2** | `.github/workflows/real-dsh.yml` boots the actual build on the runner, installs the plugin into a throwaway profile, and drives the real UI: the plugin mounts, the composer is confirmed to be a `contenteditable` (not a textarea), the session-scoped entry renders, selection mode and the highlight work on real elements, and a pick inserts the block into the real composer with the existing draft intact |

The harness is a stub host, not DSH: it reproduces the DOM contract and the
`slots`/`inputActions` surface the plugin consumes. The real-DSH job is what
covers the gap, and its evidence (DOM dumps, screenshots, plugin console, server
log) is uploaded on every run.

Both jobs are diagnostics-first: a step that cannot be reached is reported with
its reason rather than silently passing, and the run fails only for things that
are unambiguously broken.

## Install

```
dsh plugin --profile web add "link:<path to this repository>"
```

or, from GitHub once `lib/` has been published by the pipeline:

```
dsh plugin --profile web add "github:Animal2404/dsh-element-picker"
```

Restart `dsh web` afterwards. To disable without uninstalling, add to the
profile's `cordis.patch.yml`:

```yaml
- id: element-picker
  disabled: true
```

## Layout

```
package.json          dsh.bundle.patch + dsh.client + exports["./client"]
cordis.patch.yml      loader row: id element-picker
src/styles.js         overlay CSS (namespaced, injected as one <style>)
src/selector.js       CSS selector, XPath, element summary
src/hooks-map.js      stable DOM hook -> DSH source file
src/describe.js       the inserted block
src/insert.js         the paste/dom/setDraft cascade
src/overlay.js        selection mode: highlight, hint, event handling (no button)
src/plugin.js         entry: applies styles, mounts the overlay, registers the slot
scripts/              cloud-side lint, build, verify
tests/                node:test suites over a dependency-free DOM stub
lib/                  generated by CI and committed by the pipeline
```

## License

MIT

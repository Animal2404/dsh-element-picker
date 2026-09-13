/**
 * Harness host stub.
 *
 * The real host is DSH's Cordis client runtime, which cannot run in CI (the
 * instance lives on the user's machine). This stub reproduces the parts of the
 * contract the plugin actually touches:
 *
 *   - `window.__ModuleLoader__.load(...)` receives the built bundle;
 *   - `require('react')` resolves to the real React 18 UMD build;
 *   - `ctx.slots.inject` / `ctx.slots.register` mount the entry into a container
 *     standing in for the composer tool row;
 *   - `ctx.effect` collects disposers;
 *   - `inputActions` mimics the three shapes the insertion cascade probes
 *     (`paste` present, `dom` only, `setDraft` only).
 *
 * What this does NOT prove: that DSH's real Lexical editor behaves like the
 * harness editable. That is what the real-DSH job in the cloud is for.
 */
;(function () {
  var definition = null
  var disposers = []
  var inputActions = {}
  var currentDraft = ''
  var calls = { paste: 0, setDraft: 0, sends: 0, sidebar: 0 }

  window.__ModuleLoader__ = {
    load: function (loaded) {
      definition = loaded
    },
  }

  /** @returns {Element} The composer's editable element. */
  function composerInput() {
    return document.querySelector('[data-composer-input]')
  }

  /**
   * @param {string} text - Replacement draft text.
   * @returns {void}
   */
  function setEditableText(text) {
    composerInput().textContent = text
  }

  /**
   * Insert over the current selection, the way a paste into the shell behaves.
   *
   * @param {string} text - Text to insert.
   * @returns {void}
   */
  function insertAtCaret(text) {
    var input = composerInput()
    input.focus()
    document.execCommand('insertText', false, text)
  }

  /**
   * Build the input-actions face for one mode.
   *
   * @param {string} mode - dom | paste | non-editable
   * @returns {object} The actions object.
   */
  function buildInputActions(mode) {
    var actions = {
      setDraft: function (text) {
        calls.setDraft += 1
        setEditableText(text)
      },
      submit: function () {
        calls.sends += 1
      },
      addAttachments: function () {},
      removeAttachment: function () {},
      pruneAttachments: function () {},
    }
    if (mode === 'paste') {
      actions.paste = function (text) {
        calls.paste += 1
        insertAtCaret(text)
      }
    }
    return actions
  }

  /**
   * Mount the slot entry the plugin registers.
   *
   * @param {Function} component - Registered React component.
   * @param {object} options - Registration options.
   * @returns {void}
   */
  function mountEntry(component, options) {
    var container = document.getElementById('slot-left')
    var props = {
      inputActions: inputActions,
      sessionId: 'ci-session',
      useInput: function (selector) {
        return selector({ draft: currentDraft, draftRev: 0, occurrences: [], phase: 'plain' })
      },
    }
    window.__harness.mounted = { component: component, options: options }
    window.ReactDOM.createRoot(container).render(window.React.createElement(component, props))
  }

  window.__harness = {
    calls: calls,
    disposers: disposers,
    getDraft: function () {
      return composerInput().textContent
    },
    setDraftSeed: function (text) {
      currentDraft = text
      setEditableText(text)
    },
    dispose: function () {
      for (var i = 0; i < disposers.length; i += 1) {
        if (typeof disposers[i] === 'function') disposers[i]()
      }
      disposers = []
    },
    boot: function () {
      var params = new URLSearchParams(window.location.search)
      var mode = params.get('mode') || 'dom'
      window.__harness.mode = mode

      if (mode === 'non-editable') {
        composerInput().setAttribute('contenteditable', 'false')
        window.__harness.setDraftSeed('existing draft ')
      }

      inputActions = buildInputActions(mode)

      // Application-side listeners: if the picker leaks a click, these fire.
      document.querySelector('button[aria-label="发送消息"]').addEventListener('click', function () {
        calls.sends += 1
      })
      document.getElementById('sidebar-toggle').addEventListener('click', function () {
        calls.sidebar += 1
      })

      var exports = definition.factory(function (id) {
        if (id === 'react') return window.React
        throw new Error('unexpected platform module: ' + id)
      })

      window.__harness.exports = exports

      exports.apply({
        slots: {
          inject: function (name, build) {
            window.__harness.injected = name
            return build()
          },
          register: function (options, component) {
            mountEntry(component, options)
            return function () {}
          },
        },
        effect: function (fn) {
          var dispose = fn()
          if (typeof dispose === 'function') disposers.push(dispose)
          return function () {}
        },
      })
    },
  }
})()

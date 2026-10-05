type ReloadOptions = {
  reload?: () => void
  buildVersion?: string
  quietMilliseconds?: number
}

// No update button: a new worker queues one automatic page replacement.
// Checkout and workspaces remain intact until the customer leaves them.
export function createAutomaticReloadGate(options: ReloadOptions = {}) {
  const reload = options.reload || (() => window.location.reload())
  const buildVersion = options.buildVersion || __APP_BUILD_VERSION__
  const quietMilliseconds = options.quietMilliseconds ?? 2000
  let lastInteraction = Date.now()
  let pending = false
  let reloaded = false
  let disposed = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const dirty = new WeakSet<Element>()

  const reportBuild = () => {
    navigator.serviceWorker?.controller?.postMessage({ type: 'TALLY_CLIENT_BUILD', buildVersion })
  }
  const visible = (element: Element) => element.getClientRects().length > 0
  const blocked = () => {
    if (document.visibilityState !== 'visible' || !navigator.onLine) return true
    if (/^\/(?:checkout|admin|staff-admin|payment-callback)(?:\/|$)/.test(window.location.pathname)) return true
    if ([...document.querySelectorAll('[role="dialog"],[aria-busy="true"],button:disabled .animate-spin')].some(visible)) return true
    return [...document.querySelectorAll('input,textarea,select')].some(element => dirty.has(element) && visible(element))
  }
  const attempt = () => {
    timer = undefined
    if (!pending || disposed || reloaded) return
    if (blocked() || Date.now() - lastInteraction < quietMilliseconds) {
      timer = setTimeout(attempt, Math.min(500, quietMilliseconds))
      return
    }
    reloaded = true
    pending = false
    reload()
  }
  const interaction = (event: Event) => {
    lastInteraction = Date.now()
    const field = event.target
    if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement || field instanceof HTMLSelectElement)) return
    if (event.type !== 'input' && event.type !== 'change') return
    if (field.disabled || ('readOnly' in field && field.readOnly)) return
    const searchable = (field instanceof HTMLInputElement && field.type === 'search') ||
      /^search(?:\b|[_-])/i.test(field.getAttribute('name') || field.getAttribute('placeholder') || field.getAttribute('aria-label') || '')
    if (searchable) return
    if (field.value) dirty.add(field)
    else dirty.delete(field)
  }
  const reset = (event: Event) => {
    lastInteraction = Date.now()
    const form = event.target
    queueMicrotask(() => {
      if (!event.defaultPrevented && form instanceof HTMLFormElement) {
        for (const field of form.querySelectorAll('input,textarea,select')) dirty.delete(field)
      }
    })
  }
  for (const event of ['input', 'change', 'keydown', 'pointerdown']) document.addEventListener(event, interaction, true)
  document.addEventListener('reset', reset, true)
  navigator.serviceWorker?.addEventListener('controllerchange', reportBuild)
  reportBuild()

  const requestReload = () => {
    if (reloaded || disposed) return
    pending = true
    reportBuild()
    if (!timer) timer = setTimeout(attempt, quietMilliseconds)
  }
  requestReload.dispose = () => {
    disposed = true
    if (timer) clearTimeout(timer)
    for (const event of ['input', 'change', 'keydown', 'pointerdown']) document.removeEventListener(event, interaction, true)
    document.removeEventListener('reset', reset, true)
    navigator.serviceWorker?.removeEventListener('controllerchange', reportBuild)
  }
  return requestReload
}

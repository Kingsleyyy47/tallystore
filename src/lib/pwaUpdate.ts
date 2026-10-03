type UpdateCallback = () => Promise<void>

let pendingUpdate: UpdateCallback | null = null
const listeners = new Set<(update: UpdateCallback) => void>()

export function notifyPwaUpdate(update: UpdateCallback) {
  pendingUpdate = update
  listeners.forEach((listener) => listener(update))
}

export function subscribePwaUpdate(listener: (update: UpdateCallback) => void) {
  listeners.add(listener)
  if (pendingUpdate) listener(pendingUpdate)
  return () => { listeners.delete(listener) }
}

export function clearPwaUpdate() {
  pendingUpdate = null
}

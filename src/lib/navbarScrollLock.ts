/** Keep a viewport drawer stationary on mobile, including browsers where overflow
 * alone does not lock page scrolling. The dialog handles overflow and focus. */
export function lockNavbarScroll(document: Document, window: Window): () => void {
  const { style } = document.body
  const properties = ['position', 'top', 'left', 'width'] as const
  const previous = properties.map(property => [property, style[property]] as const)
  const x = window.scrollX
  const y = window.scrollY
  style.position = 'fixed'
  style.top = `${-y}px`
  style.left = `${-x}px`
  style.width = '100%'
  let restored = false
  return () => {
    if (restored) return
    restored = true
    for (const [property, value] of previous) style[property] = value
    const originalBehavior = document.documentElement.style.scrollBehavior
    document.documentElement.style.scrollBehavior = 'auto'
    window.scrollTo(x, y)
    document.documentElement.style.scrollBehavior = originalBehavior
  }
}

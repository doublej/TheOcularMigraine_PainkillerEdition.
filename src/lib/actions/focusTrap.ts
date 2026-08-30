/**
 * Keeps Tab inside one overlay and puts focus back where it came from on close.
 *
 * A modal that does not do this leaves the whole page behind it reachable by keyboard: on a
 * headset, where the pointer is a controller ray and Tab is how a paired keyboard moves, that
 * means tabbing straight into controls the overlay is covering.
 */
const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

export function focusTrap(node: HTMLElement, onescape?: () => void) {
  const returnTo = document.activeElement as HTMLElement | null

  const targets = () =>
    [...node.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(el => el.offsetParent !== null)

  // Deferred: the overlay's own children mount in the same tick this action runs.
  queueMicrotask(() => (targets()[0] ?? node).focus())

  function onKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      onescape?.()
      return
    }
    if (event.key !== 'Tab') return
    const items = targets()
    if (items.length === 0) return
    const first = items[0]
    const last = items[items.length - 1]
    const active = document.activeElement
    // Wrapping by hand, because the browser would otherwise step out of the overlay entirely.
    if (event.shiftKey && (active === first || !node.contains(active))) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && active === last) {
      event.preventDefault()
      first.focus()
    }
  }

  node.addEventListener('keydown', onKeydown)

  return {
    destroy() {
      node.removeEventListener('keydown', onKeydown)
      returnTo?.focus?.()
    },
  }
}

/**
 * Every user-facing string, and the source of truth for the key type.
 *
 * `as const` is what makes the keys and the interpolation slots checkable: a misspelled key is a
 * type error, and so is a missing or extra `{placeholder}` at the call site.
 */
export const en = {
  'conn.reconnecting': 'Reconnecting…',
  'conn.computer.ok': 'Via computer — connected',
  'conn.computer.down': 'The helper is not answering, so nothing reaches the headset. Tap to retry.',
  'conn.demo': 'Demo — no headset attached. Tap to retry.',
  'conn.toast.ok': 'Connected to the headset through your computer',
  'conn.toast.down': 'Still not connected — nothing is reaching a headset',

  'bridge.offline': 'The helper is not running, so nothing was sent to the headset',
  'bridge.refused': 'The helper refused the request (HTTP {status}), so nothing was sent to the headset',
} as const

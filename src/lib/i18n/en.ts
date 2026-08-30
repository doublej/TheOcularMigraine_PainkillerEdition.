/**
 * Every user-facing string, and the source of truth for the key type.
 *
 * `as const` is what makes the keys and the interpolation slots checkable: a misspelled key is a
 * type error, and so is a missing or extra `{placeholder}` at the call site.
 */
export const en = {
  // --- The connection bar. On the headset it reports privilege, not transport: an install that
  // reaches the headset and still cannot change it is the state users were never being told about.
  'conn.reconnecting': 'Reconnecting…',
  'conn.headset.locked': 'Settings locked — Tune and Recording cannot change the headset yet. Tap to unlock.',
  'conn.headset.dropped': 'The unlock dropped — settings are locked again. Tap to reconnect.',
  'conn.toast.unlocked': 'Unlocked — every setting can now reach the headset',
  'conn.toast.locked': 'Still locked — nothing here can change the headset yet',

  // Developer routes. Users never see these: the app ships to the headset.
  'conn.computer.ok': 'Via computer — connected',
  'conn.computer.down': 'The helper is not answering, so nothing reaches the headset. Tap to retry.',
  'conn.offline': 'Not connected — nothing reaches a headset. Tap to retry.',
  'conn.toast.ok': 'Connected to the headset through your computer',
  'conn.toast.down': 'Still not connected — nothing is reaching a headset',

  // --- Wizard ---
  'setup.title': 'Set up',
  'setup.close': 'Close',
  'setup.back': 'Back',
  'setup.next': 'Next',
  'setup.done': 'Done',
  'setup.step': 'Step {n} of 4',
  'setup.nav.works': 'Works now',
  'setup.nav.unlock': 'Unlock',
  'setup.nav.check': 'Check',
  'setup.nav.done': 'Done',

  'setup.works.heading': 'What works now',
  'setup.works.body': 'Asked the headset just now, not assumed. Most of the app needs no setup at all.',

  'setup.unlock.heading': 'Unlock the settings',
  'setup.unlock.body': 'Changing performance and recording settings is the one thing Android will not let an ordinary app do. Those go through system properties, and only the adb shell user may write them — so the app has to borrow that account from the headset itself.',
  'setup.unlock.lead': 'You need a computer for this, once:',
  'setup.unlock.step1': 'Plug the headset into a computer that has ADB installed.',
  'setup.unlock.step2': 'On that computer, run: adb tcpip 5555',
  'setup.unlock.step3': 'Tap Unlock below, then tick “Always allow” on the prompt that appears in the headset.',
  'setup.unlock.button': 'Unlock',
  'setup.unlock.working': 'Asking the headset…',
  'setup.unlock.caveat': 'While port 5555 is open, anything on your network can reach a shell on this headset. It is gated by the key you just approved, but close it when you are done: run adb usb on the computer, or restart the headset.',
  'setup.unlock.reboot': 'Restarting the headset closes the port, so this needs doing again after one. The app will say so rather than pretending.',
  'setup.unlock.patch': 'This headset’s security patch is older than 2026-05-01, which is the fix for a known adb flaw. Update it before leaving the port open.',

  // One line per state the channel can actually detect. Nothing here is a guess.
  'setup.state.DEV_MODE_OFF': 'USB debugging is switched off on the headset. Turn on Developer Mode in the Meta Horizon app first.',
  'setup.state.NO_PORT': 'Nothing is listening on port 5555 yet. Run adb tcpip 5555 on the computer, then tap Unlock again.',
  'setup.state.PORT_OPEN_UNAUTHORIZED': 'The headset answered but refused this app. Tap Unlock again to offer its key.',
  'setup.state.AWAITING_USER': 'Look in the headset — it is asking whether to allow debugging. Tick “Always allow”, then tap Unlock again.',
  'setup.state.REJECTED_OR_IGNORED': 'No answer came back. The prompt was declined, or it never appeared. Tap Unlock to try again.',
  'setup.state.CONNECTED': 'Unlocked. Every setting can reach the headset until it restarts.',
  'setup.state.DROPPED': 'The connection closed. Nothing can change the headset until you unlock again.',
  'setup.state.UNSUPPORTED': 'This headset cannot be unlocked this way.',

  'setup.check.heading': 'Check',
  'setup.check.body': 'The app writes one scratch setting and reads it back, so this is what the headset actually allowed — not what it was told.',
  'setup.check.again': 'Check again',
  'setup.check.checking': 'Asking the headset…',
  'setup.check.skip': 'You can carry on either way. This only tells you what to expect.',

  'setup.done.heading': 'That’s it',
  'setup.done.body': 'Anything the headset will not allow is switched off rather than left to fail on tap, and the bar at the bottom of the screen says which. Open this again any time by tapping that bar.',

  'caps.can': 'Works',
  'caps.cannot': 'Does not work',

  'bridge.offline': 'The helper is not running, so nothing was sent to the headset',
  'bridge.refused': 'The helper refused the request (HTTP {status}), so nothing was sent to the headset',
} as const

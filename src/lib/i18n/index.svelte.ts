/**
 * Hand-rolled localization, because the two hard requirements come free at this size.
 *
 * Compile-time key safety comes from `as const` plus `keyof`; reactivity comes from a module-level
 * `$state` locale, the same convention the device and navigation stores already use; and the
 * interpolation slots are read out of the English string by a template-literal type, so a missing
 * or extra placeholder is a type error rather than a `{name}` left showing in the UI.
 *
 * Reactivity has one rule: call `t()` from markup or from a `$derived`. A plain `const line =
 * t('…')` in a component's instance script is evaluated once and will not follow a locale change.
 *
 * Every locale ships statically. In an offline WebView the bundle is already on disk, so lazy
 * loading buys nothing and adds an async boundary before first paint.
 */
import { en } from './en'

const LOCALES = { en } as const

export type Locale = keyof typeof LOCALES
export type Messages = typeof en
export type Key = keyof Messages

/** Placeholder names read straight out of the English string: 'a {x} and {y}' -> 'x' | 'y'. */
type Slots<S extends string> = S extends `${string}{${infer Name}}${infer Rest}`
  ? Name | Slots<Rest>
  : never

type Values<K extends Key> = Record<Slots<Messages[K]>, string | number>

/**
 * The keys that take no placeholder. A lookup table of keys must be typed with this rather than
 * `Key`, because a union that mixes plain and interpolated keys makes `t()` demand the values
 * argument for every member of it.
 */
export type PlainKey = { [K in Key]: [Slots<Messages[K]>] extends [never] ? K : never }[Key]

let locale = $state<Locale>('en')

export function getLocale(): Locale {
  return locale
}

export function setLocale(next: Locale): void {
  locale = next
}

/** The values argument exists only for keys that actually have placeholders, and is required when they do. */
export function t<K extends Key>(
  key: K,
  ...values: [Slots<Messages[K]>] extends [never] ? [] : [Values<K>]
): string {
  const table: Messages = LOCALES[locale]
  // A locale with a key missing falls back to English rather than rendering the key itself.
  const template: string = table[key] ?? en[key]
  const fill = values[0] as Record<string, string | number> | undefined
  if (!fill) return template
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in fill ? String(fill[name]) : whole,
  )
}

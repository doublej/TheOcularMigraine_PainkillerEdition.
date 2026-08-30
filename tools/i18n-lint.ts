/**
 * Fails on a bare string literal in Svelte markup, so copy cannot creep back in outside en.ts.
 *
 * Deliberately dumb: it reads the markup half of each .svelte file, strips what is not visible
 * text (tags, expressions, comments, style and script blocks), and reports whatever letters are
 * left. Run it with `bun tools/i18n-lint.ts`; the count must fall with every migration phase.
 */
import { Glob } from 'bun'

const glob = new Glob('src/**/*.svelte')
let total = 0

for await (const file of glob.scan('.')) {
  const source = await Bun.file(file).text()
  let markup = source
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')

  // Innermost-first until it stops changing. A single pass only strips non-nested braces, so
  // `{t('key', { n: 1 })}` left `{t('key', )}` behind and every interpolated call was reported as
  // bare copy. That is worse than a plain false positive: it pushes you away from interpolation,
  // which is the one construct that keeps a whole sentence translatable.
  let previous = ''
  while (markup !== previous) {
    previous = markup
    markup = markup.replace(/\{[^{}]*\}/g, '')
  }
  markup = markup.replace(/<[^>]*>/g, '\n')

  const hits = markup
    .split('\n')
    .map(line => line.trim())
    // Two letters in a row is prose; a bare `×`, `▲` or a number is not.
    .filter(line => /[A-Za-z]{2}/.test(line))

  if (hits.length) {
    total += hits.length
    console.log(`${file}: ${hits.length}`)
    for (const hit of hits) console.log(`  ${hit.slice(0, 100)}`)
  }
}

console.log(`\n${total} bare strings in markup`)
process.exit(0)

const PORT = 7437
const WINDOWS_HOST = 'user@192.168.178.197'

// This endpoint runs arbitrary commands over ssh, so it is reachable from this machine only,
// and only pages served by the Vite dev server may talk to it.
const ALLOWED_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173']

// Windows and posix paths with spaces, and nothing a shell reads as syntax.
const APK_PATH = /^[A-Za-z0-9 _./\\:-]+\.apk$/i

// adb serials are alphanumeric; a network target adds a colon and dots.
const SERIAL = /^[A-Za-z0-9._:-]+$/

function corsHeadersFor(req: Request): Record<string, string> {
  const origin = req.headers.get('origin')
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  }
  if (origin && ALLOWED_ORIGINS.includes(origin)) headers['Access-Control-Allow-Origin'] = origin
  return headers
}

/**
 * Both POST routes execute commands, so neither may be reachable as a CORS-simple request:
 * an Origin that is missing or off the allowlist is refused before any work happens, and
 * requiring a JSON body forces a preflight that a page on another origin cannot pass.
 * A browser always sends Origin on POST, so a curl against this bridge must set it too.
 */
function denyReason(req: Request): string | null {
  const origin = req.headers.get('origin')
  if (!origin || !ALLOWED_ORIGINS.includes(origin)) return `origin not allowed: ${origin ?? '(none)'}`
  const contentType = req.headers.get('content-type') ?? ''
  if (!contentType.startsWith('application/json')) return 'expected Content-Type: application/json'
  return null
}

async function ssh(command: string) {
  const proc = Bun.spawn(['ssh', WINDOWS_HOST, command], { stdout: 'pipe', stderr: 'pipe' })
  const [output, error] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  const exitCode = await proc.exited
  return { output, error, exitCode }
}

// ponytail: resolved once per process — restart the bridge after swapping headsets.
let serialArg: string | null = null

async function resolveSerialArg(): Promise<string> {
  if (serialArg !== null) return serialArg
  const { output } = await ssh('adb devices -l')
  const rows = output.split('\n').slice(1)
    .map(line => line.trim())
    .filter(line => line && /\sdevice\b/.test(line))
  const target = rows.find(line => /quest/i.test(line)) ?? rows[0]
  const serial = target?.split(/\s+/)[0]
  serialArg = rows.length > 1 && serial && SERIAL.test(serial) ? `-s ${serial} ` : ''
  return serialArg
}

/**
 * ssh always hands its command line to a shell on the remote host, so nothing from the app may
 * reach that line as shell syntax. The command travels as base64 — an alphabet of A-Za-z0-9+/=
 * with no metacharacter in it — and the headset's own sh decodes and parses it. `;` `|` `&`
 * `$(...)` backticks, newlines and backslashes therefore cannot appear on the host command line
 * at all, escaped or otherwise, while the command still means on the headset exactly what the
 * user typed. The pipeline's exit status is sh's, so the headset's exit code still comes back.
 */
async function adbShell(command: string) {
  const payload = Buffer.from(command, 'utf8').toString('base64')
  return ssh(`adb ${await resolveSerialArg()}shell "echo ${payload} | base64 -d | sh"`)
}

Bun.serve({
  port: PORT,
  hostname: '127.0.0.1',
  async fetch(req) {
    const url = new URL(req.url)
    const corsHeaders = corsHeadersFor(req)
    const json = (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), {
        status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })

    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders })
    }

    if (url.pathname === '/ping') {
      return json({ ok: true })
    }

    if (url.pathname === '/shell' && req.method === 'POST') {
      const denied = denyReason(req)
      if (denied) return json({ error: denied, exitCode: 1 }, 403)
      const { command } = (await req.json()) as { command?: unknown }
      if (typeof command !== 'string' || !command) return json({ error: 'missing command', exitCode: 1 }, 400)
      return json(await adbShell(command))
    }

    if (url.pathname === '/install' && req.method === 'POST') {
      const denied = denyReason(req)
      if (denied) return json({ error: denied, exitCode: 1 }, 403)
      const { path } = (await req.json()) as { path?: unknown }
      if (typeof path !== 'string' || !path) return json({ error: 'missing path', exitCode: 1 }, 400)
      // The path lands inside a double-quoted host shell string. This alphabet holds no
      // metacharacter, and the required .apk suffix means it can never end in the backslash
      // that would otherwise escape the closing quote.
      if (!APK_PATH.test(path)) {
        return json({ error: 'path must be an .apk with no shell characters in it', exitCode: 1 }, 400)
      }
      const result = await ssh(`adb ${await resolveSerialArg()}install -r "${path}"`)
      return json(result)
    }

    return json({ error: 'not found', exitCode: 1 }, 404)
  },
})

console.log(`ADB proxy listening on http://127.0.0.1:${PORT}`)

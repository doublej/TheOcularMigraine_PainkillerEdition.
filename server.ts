const PORT = 7437
const WINDOWS_HOST = 'user@192.168.178.197'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
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

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url)

    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders })
    }

    if (url.pathname === '/ping') {
      return json({ ok: true })
    }

    if (url.pathname === '/shell' && req.method === 'POST') {
      const { command } = (await req.json()) as { command: string }
      if (!command) return json({ error: 'missing command' }, 400)
      const result = await ssh(`adb shell ${command}`)
      return json(result)
    }

    if (url.pathname === '/install' && req.method === 'POST') {
      const { path } = (await req.json()) as { path: string }
      if (!path) return json({ error: 'missing path' }, 400)
      const result = await ssh(`adb install -r "${path}"`)
      return json(result)
    }

    return json({ error: 'not found' }, 404)
  },
})

console.log(`ADB proxy listening on http://localhost:${PORT}`)

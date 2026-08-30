<script lang="ts">
  import { base } from '$app/paths'
  import { obliterate } from 'orphan-obliterator'
  import { onMount } from 'svelte'
  import Terminal from '$lib/components/Terminal.svelte'

  type Line = { cmd?: string; out?: string }

  const blocks: { id: string; title: string; body: string; lines: Line[] }[] = [
    {
      id: 'performance',
      title: 'Clocks and foveation',
      body:
        'CPU and GPU levels are the two dials that decide whether a busy scene holds its frame rate, and how hot and short the battery gets doing it. Each can be fixed or dynamic; dynamic turns the level into a ceiling the runtime moves under rather than a set point. Fixed foveated rendering softens the outer picture to hand the GPU back to the middle of the view.',
      lines: [
        { cmd: 'setprop debug.oculus.cpuLevel 3' },
        { cmd: 'setprop debug.oculus.gpuLevel 4' },
        { cmd: 'setprop debug.oculus.adaclocks.gpuDynamic 1' },
        { cmd: 'setprop debug.oculus.ffrLevel 2' },
        { out: 'CPU fixed at 3 · GPU capped at 4 · foveation 2' },
      ],
    },
    {
      id: 'display',
      title: 'Resolution and refresh rate',
      body:
        'Resolution is written per eye. The rungs are multiples of the panel the headset reports, not literal numbers, so "sharper" means the same thing on a Quest 2 and a Quest 3 and always keeps the right aspect. Refresh rates come from the display itself: setprop accepts an unsupported value without complaining and then quietly ignores it, so guessing from the model name is how people end up thinking a setting did nothing.',
      lines: [
        { cmd: 'setprop debug.oculus.textureWidth 2376' },
        { cmd: 'setprop debug.oculus.textureHeight 2560' },
        { cmd: 'setprop debug.oculus.refreshRate 120' },
        { out: '2376 x 2560 per eye · 115% of native · 120 Hz' },
      ],
    },
    {
      id: 'recording',
      title: 'Recording',
      body:
        'The built-in capture is fixed at whatever Meta chose. This is the same capture with the numbers exposed: bitrate, size, frame rate, which eye is recorded, and how much of the field of view to keep. Recording both eyes gives a side-by-side file that nothing in the container declares as 3D, which is why it uploads as a squashed pair. One button writes a copy carrying the st3d box that says left-right, ready for YouTube VR. Nothing is re-encoded and the recording itself is never touched.',
      lines: [
        { cmd: 'setprop debug.oculus.capture.width 1920' },
        { cmd: 'setprop debug.oculus.capture.height 1080' },
        { cmd: 'setprop debug.oculus.capture.bitrate 25000000' },
        { cmd: 'setprop debug.oculus.capture.fps 60' },
        { cmd: 'setprop debug.oculus.screenCaptureEye 2' },
        { cmd: 'setprop debug.oculus.fovCrop.outward 15' },
        { out: 'side-by-side · 25 Mbps · 60 fps · 15% cropped outward' },
      ],
    },
    {
      id: 'profiles',
      title: 'Per-game profiles',
      body:
        'A profile is the whole set — clocks, foveation, resolution, refresh rate — saved against a package name. A watcher sees that package come to the foreground and writes its settings then and there, so a heavy sim and a light social app do not have to share one compromise. It needs usage access, which is granted once.',
      lines: [
        { cmd: 'am start -n com.beatgames.beatsaber/.MainActivity' },
        { out: 'profile "Beat Saber" applied' },
        { out: 'CPU 3 · GPU 4 · 120 Hz · 100% of native' },
      ],
    },
    {
      id: 'system',
      title: 'The rest of the toolbox',
      body:
        'Install APKs from the headset, pick an app for it to open after a restart, lock it to a single app (kiosk mode, on a headset provisioned for it), keep a blacklist or a whitelist of what can launch, share a folder over HTTP with optional uploads, and drop into a plain ADB console when you would rather type the command yourself.',
      lines: [
        { cmd: 'pm install -r /sdcard/Download/game.apk' },
        { out: 'Success' },
        { cmd: 'setprop persist.oculus.kiosk_mode 1' },
        { out: 'single app mode set — applies after a restart' },
      ],
    },
    {
      id: 'connection',
      title: 'How it reaches the headset',
      body:
        'The app is the ADB client. It talks to adbd on the headset it is installed on, over the loopback interface. A computer opens that port once with adb tcpip 5555; the app then writes persist.adb.tcp.port, which adbd reads at every boot, so the port comes back on its own and the cable never returns — a restart asks only for the headset\'s own approval prompt. That privilege is the whole reason it is a sideload: an app that can rewrite system properties is not something the Meta Horizon Store hands out. Until it is unlocked, every screen says so plainly instead of pretending a setting took.',
      lines: [
        { cmd: 'adb tcpip 5555' },
        { out: 'restarting in TCP mode port: 5555' },
        { cmd: 'setprop persist.adb.tcp.port 5555' },
        { out: 'the headset reopens it at every boot' },
        { cmd: 'getprop debug.oculus.tomProbe' },
        { out: 'ok — settings can reach the headset' },
      ],
    },
  ]

  onMount(() => {
    const instance = obliterate({
      selectors: ['p', '.block-body', '.lede'],
      rules: { minLastLineWords: 3, maxProtectedChars: 40 },
    })
    return () => instance.destroy()
  })
</script>

<svelte:head>
  <title>Features — The Ocular Migraine</title>
  <meta
    name="description"
    content="Every screen in The Ocular Migraine is a wrapper over one group of debug.oculus.* properties. Here are the commands it runs."
  />
</svelte:head>

<main>
  <section class="intro">
    <div class="container">
      <h1>Features</h1>
      <p class="lede">
        Every screen in the app is a thin, honest wrapper over one group of
        <code>debug.oculus.*</code> properties. These are the commands it runs.
      </p>
    </div>
  </section>

  {#each blocks as block, i}
    <section class="block" class:alt={i % 2 === 1} id={block.id}>
      <div class="container">
        <h2>{block.title}</h2>
        <p class="block-body">{block.body}</p>
        <Terminal variant="green" maxWidth="760px">
          {#each block.lines as line}
            {#if line.cmd}
              <div><span class="tg-prompt">$</span><span class="tg-bright">{line.cmd}</span></div>
            {:else}
              <div><span class="tg-dim">{line.out}</span></div>
            {/if}
          {/each}
        </Terminal>
      </div>
    </section>
  {/each}

  <section class="compare">
    <div class="container">
      <h2>Changing one setting, three ways</h2>
      <table class="compare-table">
        <thead>
          <tr>
            <th>&nbsp;</th>
            <th>This app</th>
            <th>ADB from a PC</th>
            <th>Quest settings</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Needs a computer</td>
            <td>Once, to unlock</td>
            <td>Yes, every time</td>
            <td>No</td>
          </tr>
          <tr>
            <td>Render resolution</td>
            <td>Per eye, any value</td>
            <td>Per eye, any value</td>
            <td>Not exposed</td>
          </tr>
          <tr>
            <td>CPU / GPU levels</td>
            <td>0–5, fixed or dynamic</td>
            <td>0–5, fixed or dynamic</td>
            <td>Not exposed</td>
          </tr>
          <tr>
            <td>Recording bitrate</td>
            <td>Yours</td>
            <td>Yours</td>
            <td>Fixed</td>
          </tr>
          <tr>
            <td>Per-game presets</td>
            <td>Saved and auto-applied</td>
            <td>A script you write</td>
            <td>No</td>
          </tr>
          <tr>
            <td>Survives a reboot</td>
            <td>Port reopens itself, approve one prompt</td>
            <td>Re-authorise each boot</td>
            <td>n/a</td>
          </tr>
        </tbody>
      </table>
      <p class="compare-note">
        Nothing here is unique to this app — it is the same ADB surface petermg mapped out. The
        difference is that it is in the headset, in front of you, with the values named.
      </p>
    </div>
  </section>

  <section class="credit-strip">
    <div class="container">
      <p>
        Concept, feature design and all the ADB research by
        <a href="https://github.com/petermg/TheOcularMigraineMCP" target="_blank" rel="noopener noreferrer">petermg</a>.
        This fork rebuilt the interface and most of the feature set; the README says what is not ported. <a href="{base}/">Back to the start &rarr;</a>
      </p>
    </div>
  </section>
</main>

<style>
  .container {
    max-width: var(--container-max-width);
    margin: 0 auto;
    padding: 0 var(--container-padding);
  }

  section {
    padding: var(--section-padding) 0;
  }

  .intro {
    text-align: center;
    animation: fadeSlideUp 0.5s ease-out forwards;
  }
  h1 {
    font-size: 2.4rem;
    font-weight: 600;
    letter-spacing: -0.03em;
    margin-bottom: 1rem;
  }
  .lede {
    font-size: 1.15rem;
    color: var(--text-secondary);
    max-width: 640px;
    margin: 0 auto;
  }

  .block.alt {
    background: var(--bg-secondary);
    border-top: 1px solid var(--border);
    border-bottom: 1px solid var(--border);
  }
  .block h2 {
    font-size: 1.6rem;
    font-weight: 600;
    margin-bottom: 0.75rem;
  }
  .block-body {
    color: var(--text-secondary);
    max-width: 760px;
    margin-bottom: 1.75rem;
  }

  .compare h2 {
    font-size: 1.6rem;
    font-weight: 600;
    margin-bottom: 1.5rem;
  }
  .compare-note {
    margin-top: 1.25rem;
    font-size: 0.9rem;
    color: var(--text-tertiary);
    max-width: 720px;
  }

  .credit-strip {
    background: var(--accent-subtle);
    border-top: 1px solid var(--border);
    text-align: center;
  }
  .credit-strip p {
    color: var(--text-secondary);
    max-width: 720px;
    margin: 0 auto;
  }
  .credit-strip a {
    color: var(--accent);
  }

  @media (max-width: 700px) {
    h1 {
      font-size: 1.9rem;
    }
    .compare {
      overflow-x: auto;
    }
  }
</style>

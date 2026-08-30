<script lang="ts">
  import { base } from '$app/paths'
  import { obliterate } from 'orphan-obliterator'
  import { onMount } from 'svelte'
  import Terminal from '$lib/components/Terminal.svelte'
  import Mark from '$lib/components/Mark.svelte'

  type Mode = 'install' | 'build' | 'source'
  let mode = $state<Mode>('install')
  let copied = $state(false)
  let step = $state(0)

  type Line = { cmd?: string; out?: string }

  // Every frame is a real property this app writes. Nothing here is illustrative:
  // these are the exact setprop calls behind the controls on each screen.
  const steps: { title: string; description: string; lines: Line[] }[] = [
    {
      title: 'Ask the headset what it is',
      description:
        'Nothing is assumed from the model name. The panel size, the rate list and every default come from the headset itself.',
      lines: [
        { cmd: 'getprop ro.product.model' },
        { out: 'Quest 3' },
        { cmd: 'dumpsys display | grep fps' },
        { out: '72.0 90.0 120.0' },
      ],
    },
    {
      title: 'Move the clocks',
      description:
        'CPU and GPU levels are the two dials that decide whether a busy scene holds frame rate — and how hot and short the battery gets.',
      lines: [
        { cmd: 'setprop debug.oculus.cpuLevel 3' },
        { cmd: 'setprop debug.oculus.gpuLevel 4' },
        { cmd: 'setprop debug.oculus.adaclocks.cpuDynamic 0' },
        { out: 'CPU 3 · GPU 4 · fixed, not a ceiling' },
      ],
    },
    {
      title: 'Change what the eyes actually render',
      description:
        'Resolution is set per eye as a multiple of the detected panel, so a rung means the same thing on every headset.',
      lines: [
        { cmd: 'setprop debug.oculus.textureWidth 2376' },
        { cmd: 'setprop debug.oculus.textureHeight 2560' },
        { out: '115% of native · takes effect on next launch' },
      ],
    },
    {
      title: 'Pick a refresh rate the headset admits to',
      description:
        'The list is read off the display, not guessed from a lookup table — an unsupported value is accepted silently by setprop and then quietly ignored.',
      lines: [
        { cmd: 'setprop debug.oculus.refreshRate 90' },
        { cmd: 'setprop debug.oculus.ffrLevel 2' },
        { out: '90 Hz · foveation 2 — softer edges, more GPU for the middle' },
      ],
    },
    {
      title: 'Record on your terms',
      description:
        'Bitrate, size, frame rate, which eye, and how much of the field of view to keep. Stereo audio on Quest 2 and 3.',
      lines: [
        { cmd: 'setprop debug.oculus.capture.width 1920' },
        { cmd: 'setprop debug.oculus.capture.height 1080' },
        { cmd: 'setprop debug.oculus.capture.bitrate 25000000' },
        { cmd: 'setprop debug.oculus.capture.fps 60' },
        { cmd: 'setprop debug.oculus.screenCaptureEye 2' },
        { out: 'side-by-side · 25 Mbps · 60 fps' },
      ],
    },
    {
      title: 'Save it against a game',
      description:
        'A profile is the whole set above, tied to a package name. Launch the game and the app puts its settings back before the first frame.',
      lines: [
        { cmd: 'am start -n com.beatgames.beatsaber/.MainActivity' },
        { out: 'profile "Beat Saber" applied — CPU 3 · GPU 4 · 120 Hz · 100%' },
      ],
    },
  ]

  const display_map: Record<Mode, string> = {
    install: 'adb install -r app-debug.apk',
    build: 'bun run apk:debug',
    source: 'git clone https://github.com/doublej/TheOcularMigraineMCP',
  }

  const features = [
    {
      icon: '◐',
      title: 'Runs on the headset',
      description:
        'The app is the ADB client. It talks to the headset it is installed on, so there is no PC, no cable and no second machine in the loop.',
    },
    {
      icon: '⌁',
      title: 'Clocks and foveation',
      description:
        'CPU and GPU levels 0–5, fixed foveated rendering 0–4, each fixed or dynamic. Dynamic makes the level a ceiling rather than a set point.',
    },
    {
      icon: '▣',
      title: 'Resolution and refresh',
      description:
        'Per-eye resolution as a multiple of the real panel, plus every refresh rate the display actually reports. Custom values welcome.',
    },
    {
      icon: '⏺',
      title: 'Recording that is yours',
      description:
        'Bitrate, resolution, frame rate, recording eye and FOV crop. Inject 3D metadata so a side-by-side capture uploads to YouTube VR correctly.',
    },
    {
      icon: '⛯',
      title: 'Per-game profiles',
      description:
        'Save a whole set of settings against a package and have it applied when that game launches, the way Quest Games Optimizer does it.',
    },
    {
      icon: '⚙',
      title: 'The rest of the toolbox',
      description:
        'APK installs, kiosk mode, startup app, access control lists, a file-sharing web server and a plain ADB console when you want the raw thing.',
    },
  ]

  onMount(() => {
    const instance = obliterate({
      selectors: ['p', '.tagline', '.description', '.feature-card p', '.credit p'],
      rules: { minLastLineWords: 3, maxProtectedChars: 40 },
    })
    return () => instance.destroy()
  })

  function copyCommand() {
    navigator.clipboard.writeText(display_map[mode])
    copied = true
    setTimeout(() => (copied = false), 2000)
  }
</script>

<svelte:head>
  <title>The Ocular Migraine — tune your Quest from the headset</title>
  <meta
    name="description"
    content="Change resolution, CPU and GPU levels, foveation and recording settings on a Meta Quest, from inside the headset, with no PC in the loop."
  />
</svelte:head>

<main>
  <section class="hero">
    <div class="container">
      <div class="hero-mark"><Mark size={112} /></div>
      <h1>The Ocular Migraine</h1>
      <p class="edition"><span class="brace">&#123;</span>Painkiller Edition<span class="brace">&#125;</span></p>
      <p class="tagline">
        Change resolution, CPU and GPU levels, foveation and recording settings on a Meta Quest —
        from inside the headset, with no PC in the loop.
      </p>

      <div class="hero-actions">
        <div class="mode-toggle">
          <button class:active={mode === 'install'} onclick={() => (mode = 'install')}>Install</button>
          <button class:active={mode === 'build'} onclick={() => (mode = 'build')}>Build</button>
          <button class:active={mode === 'source'} onclick={() => (mode = 'source')}>Source</button>
        </div>
        <div class="command-box">
          <code>{display_map[mode]}</code>
          <button class="copy-btn" onclick={copyCommand}>{copied ? 'Copied' : 'Copy'}</button>
        </div>
      </div>

      <div class="hero-links">
        <a
          href="https://github.com/doublej/TheOcularMigraineMCP"
          target="_blank"
          rel="noopener noreferrer"
          class="hero-link">View on GitHub</a
        >
      </div>
    </div>
  </section>

  <section class="demo">
    <div class="container">
      <div class="demo-header">
        <div class="demo-header-text">
          <h2>{steps[step].title}</h2>
          <p class="description">{steps[step].description}</p>
        </div>
        <div class="demo-nav">
          <button class="nav-arrow" disabled={step === 0} onclick={() => step--}>&larr;</button>
          <span class="demo-count">{step + 1} / {steps.length}</span>
          <button class="nav-arrow" disabled={step === steps.length - 1} onclick={() => step++}
            >&rarr;</button
          >
        </div>
      </div>
      <Terminal variant="green">
        {#each steps[step].lines as line}
          {#if line.cmd}
            <div><span class="tg-prompt">$</span><span class="tg-bright">{line.cmd}</span></div>
          {:else}
            <div><span class="tg-dim">{line.out}</span></div>
          {/if}
        {/each}
      </Terminal>
      <p class="demo-note">
        Every control in the app is one of these properties. Nothing is invented: the console screen
        will run them for you if you would rather type.
      </p>
    </div>
  </section>

  <section class="features">
    <div class="container">
      <h2>What it does</h2>
      <div class="grid">
        {#each features as feature}
          <div class="feature-card">
            <div class="feature-icon">{feature.icon}</div>
            <h3>{feature.title}</h3>
            <p>{feature.description}</p>
          </div>
        {/each}
      </div>
      <div class="features-cta">
        <a href="{base}/features" class="features-link">See all features &rarr;</a>
      </div>
    </div>
  </section>

  <section class="credit">
    <div class="container">
      <div class="credit-card">
        <h2>This is petermg's app</h2>
        <p>
          The Ocular Migraine was created by
          <a href="https://github.com/petermg/TheOcularMigraineMCP" target="_blank" rel="noopener noreferrer">petermg</a>.
          The concept, the feature design, the ADB research and the exhaustive work of mapping every
          Quest setting to its <code>debug.oculus.*</code> property are all his. His original
          Tasker-based app does things no other Quest tool bothers to do.
        </p>
        <p>
          This is a fork that rebuilt the interface in Svelte 5 and Capacitor. The feature set is
          identical — the only thing that changed is what it looks like. The mark above is an homage
          to his banner art, not a replacement for it: his vesica eye and his blazing core, with the
          sunburst redrawn as a fortification spectrum.
        </p>
        <p class="credit-links">
          <a href="https://github.com/petermg/TheOcularMigraineMCP" target="_blank" rel="noopener noreferrer"
            >The original project &rarr;</a
          >
        </p>
      </div>
    </div>
  </section>

  <section class="cta">
    <div class="container">
      <h2>Get it on the headset</h2>
      <pre class="cta-install"><code>{display_map.install}</code></pre>
      <p class="cta-note">
        Sideload only. It needs ADB privileges to change anything, which the Meta Horizon Store does
        not grant — see <a href="{base}/features">how it connects</a>.
      </p>
      <p>
        <a href="https://github.com/doublej/TheOcularMigraineMCP" target="_blank" rel="noopener noreferrer">GitHub</a>
        · GPL-3.0, same as the original
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

  .hero {
    text-align: center;
    animation: fadeSlideUp 0.5s ease-out forwards;
  }
  .hero-mark {
    display: flex;
    justify-content: center;
    margin-bottom: 1.5rem;
    color: var(--text-primary);
  }
  h1 {
    font-size: 2.6rem;
    font-weight: 600;
    letter-spacing: -0.03em;
    margin-bottom: 0.5rem;
  }
  .edition {
    font-family: 'DM Mono', monospace;
    font-size: 0.8rem;
    letter-spacing: 0.24em;
    text-transform: uppercase;
    color: var(--text-tertiary);
    margin-bottom: 1.25rem;
  }
  .brace {
    color: var(--accent);
  }
  .tagline {
    font-size: 1.15rem;
    color: var(--text-secondary);
    max-width: 640px;
    margin: 0 auto 2rem;
  }

  .hero-actions {
    max-width: 520px;
    margin: 0 auto 1.5rem;
  }
  .mode-toggle {
    display: inline-flex;
    gap: 4px;
    background: var(--accent-subtle);
    padding: 4px;
    border-radius: 10px;
    margin-bottom: 12px;
  }
  .mode-toggle button {
    border: none;
    background: transparent;
    font: inherit;
    font-size: 0.85rem;
    font-weight: 500;
    color: var(--text-secondary);
    padding: 6px 16px;
    border-radius: 7px;
    cursor: pointer;
    transition:
      background 0.15s,
      color 0.15s;
  }
  .mode-toggle button.active {
    background: var(--bg-secondary);
    color: var(--text-primary);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
  }

  .command-box {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    background: var(--bg-code);
    border-radius: 10px;
    padding: 14px 16px;
  }
  .command-box code {
    color: var(--text-code);
    font-size: 0.9rem;
  }
  .copy-btn {
    border: none;
    background: rgba(255, 255, 255, 0.1);
    color: #ddd;
    font: inherit;
    font-size: 0.8rem;
    padding: 6px 14px;
    border-radius: 6px;
    cursor: pointer;
    transition: background 0.15s;
  }
  .copy-btn:hover {
    background: rgba(255, 255, 255, 0.18);
  }

  .hero-link {
    color: var(--accent);
    text-decoration: none;
    font-weight: 500;
    font-size: 0.95rem;
  }
  .hero-link:hover {
    text-decoration: underline;
  }

  /* The arrows must not move between frames — the descriptions run two or three lines, and a
     control that slides out from under the cursor mid-click is how you end up clicking nothing.
     Wide: pinned to the top of the row, with the text block holding a constant height.
     Narrow: the pager goes above the title, where no amount of text can push it. */
  .demo-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    margin-bottom: 20px;
    gap: 16px;
  }

  .demo-header-text {
    min-height: 112px;
  }
  .demo-header h2 {
    font-size: 1.4rem;
    font-weight: 600;
  }
  .demo-nav {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-shrink: 0;
  }
  .nav-arrow {
    border: 1px solid var(--border);
    background: var(--bg-secondary);
    color: var(--text-primary);
    width: 36px;
    height: 36px;
    border-radius: 8px;
    cursor: pointer;
    font-size: 1rem;
  }
  .nav-arrow:disabled {
    opacity: 0.35;
    cursor: default;
  }
  .demo-count {
    font-family: 'DM Mono', monospace;
    font-size: 0.85rem;
    color: var(--text-tertiary);
  }
  .demo-note {
    max-width: 680px;
    margin: 1.25rem auto 0;
    text-align: center;
    font-size: 0.9rem;
    color: var(--text-tertiary);
  }

  .features h2,
  .cta h2,
  .credit h2 {
    font-size: 1.8rem;
    font-weight: 600;
    text-align: center;
    margin-bottom: 2rem;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: var(--grid-gap);
  }
  .feature-card {
    background: var(--bg-secondary);
    padding: 24px;
    border: 1px solid var(--border);
    border-radius: 12px;
  }
  .feature-icon {
    font-size: 1.5rem;
    margin-bottom: 12px;
    color: var(--accent);
  }
  .feature-card h3 {
    font-size: 1.05rem;
    font-weight: 600;
    margin-bottom: 8px;
  }
  .feature-card p {
    font-size: 0.95rem;
    color: var(--text-secondary);
  }
  .features-cta {
    text-align: center;
    margin-top: 2rem;
  }
  .features-link {
    color: var(--accent);
    text-decoration: none;
    font-weight: 500;
  }

  .credit-card {
    background: var(--accent-subtle);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 32px;
    max-width: 780px;
    margin: 0 auto;
  }
  .credit-card h2 {
    margin-bottom: 1rem;
  }
  .credit-card p {
    color: var(--text-secondary);
    margin-bottom: 1rem;
  }
  .credit-card a {
    color: var(--accent);
  }
  .credit-links {
    margin-bottom: 0;
    font-weight: 500;
  }

  .cta {
    text-align: center;
  }
  .cta-install {
    display: inline-block;
    background: var(--bg-code);
    color: var(--text-code);
    padding: 14px 20px;
    border-radius: 10px;
    margin-bottom: 1rem;
  }
  .cta-note {
    max-width: 520px;
    margin: 0 auto 1rem;
    font-size: 0.9rem;
    color: var(--text-tertiary);
  }
  .cta a {
    color: var(--accent);
    text-decoration: none;
  }

  @media (max-width: 1000px) {
    .grid {
      grid-template-columns: repeat(2, 1fr);
    }
  }
  @media (max-width: 700px) {
    .grid {
      grid-template-columns: 1fr;
    }
    h1 {
      font-size: 2rem;
    }
    .demo-header {
      flex-direction: column;
      align-items: flex-start;
    }
    .demo-nav {
      order: -1;
    }
    .demo-header-text {
      min-height: 0;
    }
  }
</style>

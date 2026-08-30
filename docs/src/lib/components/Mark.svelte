<!--
  The app's mark: petermg's vesica eye, with the sunburst in his iris redrawn as a
  fortification spectrum — the shape an ocular migraine aura actually takes. Same
  geometry as the launcher icon; the colours come from this page's tokens so it sits
  on a light ground here and a dark one in the app.
-->
<script lang="ts">
  let { size = 48 }: { size?: number } = $props()

  const eye = 'M 20 120 A 117.3 117.3 0 0 1 220 120 A 117.3 117.3 0 0 1 20 120'
  const iris =
    'M 120.0 74.0 L 127.0 84.7 L 137.6 77.5 L 140.0 90.1 L 152.5 87.5 L 149.9 100.0 L 162.5 102.4 L 155.3 113.0 L 166.0 120.0 L 155.3 127.0 L 162.5 137.6 L 149.9 140.0 L 152.5 152.5 L 140.0 149.9 L 137.6 162.5 L 127.0 155.3 L 120.0 166.0 L 113.0 155.3 L 102.4 162.5 L 100.0 149.9 L 87.5 152.5 L 90.1 140.0 L 77.5 137.6 L 84.7 127.0 L 74.0 120.0 L 84.7 113.0 L 77.5 102.4 L 90.1 100.0 L 87.5 87.5 L 100.0 90.1 L 102.4 77.5 L 113.0 84.7 Z'
</script>

<svg
  class="mark"
  width={size}
  height={(size * 132) / 220}
  viewBox="10 54 220 132"
  fill="none"
  aria-hidden="true"
>
  <path d={eye} stroke="currentColor" stroke-width="6" stroke-linejoin="round" />
  <path class="halo" d={iris} stroke="var(--accent)" stroke-width="16" stroke-linejoin="round" />
  <path class="glint" d={iris} stroke="var(--accent)" stroke-width="5" stroke-linejoin="round" />
  <circle cx="120" cy="120" r="13" fill="currentColor" />
</svg>

<style>
  /* The same 20-second scintillation the app runs: 16 teeth, so 22.5deg lands the star
     back on itself and the loop restart is invisible. */
  .mark {
    display: block;
  }

  .halo {
    opacity: 0.18;
    animation: swell 20s linear infinite, turn 20s linear infinite;
    transform-box: fill-box;
    transform-origin: center;
  }

  .glint {
    animation: turn 20s linear infinite;
    transform-box: fill-box;
    transform-origin: center;
  }

  @keyframes swell {
    0%,
    90% {
      opacity: 0.18;
      stroke-width: 16;
    }
    95% {
      opacity: 0.42;
      stroke-width: 24;
    }
    100% {
      opacity: 0.18;
      stroke-width: 16;
    }
  }

  @keyframes turn {
    0%,
    90% {
      transform: rotate(0deg);
    }
    100% {
      transform: rotate(22.5deg);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .halo,
    .glint {
      animation: none;
    }
  }
</style>

#!/usr/bin/env python3
"""Render every brand asset from the one drawing of the mark.

The mark is an homage to petermg's original banner: a vesica eye built from two arcs of
radius 117.3, an iris ring that scintillates the way a fortification spectrum does, and a
solid core where his sunburst blazed. It lives in a 240-unit square and is placed, scaled
and stroked per surface here — the launcher icons, the splash screens and the web favicon
are all this file, so a change to the mark changes all of them at once.

`android/` is not tracked, so these outputs are disposable; this script is the source.

    brew install librsvg          # provides rsvg-convert
    python3 tools/gen-icons.py    # writes android/app/src/main/res/** and public/favicon.svg

The in-app header draws its own copy in Header.svelte, with a plain ring instead of the
sawtooth: below about 40px the teeth turn to mush and the eye stops reading as an eye.
"""
import math
import pathlib
import subprocess
import sys

BG = "#1C1E22"
ACCENT = "#5B9EF4"
EYE = "#FFFFFF"

# Two arcs meeting at (20,120) and (220,120), 112 units tall — the eye from the original banner.
EYE_PATH = "M 20 120 A 117.3 117.3 0 0 1 220 120 A 117.3 117.3 0 0 1 20 120"
TEETH = 16


def iris_path(teeth: int, r_out: float = 46.0, r_in: float = 36.0) -> str:
    points = []
    for i in range(teeth * 2):
        angle = math.radians(-90 + i * 180.0 / teeth)
        r = r_out if i % 2 == 0 else r_in
        points.append(f"{120 + r * math.cos(angle):.1f} {120 + r * math.sin(angle):.1f}")
    return "M " + " L ".join(points) + " Z"


def mark(eye_w: float, iris_w: float, core: float) -> str:
    """The mark in 240-space. The iris is drawn twice: once wide and faint as its own glow."""
    iris = f'<path d="{iris_path(TEETH)}" fill="none" stroke="{ACCENT}" stroke-linejoin="round"'
    return (
        f'<path d="{EYE_PATH}" fill="none" stroke="{EYE}" stroke-width="{eye_w:.2f}" stroke-linejoin="round"/>'
        f'{iris} stroke-width="{iris_w * 3:.2f}" opacity="0.18"/>'
        f'{iris} stroke-width="{iris_w:.2f}"/>'
        f'<circle cx="120" cy="120" r="{core:.1f}" fill="{EYE}"/>'
    )


def place(eye_w_px: float, cx: float, cy: float) -> str:
    """Open a group that scales the 240-space mark to eye_w_px wide, centred on (cx, cy)."""
    s = eye_w_px / 200.0
    return f'<g transform="translate({cx - 120 * s:.2f} {cy - 120 * s:.2f}) scale({s:.4f})">'


def grid(w: int, h: int, step: int) -> str:
    """The blueprint grid from the original, at the opacity it should always have had."""
    lines = [f'<path d="M {x} 0 L {x} {h}"/>' for x in range(step, w, step)]
    lines += [f'<path d="M 0 {y} L {w} {y}"/>' for y in range(step, h, step)]
    return '<g stroke="#FFFFFF" stroke-width="1" opacity="0.035">' + "".join(lines) + "</g>"


def ground(w: int, h: int, step: int) -> str:
    return (
        '<defs><radialGradient id="g" cx="50%" cy="38%" r="70%">'
        f'<stop offset="0%" stop-color="#2F333A"/><stop offset="68%" stop-color="{BG}"/>'
        "</radialGradient></defs>"
        f'<rect width="{w}" height="{h}" fill="{BG}"/>'
        f'<rect width="{w}" height="{h}" fill="url(#g)"/>' + grid(w, h, step)
    )


def svg(w: int, h: int, body: str) -> str:
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" '
        f'viewBox="0 0 {w} {h}">{body}</svg>'
    )


def render(source: str, out: pathlib.Path, w: int, h: int) -> None:
    out.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        ["rsvg-convert", "-w", str(w), "-h", str(h), "-o", str(out)],
        input=source.encode(), check=True,
    )


def main() -> None:
    root = pathlib.Path(__file__).resolve().parent.parent
    res = root / "android/app/src/main/res"

    # Adaptive foreground: a 432 canvas whose content stays inside the 264px safe circle.
    foreground = svg(432, 432, place(248, 216, 216) + mark(4.0, 3.0, 14) + "</g>")
    for name, px in [("mdpi", 108), ("hdpi", 162), ("xhdpi", 216), ("xxhdpi", 324), ("xxxhdpi", 432)]:
        render(foreground, res / f"mipmap-{name}/ic_launcher_foreground.png", px, px)

    # Legacy square and round icons: the same mark, on the app's own ground.
    face = ground(432, 432, 36) + place(268, 216, 216) + mark(4.6, 3.4, 15) + "</g>"
    square = svg(432, 432, face)
    circle = svg(432, 432, '<defs><clipPath id="c"><circle cx="216" cy="216" r="216"/></clipPath></defs>'
                 f'<g clip-path="url(#c)">{face}</g>')
    for name, px in [("mdpi", 48), ("hdpi", 72), ("xhdpi", 96), ("xxhdpi", 144), ("xxxhdpi", 192)]:
        render(square, res / f"mipmap-{name}/ic_launcher.png", px, px)
        render(circle, res / f"mipmap-{name}/ic_launcher_round.png", px, px)

    # The adaptive background is a flat colour behind that foreground, so it is the app's ground.
    (res / "values/ic_launcher_background.xml").write_text(
        '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n'
        f'    <color name="ic_launcher_background">{BG}</color>\n</resources>\n'
    )

    # Splash screens. Capacitor picks one by orientation and density; all carry the same mark.
    splashes = [
        ("drawable", 480, 320), ("drawable-land-mdpi", 480, 320), ("drawable-land-hdpi", 800, 480),
        ("drawable-land-xhdpi", 1280, 720), ("drawable-land-xxhdpi", 1600, 960),
        ("drawable-land-xxxhdpi", 1920, 1280), ("drawable-port-mdpi", 320, 480),
        ("drawable-port-hdpi", 480, 800), ("drawable-port-xhdpi", 720, 1280),
        ("drawable-port-xxhdpi", 960, 1600), ("drawable-port-xxxhdpi", 1280, 1920),
    ]
    for folder, w, h in splashes:
        eye_w = min(w, h) * 0.42
        # Stroke widths are authored for the 200-unit eye, so undo the scale to keep them even.
        k = eye_w / 200.0
        body = ground(w, h, max(20, round(min(w, h) / 16))) + place(eye_w, w / 2, h / 2) \
            + mark(3.0 / k, 2.4 / k, 13) + "</g>"
        render(svg(w, h, body), res / folder / "splash.png", w, h)

    # The web build's tab icon. It carries its own ground: the eye is drawn in white, which
    # would vanish against a light browser chrome if the background were transparent.
    (root / "public/favicon.svg").write_text(
        svg(64, 64, f'<rect width="64" height="64" rx="12" fill="{BG}"/>'
            + place(52, 32, 32) + mark(4.6, 3.4, 15) + "</g>") + "\n"
    )

    print(f"wrote {len(splashes)} splash screens, 15 launcher icons and public/favicon.svg")


if __name__ == "__main__":
    sys.exit(main())

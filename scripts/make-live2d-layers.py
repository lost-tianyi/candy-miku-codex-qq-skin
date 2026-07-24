#!/usr/bin/env python3
"""Build seam-free Live2D-lite bases for Candy Miku pet states.

Each state is one full cutout on a shared 420×520 canvas (no hard layer splits).
Blink stays off; avatar-overlay inject only applies chest-pivot breath/sway.

Layout:
  sources/{idle,wave,thinking,working}.png  → input cutouts
  theme/miku-l2d-*.png                      → output canvases
  theme/theme.json / overlay-live2d.json    → synced metadata
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image

REPO = Path(__file__).resolve().parents[1]
THEME = REPO / "theme"
SOURCES = REPO / "sources"
CANVAS = (420, 520)
OUT_META = THEME / "overlay-live2d.json"
BUILD_STATES = ("idle", "wave", "thinking", "working")


def content_bbox(alpha: np.ndarray, thr: int = 16) -> tuple[int, int, int, int]:
    ys, xs = np.where(alpha > thr)
    if len(xs) == 0:
        raise RuntimeError("empty alpha")
    return int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())


def place_on_canvas(src: Image.Image) -> tuple[Image.Image, dict]:
    arr = np.asarray(src)
    x0, y0, x1, y1 = content_bbox(arr[..., 3])
    cropped = src.crop((x0, y0, x1 + 1, y1 + 1))
    cw, ch = CANVAS
    margin = 0.07
    max_w = int(cw * (1 - 2 * margin))
    max_h = int(ch * (1 - 2 * margin))
    scale = min(max_w / cropped.width, max_h / cropped.height)
    nw = max(1, int(round(cropped.width * scale)))
    nh = max(1, int(round(cropped.height * scale)))
    fitted = cropped.resize((nw, nh), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", CANVAS, (0, 0, 0, 0))
    x = (cw - nw) // 2
    y = ch - nh - int(ch * margin * 0.2)
    canvas.alpha_composite(fitted, (x, y))
    return canvas, {
        "chest_y": y + nh * 0.58,
    }


def load_source(state: str) -> Image.Image:
    path = SOURCES / f"{state}.png"
    if not path.exists():
        raise SystemExit(f"Missing source: {path}")
    print(f"  source[{state}]", path.name)
    return Image.open(path).convert("RGBA")


def layer_spec(image: str, pivot_y: float, z: int = 10) -> dict:
    return {
        "id": "base",
        "image": image,
        "z": z,
        "role": "base",
        "pivotX": 0.5,
        "pivotY": pivot_y,
    }


def build() -> dict:
    THEME.mkdir(parents=True, exist_ok=True)
    states: dict[str, dict] = {}

    for state in BUILD_STATES:
        print("build", state)
        src = load_source(state)
        canvas, meta = place_on_canvas(src)
        pivot_y = meta["chest_y"] / CANVAS[1]
        out_name = "miku-l2d-base.png" if state == "idle" else f"miku-l2d-{state}.png"
        canvas.save(THEME / out_name, optimize=True)
        if state == "idle":
            canvas.save(THEME / "miku-overlay-idle.png", optimize=True)
        states[state] = {"layers": [layer_spec(out_name, pivot_y)]}
        print(f"  wrote theme/{out_name} pivotY={pivot_y:.4f}")

    idle_layers = states["idle"]["layers"]
    config = {
        "width": CANVAS[0],
        "height": CANVAS[1],
        "defaultState": "idle",
        "layers": idle_layers,
        "states": states,
    }
    OUT_META.write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")

    theme_path = THEME / "theme.json"
    theme = json.loads(theme_path.read_text(encoding="utf-8"))
    theme["overlayPet"] = "miku-overlay-idle.png"
    theme["overlayLive2D"] = {
        "width": CANVAS[0],
        "height": CANVAS[1],
        "defaultState": "idle",
        "layers": idle_layers,
        "states": states,
    }
    theme_path.write_text(json.dumps(theme, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print("updated theme/theme.json +", OUT_META.name)
    return config


if __name__ == "__main__":
    build()

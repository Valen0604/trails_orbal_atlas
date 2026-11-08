#!/usr/bin/env python3
"""
Strip the baked-in place names (and the title / legend / disclaimer boxes) off the
Zemuria map so the site can draw its own crisp labels at every zoom level.

    python tools/clean_map_labels.py                       # assets/zemuria.png -> assets/zemuria_clean.png
    python tools/clean_map_labels.py in.png out.png marks.png

Also writes a "marks" image: the original with every changed pixel tinted magenta, so a
human touch-up pass knows exactly where to look.

How it works — tuned for flat vector-style art, not photos:
  1. text candidates = near-black pixels, grouped into connected blobs of glyph size
  2. a blob is text only if a good share of its outer ring is the white halo every label
     has (black islands, mountain hatching and borders have no halo, so they survive)
  3. the halo joins the mask: near-white pixels within a radius that grows with the
     letter height (big country titles have wide halos)
  4. every masked blob is refilled with the dominant colour of the ring around it
     (flat fills only — patch-based and diffusion inpainting both smear this kind of
     art), then the seams get a 3x3 blur
  5. the title block, legend and disclaimer rectangles are filled with the sea colour

Requires: pip install -r tools/requirements-tools.txt   (opencv-python-headless, numpy, pillow)
"""
import os
import sys

import cv2
import numpy as np
from PIL import Image

# rectangles to flatten to sea colour, as fractions of width/height (x0, y0, x1, y1)
SEA_BOXES = [
    (0.000, 0.805, 0.255, 1.000),   # "Map of Zemuria 2024 Edition / By NegativeNac" title block
    (0.835, 0.820, 1.000, 1.000),   # legend box
    (0.710, 0.865, 0.840, 1.000),   # disclaimer text
]
SEA_SAMPLE = (0.04, 0.70)           # a known open-sea point (x, y fractions)

DARK_MAX = 60        # a pixel is "ink" when all channels are below this
WHITE_MIN = 222      # a pixel is "halo" when all channels are above this
GLYPH_MAX_H = 84     # biggest letter height to consider (country titles)
GLYPH_MAX_W = 120
GLYPH_MIN_AREA = 6
HALO_SHARE = 0.22    # share of a blob's outer ring that must be halo for it to count as text


def blob_fill(img, mask):
    """Each masked blob takes the dominant colour of the unmasked ring around it.
    Right for flat art: a letter on snow refills as snow, a letter on pink as pink; a
    letter straddling two regions takes the bigger one (a faint ghost, for the touch-up)."""
    out = img.copy()
    H, W = mask.shape
    nb, blab, bstats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    k9 = np.ones((9, 9), np.uint8)
    for i in range(1, nb):
        x, y, w, h, area = bstats[i]
        y0, y1, x0, x1 = max(0, y - 6), min(H, y + h + 6), max(0, x - 6), min(W, x + w + 6)
        blob = (blab[y0:y1, x0:x1] == i).astype(np.uint8)
        ring = cv2.dilate(blob, k9) & (mask[y0:y1, x0:x1] == 0)
        px = img[y0:y1, x0:x1][ring == 1]
        if not len(px):
            continue
        q = (px // 16).astype(np.int32)                      # quantise so anti-aliased edge pixels never win
        keys = q[:, 0] * 256 + q[:, 1] * 16 + q[:, 2]
        k = np.bincount(keys).argmax()
        out[y0:y1, x0:x1][blob == 1] = px[keys == k].mean(axis=0).astype(np.uint8)
    return out


def main(src, dst, marks_path):
    img = np.array(Image.open(src).convert("RGB"))
    H, W = img.shape[:2]

    # --- 1-2: glyph-sized dark blobs with a white halo ------------------------------------
    dark = (img.max(axis=2) < DARK_MAX).astype(np.uint8)
    n, lab, stats, _ = cv2.connectedComponentsWithStats(dark, connectivity=8)
    white = (img.min(axis=2) > WHITE_MIN)
    mask = np.zeros_like(dark)
    kept = 0
    k3 = np.ones((3, 3), np.uint8)
    for i in range(1, n):
        x, y, w, h, area = stats[i]
        if not (GLYPH_MIN_AREA <= area and h <= GLYPH_MAX_H and w <= GLYPH_MAX_W):
            continue
        R = int(min(12, max(4, round(h * 0.2))))          # halo radius grows with the letter
        y0, y1, x0, x1 = max(0, y - R - 2), min(H, y + h + R + 2), max(0, x - R - 2), min(W, x + w + R + 2)
        blob = (lab[y0:y1, x0:x1] == i).astype(np.uint8)
        ring = cv2.dilate(blob, k3) - blob
        share = white[y0:y1, x0:x1][ring == 1].mean() if ring.any() else 0
        if share < HALO_SHARE:
            continue
        kept += 1
        near = cv2.dilate(blob, np.ones((2 * R + 1, 2 * R + 1), np.uint8))
        halo = (white[y0:y1, x0:x1] & (near == 1)).astype(np.uint8)
        mask[y0:y1, x0:x1] |= (blob | halo)
    mask = cv2.dilate(mask, np.ones((2, 2), np.uint8))

    # --- 4: majority-colour fill, then soften the seams --------------------------------------
    out = blob_fill(img, mask)
    blur = cv2.GaussianBlur(out, (3, 3), 0)
    seam = cv2.dilate(mask, k3)
    out[seam == 1] = blur[seam == 1]

    # --- 5: flatten the title / legend / disclaimer boxes ------------------------------------
    sea = img[int(SEA_SAMPLE[1] * H), int(SEA_SAMPLE[0] * W)]
    boxmask = np.zeros_like(mask)
    for (fx0, fy0, fx1, fy1) in SEA_BOXES:
        x0, y0, x1, y1 = int(fx0 * W), int(fy0 * H), int(fx1 * W), int(fy1 * H)
        out[y0:y1, x0:x1] = sea
        boxmask[y0:y1, x0:x1] = 1

    Image.fromarray(out).save(dst, optimize=True)

    # --- marks image for the touch-up pass -----------------------------------------------------
    marks = img.copy().astype(np.float32)
    changed = ((mask | boxmask) == 1)
    marks[changed] = marks[changed] * 0.35 + np.array([255, 0, 200], np.float32) * 0.65
    Image.fromarray(marks.astype(np.uint8)).save(marks_path, optimize=True)

    print("text blobs kept %d of %d dark blobs | masked %.2f%% of pixels | sea colour %s"
          % (kept, n - 1, 100 * mask.mean(), tuple(int(c) for c in sea)))
    print("wrote %s and %s" % (dst, marks_path))


if __name__ == "__main__":
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    src = sys.argv[1] if len(sys.argv) > 1 else os.path.join(here, "assets", "zemuria.png")
    dst = sys.argv[2] if len(sys.argv) > 2 else os.path.join(here, "assets", "zemuria_clean.png")
    marks = sys.argv[3] if len(sys.argv) > 3 else os.path.join(here, "archive", "zemuria_clean_marks.png")
    main(src, dst, marks)

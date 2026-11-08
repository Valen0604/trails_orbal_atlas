#!/usr/bin/env python3
"""
Upscale the cleaned map 2x (Lanczos) so the site has more pixels to work with when
zoomed in. Run this AFTER the hand touch-up of assets/zemuria_clean.png, once.

    python tools/upscale_map.py            # assets/zemuria_clean.png -> 2x, in place
    python tools/upscale_map.py 3          # a different factor

The native-resolution file is kept at archive/zemuria_clean_native.png so the touch-up
can be redone or re-exported later. Flat vector-style art upscales cleanly with Lanczos;
an AI upscaler (Real-ESRGAN, Topaz) can be substituted here if you want crisper edges.

Requires: pillow   (pip install -r tools/requirements-tools.txt)
"""
import os
import shutil
import sys

from PIL import Image

Image.MAX_IMAGE_PIXELS = None

here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = os.path.join(here, "assets", "zemuria_clean.png")
backup = os.path.join(here, "archive", "zemuria_clean_native.png")
factor = float(sys.argv[1]) if len(sys.argv) > 1 else 2.0

img = Image.open(src).convert("RGB")
if img.width > 5000:
    sys.exit("%s is already %dx%d; refusing to upscale again (restore from %s first)" % (src, img.width, img.height, backup))
if not os.path.exists(backup):
    shutil.copyfile(src, backup)
    print("backed up the native file to", backup)
big = img.resize((round(img.width * factor), round(img.height * factor)), Image.LANCZOS)
big.save(src, optimize=True)
print("wrote %s at %dx%d (%.1f MB)" % (src, big.width, big.height, os.path.getsize(src) / 1e6))
print("The site needs no change: it reads the image's size at load time.")

"""Store-listing validator for Tide and Cinder (Track E.6 shipping leg).

Asserts the Google Play 2026 contract: title <= 30 chars, short <= 80,
full <= 4000, 512x512 icon, 1024x500 feature graphic, >= 2 screenshots
(JPEG or 24-bit PNG, no alpha, 320-3840px per side), every asset present.

Run from the repository root:
    python3 -m unittest harness.agents.test_store_listing
"""

import json
import unittest
from pathlib import Path

from PIL import Image

REPO_ROOT = Path(__file__).resolve().parents[2]
STORE = REPO_ROOT / "store" / "tide-and-cinder"


def load_listing():
    with open(STORE / "listing.json", encoding="utf-8") as fh:
        return json.load(fh)


class StoreListingTests(unittest.TestCase):
    def test_metadata_limits(self):
        listing = load_listing()
        self.assertLessEqual(len(listing["title"]), 30, listing["title"])
        self.assertLessEqual(len(listing["shortDescription"]), 80)
        self.assertLessEqual(len(listing["fullDescription"]), 4000)
        self.assertTrue(
            listing["assets"]["screenshots"]
            and len(listing["assets"]["screenshots"]) >= 2
        )

    def test_icon_contract(self):
        listing = load_listing()
        icon = Image.open(STORE / listing["assets"]["icon"])
        self.assertEqual(icon.size, (512, 512))
        self.assertIn(icon.mode, ("RGB", "RGBA"))

    def test_feature_graphic_contract(self):
        listing = load_listing()
        graphic = Image.open(STORE / listing["assets"]["featureGraphic"])
        self.assertEqual(graphic.size, (1024, 500))

    def test_screenshot_contract(self):
        listing = load_listing()
        for name in listing["assets"]["screenshots"]:
            path = STORE / name
            self.assertTrue(path.is_file(), f"missing {name}")
            shot = Image.open(path)
            w, h = shot.size
            self.assertGreaterEqual(min(w, h), 320, name)
            self.assertLessEqual(max(w, h), 3840, name)
            # Play screenshots: JPEG or 24-bit PNG (no alpha channel).
            self.assertIn(shot.mode, ("RGB", "L"), f"{name} has alpha: {shot.mode}")
            self.assertGreater(path.stat().st_size, 4096, f"{name} suspiciously small")


if __name__ == "__main__":
    unittest.main()

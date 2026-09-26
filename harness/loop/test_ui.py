"""Unit tests for A.3 UI kits + themes + zone audit + loop wiring.

Run from the repository root:
    python3 -m unittest harness.loop.test_ui
"""

import copy
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from harness.loop.action_applier import apply_actions  # noqa: E402
from harness.loop.aesthetic import audit_scene  # noqa: E402
from harness.loop.ui_kits import get_kit, kit_names, validate_kit  # noqa: E402
from harness.loop.ui_layout import ZONES, audit_ui, validate_element  # noqa: E402
from harness.loop.ui_themes import (  # noqa: E402
    THEMES,
    get_theme,
    theme_for_brief,
    theme_names,
    validate_theme_reference,
)


def base_scene():
    return {
        "gameObjects": [
            {
                "name": "Ground",
                "shape": "box",
                "size": [24, 1, 24],
                "position": [0, -0.5, 0],
                "color": "#27272a",
                "physics": "fixed",
            },
            {
                "name": "Player",
                "shape": "capsule",
                "size": [1, 1.5, 1],
                "position": [0, 1.5, 2],
                "color": "#3b82f6",
                "physics": "dynamic",
                "controller": True,
            },
        ]
    }


class ThemeTests(unittest.TestCase):
    def test_all_themes_self_valid(self):
        for name in theme_names():
            self.assertEqual(validate_theme_reference(THEMES[name]), [], name)

    def test_unknown_theme_is_none(self):
        self.assertIsNone(get_theme("neon-rain"))
        self.assertIsNone(get_theme(None))

    def test_genre_mapping(self):
        self.assertEqual(
            theme_for_brief({"title": "Arena", "fantasy": {"genre": "arena defense"}}),
            "fantasy",
        )
        self.assertEqual(
            theme_for_brief({"title": "Vroom", "fantasy": {"genre": "vehicle racer"}}),
            "driving",
        )
        self.assertEqual(
            theme_for_brief({"title": "???", "fantasy": {"genre": "??? abstract"}}),
            "default",
        )
        self.assertEqual(theme_for_brief({}), "default")

    def test_references_are_prose(self):
        for name in theme_names():
            self.assertGreater(len(THEMES[name]["reference"]), 20, name)


class LayoutTests(unittest.TestCase):
    def test_zones_cover_expected_set(self):
        for zone in (
            "top_center",
            "top_left",
            "top_right",
            "bottom_left",
            "bottom_right",
            "bottom_center",
            "center",
            "full",
        ):
            self.assertIn(zone, ZONES)

    def test_clean_shell_scores_five(self):
        kit = get_kit("hud_arena")
        result = audit_ui({"theme": "fantasy", "elements": kit["elements"]})
        self.assertEqual(result["score"], 5)
        self.assertTrue(result["present"])

    def test_absent_ui_is_neutral(self):
        for ui in (None, {}, {"theme": "fantasy"}, {"elements": []}):
            result = audit_ui(ui)
            self.assertEqual((result["score"], result["present"]), (3, False))

    def test_safe_area_escape_is_defect(self):
        result = audit_ui(
            {
                "elements": [
                    {
                        "id": "bad",
                        "kind": "button",
                        "zone": "full",
                        "size": [0.5, 0.1],
                        "order": 0,
                    },
                ]
            }
        )
        self.assertLess(result["score"], 5)
        self.assertTrue(any("safe area" in d["defect"] for d in result["defects"]))

    def test_same_zone_same_order_collides(self):
        result = audit_ui(
            {
                "elements": [
                    {
                        "id": "a",
                        "kind": "label",
                        "zone": "top_center",
                        "size": [0.28, 0.08],
                        "order": 0,
                    },
                    {
                        "id": "b",
                        "kind": "label",
                        "zone": "top_center",
                        "size": [0.28, 0.08],
                        "order": 0,
                    },
                ]
            }
        )
        self.assertTrue(any("overlap" in d["defect"] for d in result["defects"]))

    def test_same_zone_distinct_order_stacks(self):
        result = audit_ui(
            {
                "elements": [
                    {
                        "id": "a",
                        "kind": "panel",
                        "zone": "center",
                        "size": [0.36, 0.36],
                        "order": 0,
                    },
                    {
                        "id": "b",
                        "kind": "button",
                        "zone": "center",
                        "size": [0.20, 0.08],
                        "order": 1,
                    },
                ]
            }
        )
        self.assertEqual(result["score"], 5)

    def test_unknown_zone_rejected(self):
        self.assertTrue(
            any(
                "zone" in p
                for p in validate_element(
                    {
                        "id": "x",
                        "kind": "label",
                        "zone": "offscreen",
                        "size": [0.2, 0.1],
                    }
                )
            )
        )


class KitTests(unittest.TestCase):
    def test_registry_has_four_kits(self):
        self.assertEqual(
            set(kit_names()), {"hud_arena", "hud_racer", "menu_basic", "dialogue_panel"}
        )

    def test_all_kits_valid_and_clean(self):
        for name in kit_names():
            kit = get_kit(name)
            self.assertEqual(validate_kit(kit), [], name)
            audit = audit_ui({"theme": kit["theme"], "elements": kit["elements"]})
            self.assertEqual(audit["score"], 5, name)

    def test_kit_is_a_copy(self):
        kit = get_kit("hud_arena")
        kit["elements"].append({"id": "junk"})
        self.assertEqual(len(get_kit("hud_arena")["elements"]), 4)

    def test_bad_kit_rejected(self):
        self.assertTrue(validate_kit({"theme": "nope", "elements": []}))


class UiActionTests(unittest.TestCase):
    def test_kit_op(self):
        scene, result = apply_actions(
            base_scene(), [{"type": "ui", "op": "kit", "kit": "hud_arena"}]
        )
        self.assertEqual(result.applied, 1)
        self.assertEqual(scene["ui"]["theme"], "fantasy")
        self.assertEqual(len(scene["ui"]["elements"]), 4)

    def test_theme_op(self):
        scene, result = apply_actions(
            base_scene(), [{"type": "ui", "op": "theme", "theme": "dungeon"}]
        )
        self.assertEqual(result.applied, 1)
        self.assertEqual(scene["ui"]["theme"], "dungeon")

    def test_element_upsert(self):
        scene, _ = apply_actions(
            base_scene(),
            [
                {
                    "type": "ui",
                    "op": "element",
                    "element": {
                        "id": "score",
                        "kind": "label",
                        "zone": "top_center",
                        "size": [0.28, 0.08],
                        "order": 0,
                    },
                },
                {
                    "type": "ui",
                    "op": "element",
                    "element": {
                        "id": "score",
                        "kind": "label",
                        "zone": "top_left",
                        "size": [0.20, 0.08],
                        "order": 0,
                    },
                },
            ],
        )
        self.assertEqual(len(scene["ui"]["elements"]), 1)
        self.assertEqual(scene["ui"]["elements"][0]["zone"], "top_left")

    def test_rejections_are_outcomes(self):
        scene, result = apply_actions(
            base_scene(),
            [
                {"type": "ui", "op": "kit", "kit": "nope"},
                {"type": "ui", "op": "theme", "theme": "nope"},
                {"type": "ui", "op": "element", "element": {"id": "x"}},
                {"type": "ui", "op": "remove", "id": "ghost"},
                {"type": "ui", "op": "frobnicate"},
            ],
        )
        self.assertEqual(result.applied, 0)
        self.assertNotIn("ui", scene)
        statuses = [o["status"] for o in result.as_dict()["outcomes"]]
        self.assertTrue(all(s in ("invalid", "target-missing") for s in statuses))

    def test_remove_and_clear(self):
        scene, _ = apply_actions(
            base_scene(),
            [
                {"type": "ui", "op": "kit", "kit": "hud_arena"},
                {"type": "ui", "op": "remove", "id": "pause"},
            ],
        )
        ids = [e["id"] for e in scene["ui"]["elements"]]
        self.assertNotIn("pause", ids)
        scene, _ = apply_actions(scene, [{"type": "ui", "op": "clear"}])
        self.assertNotIn("ui", scene)


class AestheticUiTests(unittest.TestCase):
    def test_ui_alignment_real_when_present(self):
        scene = base_scene()
        scene["ui"] = {"theme": "fantasy", "elements": get_kit("hud_arena")["elements"]}
        audit = audit_scene(scene)
        self.assertEqual(audit["scores"]["ui_alignment"], 5)

    def test_ui_alignment_neutral_when_absent(self):
        self.assertEqual(audit_scene(base_scene())["scores"]["ui_alignment"], 3)

    def test_broken_ui_drags_overall(self):
        scene = base_scene()
        scene["ui"] = {
            "theme": "fantasy",
            "elements": [
                {
                    "id": "a",
                    "kind": "label",
                    "zone": "top_center",
                    "size": [0.28, 0.08],
                    "order": 0,
                },
                {
                    "id": "b",
                    "kind": "label",
                    "zone": "top_center",
                    "size": [0.28, 0.08],
                    "order": 0,
                },
            ],
        }
        audit = audit_scene(scene)
        self.assertLess(audit["scores"]["ui_alignment"], 5)
        self.assertTrue(any(d["axis"] == "ui_alignment" for d in audit["defects"]))


class MarketUiTests(unittest.TestCase):
    def test_ui_pack_round_trip(self):
        import tempfile
        from harness.market import packs, review

        with tempfile.TemporaryDirectory() as root:
            kit = get_kit("hud_racer")
            src = Path(root) / "src"
            src.mkdir()
            (src / "hud.json").write_text(json.dumps(kit), encoding="utf-8")
            (src / "heretek.json").write_text(
                json.dumps(
                    {
                        "name": "com.heretek.hud-racer",
                        "version": "1.0.0",
                        "engine": ">=1.0.0",
                        "kind": "ui",
                        "entry": "hud.json",
                        "license": "MIT",
                        "assets": ["hud.json"],
                    }
                ),
                encoding="utf-8",
            )
            pack_path = str(Path(root) / "hud.htepak")
            packs.create_pack(str(src), pack_path)
            installed = packs.install_pack(root, pack_path)
            self.assertTrue(installed)
            payloads = packs.enabled_payloads(root)
            ui_payloads = [p for p in payloads if p["kind"] == "ui"]
            self.assertEqual(len(ui_payloads), 1)
            manifest = dict(ui_payloads[0])
            verdict = review.review_pack(pack_path)
            api_failures = [
                f for f in verdict["failures"] if f.startswith("api-surface")
            ]
            self.assertEqual(api_failures, [])
            self.assertEqual(manifest["kind"], "ui")


if __name__ == "__main__":
    unittest.main()

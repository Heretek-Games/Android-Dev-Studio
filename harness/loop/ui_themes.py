"""
Genre theme tokens for loop-built UI (Track A.3).

The model picks `theme` + element zones instead of inventing raw colors every
run. Tokens are data (JSON-serializable) so they travel scene → brief → engine
without code coupling; engine application lands in Phase 2 (GameShell theme).

Each theme: palette (bg/surface/accent/text/muted/success/danger), typography
(font stack key + base scale), spacing scale, corner radius, and a prose
`reference` descriptor for brief lookdev blocks (reference-driven look-dev
beats emergent taste — cf. the sunset-duel milestone).
"""

from typing import Any, Dict, List, Optional

THEMES: Dict[str, Dict[str, Any]] = {
    "fantasy": {
        "palette": {
            "bg": "#14101c",
            "surface": "#241d33",
            "accent": "#d4a24e",
            "text": "#f3e9d2",
            "muted": "#9a8f7a",
            "success": "#7fb069",
            "danger": "#c1666b",
        },
        "typography": {"family": "serif", "basePx": 16, "titlePx": 28},
        "spacing": {"unit": 8, "panel": 16},
        "radius": 12,
        "reference": (
            "Genshin-style quest panel: dark translucent surface, gold trim, "
            "rounded 12px, serif titles, cream body text"
        ),
    },
    "dungeon": {
        "palette": {
            "bg": "#0b0b0e",
            "surface": "#1a1a21",
            "accent": "#8b5cf6",
            "text": "#e5e0f0",
            "muted": "#6f6a80",
            "success": "#4ade80",
            "danger": "#f87171",
        },
        "typography": {"family": "serif", "basePx": 15, "titlePx": 26},
        "spacing": {"unit": 8, "panel": 14},
        "radius": 8,
        "reference": (
            "Dark dungeon ledger: near-black violet surface, arcane purple "
            "accents, thin dividers, condensed serif headers"
        ),
    },
    "driving": {
        "palette": {
            "bg": "#0a0f14",
            "surface": "#131c24",
            "accent": "#22d3ee",
            "text": "#e8f6ff",
            "muted": "#64748b",
            "success": "#34d399",
            "danger": "#fb7185",
        },
        "typography": {"family": "mono", "basePx": 16, "titlePx": 24},
        "spacing": {"unit": 8, "panel": 12},
        "radius": 6,
        "reference": (
            "Sci-fi speedometer cluster: dark telemetry surface, cyan mono "
            "readouts, angular 6px corners, tabular numerals"
        ),
    },
    "city": {
        "palette": {
            "bg": "#101511",
            "surface": "#1c261d",
            "accent": "#eab308",
            "text": "#f5f0dc",
            "muted": "#8a937f",
            "success": "#65a30d",
            "danger": "#dc2626",
        },
        "typography": {"family": "sans", "basePx": 15, "titlePx": 24},
        "spacing": {"unit": 8, "panel": 14},
        "radius": 10,
        "reference": (
            "Sunlit builder ledger: deep green surface, harvest-gold accents, "
            "clean sans numerals, parchment text"
        ),
    },
    "scifi": {
        "palette": {
            "bg": "#05070d",
            "surface": "#0d1420",
            "accent": "#38bdf8",
            "text": "#dbeafe",
            "muted": "#475569",
            "success": "#2dd4bf",
            "danger": "#f43f5e",
        },
        "typography": {"family": "mono", "basePx": 15, "titlePx": 24},
        "spacing": {"unit": 8, "panel": 12},
        "radius": 4,
        "reference": (
            "Minimal starship console: abyssal blue surface, sky-blue mono "
            "type, hairline borders, 4px corners"
        ),
    },
    "default": {
        "palette": {
            "bg": "#111318",
            "surface": "#1d212b",
            "accent": "#60a5fa",
            "text": "#f1f5f9",
            "muted": "#7d8590",
            "success": "#4ade80",
            "danger": "#f87171",
        },
        "typography": {"family": "sans", "basePx": 16, "titlePx": 26},
        "spacing": {"unit": 8, "panel": 14},
        "radius": 8,
        "reference": (
            "Clean slate HUD: dark neutral surface, blue accents, sans type, "
            "comfortable 8px spacing grid"
        ),
    },
}

#: Brief fantasy-genre keywords → theme. First match wins; fallback default.
GENRE_KEYWORDS: List[tuple] = [
    (("fantasy", "arena", "quest", "rpg"), "fantasy"),
    (("dungeon", "crypt", "necromancer", "undead"), "dungeon"),
    (("driving", "racer", "racing", "vehicle", "speed"), "driving"),
    (("city", "builder", "settlement", "colony", "tycoon"), "city"),
    (("scifi", "sci-fi", "space", "cyber", "starship"), "scifi"),
]


def theme_names() -> List[str]:
    return sorted(THEMES)


def get_theme(name: Any) -> Optional[Dict[str, Any]]:
    if not isinstance(name, str):
        return None
    return THEMES.get(name.strip().lower())


def theme_for_brief(brief: Any) -> str:
    """Pick a theme name from a brief dict (fantasy.genre + title heuristics)."""
    text = ""
    if isinstance(brief, dict):
        fantasy = brief.get("fantasy")
        if isinstance(fantasy, dict):
            genre = fantasy.get("genre")
            if isinstance(genre, str):
                text += genre.lower() + " "
        title = brief.get("title")
        if isinstance(title, str):
            text += title.lower()
    for keywords, theme in GENRE_KEYWORDS:
        if any(k in text for k in keywords):
            return theme
    return "default"


def validate_theme_reference(theme: Dict[str, Any]) -> List[str]:
    """Return a list of problems with a theme table (empty = valid)."""
    problems: List[str] = []
    for key in ("bg", "surface", "accent", "text", "muted", "success", "danger"):
        color = (
            (theme.get("palette") or {}).get(key)
            if isinstance(theme.get("palette"), dict)
            else None
        )
        if not (
            isinstance(color, str) and color.startswith("#") and len(color) in (4, 7)
        ):
            problems.append(f"palette.{key} must be #rgb/#rrggbb (got {color!r})")
    typo = theme.get("typography")
    if not isinstance(typo, dict) or typo.get("family") not in (
        "serif",
        "sans",
        "mono",
    ):
        problems.append("typography.family must be serif|sans|mono")
    if not isinstance(theme.get("reference"), str) or not theme["reference"].strip():
        problems.append("reference descriptor must be non-empty prose")
    return problems

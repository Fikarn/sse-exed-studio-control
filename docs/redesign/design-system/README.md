# SSE Studio Control — design system for Claude Design

This library is generated from the program design brief v1.1 (`DESIGN-SYSTEM.md`, the rules) and the physics specimen. It exists so that Claude Design designs Studio Control with the product's own vocabulary: three themes under one light, five elevation levels, keys that go down and stay down while engaged, lamps that light instantly, wells that hold every value, stamped key caps beside sentence-case command buttons.

Read `DESIGN-SYSTEM.md` before designing. The non-negotiables for any screen:

- The backbone is fixed: four workspaces (Setup / Support, Lighting, Audio, Planning), one shell (64 px header with the four tabs and the lamp groove, 48 px workspace top bar with fixed slots, body of rail 320 / canvas / inspector 480, 40 px recessed footer), `2560x1440` primary with `1920x1080` and `1280x800` fallbacks, no page scroll.
- The screen never invents state: every value and state comes from the engine. Use only the state words in §7 of the rules.
- Colour never stands alone; hue names the family, form names the meaning (§6). Amber solid = engaged; amber outline = attention; red = error / hazard; green solid = live hold; the accent = selected / focus / ready.
- Type: eight steps (10 / 11 / 12 / 13 / 14 / 16 / 20 / 28), nothing under 10 px, nothing actionable under 11 px; Inter for language, JetBrains Mono for values and key caps, Fraunces for titles ≥ 20 px.
- Motion: lamps ≤ 60 ms with no fade, keys 100 ms mechanical, nothing animates at idle, no bounce, no hover lift.

Folders: `material/`, `tokens/` (colours; `tokens.css` and `tokens.json` are the machine-readable values), `type/`, `components/{key,lamp,band,well,panel,chrome}/`. Every `index.html` is a self-contained preview that renders the three themes side by side.

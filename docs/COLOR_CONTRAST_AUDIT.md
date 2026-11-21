# Color Contrast Audit & Improvements (#533)

This document records the audit plan and suggested remediations to improve color contrast across the web app for accessibility.

## Goals

- Ensure text and UI components meet WCAG AA contrast ratios (4.5:1 for normal text, 3:1 for large text).
- Provide a prioritized list of components and pages to fix.

## Audit Plan

1. Run automated contrast checks against page screenshots (e.g., use pa11y, axe-core, or Lighthouse).
2. Manually inspect components with custom styling (buttons, badges, charts) to confirm color ratios.
3. Produce a prioritized remediation list: critical (navigation, forms), important (cards, primary CTAs), cosmetic.

## Suggested Remediations

- Replace low-contrast text colors with accessible tokens in `apps/web/src/styles` and `globals.css`.
- Use `prefers-contrast` media query to offer stronger contrast for users who request it.
- Update Tailwind config color palette to include accessible token variants and use them across components.

## Verification

- Re-run automated checks after fixes.
- Add unit visual tests or screenshot tests in `apps/web/e2e` to prevent regressions.

Link to issue: #533

## Color-Blind-Safe Chart Palette (#243)

### Rationale

The previous dashboard chart palette relied on red/green pairs to distinguish data series. For users with deuteranopia (red-green, ~6% of males) or protanopia (red-green, ~1% of males), these pairs collapse into nearly identical hues, making charts unreadable. We replaced the palette with the **Okabe-Ito** color-blind-safe palette, which was designed specifically to remain distinguishable under all common forms of color vision deficiency, including tritanopia (blue-yellow).

### Chosen Palette (Okabe-Ito)

| Token | Hex | Name | Typical Use |
| --- | --- | --- | --- |
| `chart-1` | `#0072B2` | Blue | Primary series |
| `chart-2` | `#E69F00` | Orange | Secondary series |
| `chart-3` | `#009E73` | Bluish green | Tertiary series |
| `chart-4` | `#CC79A7` | Reddish purple | Quaternary series |
| `chart-5` | `#56B4E9` | Sky blue | Additional series |
| `chart-6` | `#F0E442` | Yellow | Additional series |
| `chart-7` | `#D55E00` | Vermillion | Additional series |
| `chart-8` | `#000000` | Black | Outlines / emphasis |

These tokens are exposed in the Tailwind config as `colors.chart.{1..8}` (and mirrored as CSS custom properties `--chart-1` … `--chart-8` in `globals.css`) so charts and components consume the same source of truth.

### Simulation Results (Coblis / Sim Daltonism)

Each palette color was run through Coblis and Sim Daltonism for deuteranopia, protanopia, and tritanopia. The table below records the number of colors that remain mutually distinguishable (ΔE above the perceptual threshold) in each simulated mode.

| Simulation Mode | Distinguishable Colors (of 8) | Notes |
| --- | --- | --- |
| Normal vision | 8 | All colors distinct |
| Deuteranopia | 6 | Blue, orange, bluish green, reddish purple, sky blue, and black remain distinct; yellow/vermillion shift toward orange but stay separable from the core four |
| Protanopia | 6 | Same core set remains distinct; vermillion darkens but does not collide with orange |
| Tritanopia | 5 | Blue, orange, bluish green, reddish purple, and black remain distinct; sky blue and yellow shift but stay separable from the core four |

**Acceptance criterion met:** at least four colors (blue, orange, bluish green, reddish purple) remain distinguishable in **all three** simulated modes, satisfying the requirement of ≥4 distinct colors under deuteranopia, protanopia, and tritanopia.

### Pattern Fills as Secondary Differentiator

Because color alone is never a sufficient accessibility signal, every chart series also receives a distinct **pattern fill** (via SVG `<pattern>` definitions / `fill-pattern-{n}` utilities). Patterns are assigned in the same order as the palette tokens:

1. Solid
2. Diagonal lines (↘)
3. Horizontal lines (—)
4. Vertical lines (|)
5. Cross-hatch
6. Dots
7. Diagonal lines (↙)
8. Dense cross-hatch

This ensures series remain distinguishable even for users with monochromacy or when charts are printed in grayscale. Legend swatches render both the color and its pattern so the mapping is explicit.

### Verification

- Palette and pattern assignments are covered by visual regression tests in `apps/web/e2e`.
- Simulation checks were performed manually with Coblis and Sim Daltonism; results are recorded above and should be re-run whenever the palette changes.

Link to issue: #243
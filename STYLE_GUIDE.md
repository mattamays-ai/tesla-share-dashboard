# Tesla Share Visual and Interaction Style Guide

This document is the implementation contract for `tesla-share-card.js`. It is not permission to copy Tesla screens pixel-for-pixel. It defines the visual hierarchy, semantic colors, interaction rules, image treatment, and verification gates required for a Tesla-like vehicle-first Home Assistant card.

## 1. Reference hierarchy

Use references in this order:

1. Tesla vehicle touchscreen and Tesla app behavior documented in current Tesla owner manuals.
2. Official Tesla product imagery and paint naming.
3. Home Assistant's current Tesla Fleet entity model and service domains.
4. Existing card conventions only when they do not conflict with the first three.

Never invent safety thresholds, vehicle capabilities, entity values, or model-specific controls.

## 2. Core aesthetic

Tesla UI is restrained. The vehicle and its state are the hierarchy. Decoration is secondary.

- Near-black carbon surfaces with subtle blue undertones.
- White for primary information and large numeric emphasis.
- Muted cool gray for metadata and labels.
- Tesla blue for selection, focus, cooling state, and normal primary confirmation.
- Green only for successful active charging.
- Amber for caution, low battery, reduced charging, or an official warning entity.
- Red only for heat, faults, critical warnings, or genuinely destructive actions.
- No traffic-light coloring of ordinary data.
- No fabricated glow, gradients, or warning colors that do not represent state.

## 3. Implemented tokens

| Purpose | Token | Value |
| --- | --- | --- |
| App background | `--ts-bg` | `#050607` |
| Card surface | `--ts-surface` | `#0b0d10` |
| Panel surface | `--ts-panel` | `#0d0f13` |
| Control surface | `--ts-control` | `#14171b` |
| Subtle border | `--ts-border-subtle` | `#171a1f` |
| Border | `--ts-border` | `#262b31` |
| Primary text | `--ts-text` | `#e9ebed` |
| Secondary text | `--ts-muted` | `#8a9096` |
| Tertiary text | `--ts-dim` | `#6f767d` |
| Tesla blue | `--ts-blue` | `#3e6ae1` |
| Active charging | `--ts-green` | `#31d158` |
| Heat / critical | `--ts-red` | `#e82127` |
| Warning / low battery | `--ts-amber` | `#f5a623` |

## 4. Typography

Tesla's proprietary typeface is not bundled. Use the native UI stack to avoid licensing and download dependencies:

`-apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif`

Hierarchy:

- Model name: 22-26 px, medium weight.
- Primary numeric state: 32-38 px, semibold, tight tracking.
- Section title: 13 px, semibold.
- Body/state rows: 11-12 px.
- Kicker/metadata: 9-10 px, uppercase only when it improves scanning.
- TESLA text treatment: 11 px, weight 600, restrained wide tracking. It is a text treatment, not the official logo asset.

Do not hardcode a separate font inside SVG illustrations. SVG text inherits the card font.

## 5. Spacing and geometry

Use an 8 px rhythm with limited exceptions for optical alignment.

- Outer shell: 8 px padding, 16 px radius.
- Vehicle card: 16 px radius.
- Panels: 12-16 px radius.
- Buttons: 8-12 px radius.
- Dense gaps: 8 px.
- Section horizontal padding: 16-20 px.

Avoid nested oversized radii and decorative borders. Use spacing and typography to create hierarchy.

## 6. Vehicle imagery

- Model 3, Y, S, and X use official Tesla CDN cutouts transformed to transparent PNG.
- Cybertruck uses the built-in transparent SVG because the available official hero scene is opaque and visually inconsistent.
- Unknown models use the built-in transparent generic Tesla SVG.
- The visual container may have a dark studio gradient; the image itself must have no rectangular or scene background.
- Paint tinting must be masked to the vehicle alpha silhouette. Never place a full-frame color overlay over the studio background.
- Preserve aspect ratio and consistent optical scale across models.
- A configured custom image must also be transparent. If it is not, the mismatch is user-supplied and should not be hidden with a destructive crop.

## 7. Paint palettes

Palettes are model-aware and use Tesla paint/wrap names. Display colors are approximations for UI swatches, not authoritative repair-paint formulas.

- Model 3 / Y: Pearl White Multi-Coat, Solid Black, Stealth Grey, Deep Blue Metallic, Ultra Red, Quicksilver, Frost Blue Metallic.
- Model S / X: Pearl White Multi-Coat, Solid Black, Stealth Grey, Deep Blue Metallic, Ultra Red, Midnight Cherry Red, Lunar Silver.
- Cybertruck: Stainless Steel plus official-style wrap choices only. Do not imply the stainless body is conventional paint.
- Roadster: separate fallback palette, never inherit Model 3 labels silently.

Paint selection is secondary and belongs behind the settings control.

## 8. State color rules

### Battery

- Normal SOC: white.
- SOC at or below 20 percent: amber.
- Actively charging: green.
- Missing/unavailable: neutral gray and `-`.

### Charging

- Active charging: green.
- Connected/scheduled/not charging: neutral unless a source entity exposes a warning state.
- Reduced/fault coloring must come from an exposed state, not guessed from current alone.

### Climate

- Heat levels: red, one to three illuminated waves.
- Cooling levels: blue, one to three illuminated waves.
- Off: neutral visible waves.
- Unavailable is never shown as on.

### Open panels

- Open doors, windows, frunk, trunk, and charge port are informational white emphasis while parked.
- Red is reserved for an actual fault or dangerous context exposed by the integration.

### TPMS

- Normal pressure values: white.
- Amber only when the integration's corresponding tire-pressure-warning binary sensor is on.
- Missing/unavailable: gray `-`.
- Use each pressure sensor's native unit. Never apply universal PSI thresholds.
- Red is reserved for an explicit system fault entity if one becomes available.

## 9. Controls and menus

Every element that looks actionable must do one of the following:

1. Call the correct Home Assistant service for the discovered entity domain.
2. Open a state-aware submenu.
3. Be visibly disabled when unavailable or busy.

Rules:

- Native buttons expose `aria-pressed` for toggles and `aria-busy` while a command is pending.
- SVG seat and steering controls support pointer, Enter, and Space.
- Escape closes confirmation and open submenus.
- Risky commands use an in-card modal confirmation. Unlock, honk, flash, remote start, frunk, and trunk are confirmed.
- Locking is not confirmed. Unlocking is.
- Confirmation uses blue for the normal primary action, neutral for cancel, and red only for destructive semantics.
- Command success/failure is shown in an `aria-live` status notice.
- Duplicate service calls are blocked while the entity is busy.

## 10. Model- and capability-aware submenus

- Climate cabin shape reflects the vehicle family: round wheel for 3/Y, yoke-style control for current S/X/Cybertruck treatment, angular Cybertruck dash/console.
- Third-row seats render only when third-row heater entities exist.
- Tire overhead art uses sedan, SUV, or Cybertruck geometry.
- Charging controls render writable sliders only for `number` or `input_number` entities.
- Seat controls support `select` level entities and `switch` on/off entities.
- Covers, buttons, switches, and locks dispatch only services valid for their domain.
- Unsupported or absent capabilities are omitted, never replaced with fake controls.

## 11. Formatting

- Use title case for human-readable states, not raw underscore identifiers.
- Preserve native entity units.
- Use `-` for unavailable numeric values.
- Use consistent labels: `Charge limit`, `Charge current`, `Cabin`, `Outside`, `Mode`, `State`.
- Do not append a unit twice.
- Do not hardcode `kW`, `A`, `psi`, miles, or temperature scale when an entity or Home Assistant unit-system value exists.

## 12. Performance and code quality

The card remains a single-file, no-build HACS resource, but that is not permission for junk code.

- Skip full DOM replacement when relevant entity state has not changed.
- Defer state-driven replacement while range/color inputs are active.
- Cache Recorder trip calculations until history changes.
- Back off after registry and history failures.
- Keep stylesheet text in one module constant.
- Remove unreachable handlers and obsolete selectors.
- Namespace SVG definition IDs per vehicle.
- Guard duplicate custom-element and custom-card registration.
- Keep the source ASCII-only; use HTML entities for visible non-ASCII symbols.

## 13. Release verification gates

A release is not complete until all gates pass:

1. JavaScript parser check plus a deliberate-invalid control proving the parser rejects bad input.
2. Static action-emission to handler/service matrix.
3. Model fixtures: Model 3, Y, S, X, Cybertruck, Roadster, unknown fallback.
4. Platform fixtures: `tesla_custom` and `tesla_fleet`.
5. State fixtures: charging, not charging, low battery, locked/unlocked, climate on/off/unavailable, panels open/closed/unavailable, TPMS warning/normal/unavailable.
6. Domain fixtures: cover/button/switch panels, select/switch seats, number charging controls.
7. Browser interaction tests for every visible button, keyboard seat activation, confirmation cancel/approve, sliders, paint menu, charging menu, climate menu, and Escape dismissal.
8. Visual screenshots at desktop and narrow mobile widths.
9. Confirm that all vehicle art has transparent backgrounds and consistent scale.
10. Confirm `preview.html` and scratch artifacts are excluded from release commits.

## 14. Reference pages

- Tesla owner manuals: charging status, climate seat/steering behavior, tire-pressure warnings, and battery-state semantics.
- Tesla official digital assets: transparent vehicle cutouts for Model 3/Y/S/X.
- Home Assistant Tesla Fleet integration documentation: current vehicle entity domains and default availability.

Reference behavior changes over time. Re-check these sources before changing semantic colors or capability mappings.

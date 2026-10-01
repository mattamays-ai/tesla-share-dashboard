# Tesla Share Project Handover

Last updated: October 1, 2026

## 1. Repository and release authority

- Repository: mattamays-ai/tesla-share-dashboard
- Default branch: main
- Current main commit: dc2552f38e55248423f47bc608cfe87eda8d98c9; this release also carries the October 1 follow-up pass described in section 2 (same commit as this document).
- Main is authoritative. Do not merge the older v2-tesla-app-ui or v3-vehicle-command-center branches back into main unless explicitly required.
- HACS dashboard plugin, single-file browser-native custom element, no build step.
- Primary source: tesla-share-card.js
- Custom element: tesla-share-card
- Supported platforms: tesla_custom and tesla_fleet
- Minimum Home Assistant version: 2024.8.0
- Maintainer: mattamays-ai <mattamays@gmail.com>

## 2. Current release state

The October 1 hardening pass is on main. It includes state handling, command acknowledgement, native-unit handling, Recorder route/trip wording, vehicle-art reliability, and entity-selection hardening.

A follow-up defect-fix pass landed in commit 911221a: it fixed a temporal-dead-zone ReferenceError in _carHtml (tempUnit used before declaration) that crashed every card render, repaired seven over-escaped regex literals in entity discovery, Tesla-signature matching, dashboard-overview charging detection, and vehicle-name cleanup, redesigned the fallback signature match to use substring matching (word-boundary regexes never match underscore entity slugs), replaced five non-ASCII characters with unicode escapes, removed a dead ternary in setConfig, and added a hex-format guard on configured colors before they are interpolated into style attributes.

The current source was fetched from main immediately before this handover synchronization. The current tesla-share-card.js blob SHA is:

475dd88689523b45c64c4846228f8fa2eb9fdb44

A second October 1 follow-up pass (same commit as this document) added two behavior corrections from a fresh contract audit: vehicle_images URLs are now scheme-validated (only http(s) is used; other schemes fall back to official artwork), and the numeric state helper no longer coerces a missing or unknown entity value into 0 (a battery, charge limit, or amps value with no source entity renders as a dash instead of a fabricated "0", which previously could also trigger the amber low-battery treatment on a car with no battery entity). A real-browser render of the current source was performed against a local mocked-Home-Assistant fixture (scratch, not committed); discovery, remote artwork, temperature units, and controls rendered correctly.

A third October 1 pass (same commit as this document) reworked climate interaction, paint recoloring, and mode imagery, driven by user feedback:

- the Climate quick-control button now opens the climate/interior view (seat cabin, chips, controls) and scrolls it into view instead of toggling HVAC; explicit HVAC On/Off lives inside that view
- a climate preset-mode selector cycles preset_modes via climate.set_preset_mode (tesla_custom exposes none/dog/camp/keep_on/defrost), alongside the existing hvac_mode and fan_mode cycling
- when a preset mode is active, the interior view shows mode imagery: a mode_images config URL when one matches the preset name, otherwise an inline SVG fallback (dog, camp, defrost, keep)
- remote artwork is recolored to the selected paint via a duotone CSS filter chain computed from the paint hex (grayscale, sepia, saturate, hue-rotate, brightness derived from the color's HSL), replacing the four hard-coded filter branches; luminance detail of the photo is preserved
- a command that is accepted but produces no state change now reports "Vehicle asleep \u00b7 wake it and retry" when the vehicle's online/asleep entities indicate the car is not awake, instead of the generic pending notice

This pass was verified with the three local Node harnesses, an 8-case behavior proof suite (climate-open, HVAC power dispatch, preset cycling, mode image override and fallback, hex-derived paint filter, asleep hint), and a real-browser render of the current source against a mocked-Home-Assistant fixture (scratch, not committed).

There is no CI workflow currently associated with this release. Do not claim a new browser-suite pass unless it has actually been run. The 911221a fixes were verified with local Node harnesses (render, discovery fallback, adversarial cases) and the README parser check; the current source has additionally had a real-browser render check (see above), but the historical full browser-suite has not been rerun on it.

## 3. Card contract

Minimal configuration:

    type: custom:tesla-share-card

Typical configuration:

    type: custom:tesla-share-card
    history_days: 7
    history_ttl_ms: 300000
    colors:
      My Model Y: "#171A20"

Configuration behavior:

- history_days is clamped to 1-30 days.
- history_ttl_ms defaults to 300000 ms and is clamped to 60000-900000 ms.
- colors provides per-vehicle paint selection.
- vehicle_images provides model-specific image URLs. Only http(s) URLs are used; any other scheme is ignored and discovery falls back to official artwork.
- mode_images provides per-preset imagery for the climate/interior view (keys match preset names such as dog, camp, keep_on, defrost; only http(s) URLs are used, and a broken or non-matching image falls back to the inline SVG icon).
- Vehicle configuration is persisted by device identity where supported.

## 4. Architecture

Discovery uses Home Assistant WebSocket registry calls:

- config/entity_registry/list_for_display
- config/device_registry/list

The card:

- discovers tesla_custom and tesla_fleet entities
- groups entities by Home Assistant device
- scores candidate entities by capability, domain, device class, name, and state
- penalizes unknown/unavailable candidates
- excludes charge-port-like lock candidates from ordinary vehicle-lock matching
- renders through Shadow DOM
- uses delegated interaction handlers
- uses capability-driven controls rather than assuming every Tesla exposes every feature

Do not reintroduce dependence on undocumented hass.entities or hass.devices collections.

## 5. Vehicle imagery and paint

Official Tesla CDN artwork is used for supported Model 3, Model Y, Model S, and Model X artwork when available. Cybertruck and unknown/fallback cases use the built-in SVG artwork path.

Current paint treatment is intentionally dependency-light:

- remote artwork is displayed with a duotone CSS filter chain computed from the selected paint hex in _paintFilter(): grayscale(1) sepia(1) saturate() hue-rotate() brightness(), with the rotate/saturate/brightness values derived from the paint color's HSL (sepia's base hue is rotated onto the paint hue; saturation and brightness scale from the color's saturation and lightness)
- the photo's luminance detail (shadows, highlights, glass) is preserved through the grayscale base, so the recolored car keeps photographic depth while taking on the selected hue
- a lightweight color tint is layered over the vehicle image
- the previous cross-origin CSS mask-image dependency has been removed
- the built-in SVG remains available as a fallback and is painted directly with the configured color
- remote images use eager loading, async decoding, and no-referrer policy
- no external SVG <image> dependency is used

Do not describe the current implementation as using a cross-origin masked paint overlay, and do not describe the filter as a fixed per-color lookup table; the filter is computed from the paint hex.

The visual result reproduces the configured paint hue at the pixel-filter level, but it is still not an automotive paint formula match: glass, wheels, and trim share the recolor because the CDN artwork has no body-only mask.

## 6. State semantics

Battery:

- normal SOC is neutral/white
- SOC at or below 20 percent is amber
- active charging is green
- unavailable/unknown is shown as unavailable, not fabricated

Charging:

- active charging is green
- charging detection is anchored to active charging values/states
- reduced or fault coloring must come from an exposed source state, not guessed from current

Climate:

- heating uses red semantic treatment
- cooling uses blue semantic treatment
- unavailable climate is never rendered as active

Panels:

- doors, windows, frunk, trunk, and charge-port state reflect discovered entities
- open state is informational emphasis, not an invented fault
- known limitation: after an integration restart with the vehicle asleep, tesla_custom can serve placeholder panel states (for example a trunk reported "open" that is not real). The card renders what the entity reports and cannot distinguish a placeholder from a genuine state client-side; commands dispatched from a placeholder state may act on stale data

TPMS:

- values use the entity's native unit
- no universal PSI threshold is applied
- warning color is driven by the corresponding warning entity when available
- unknown/unavailable pressure is shown as -

Temperature:

- native Home Assistant/entity units are preferred
- fallback temperature display is explicitly Fahrenheit where the card has no source unit
- do not append a unit twice

## 7. Commands

All commands are capability-driven and dispatched through the discovered entity domain.

Supported paths include:

- lock/unlock
- climate (set_temperature, set_hvac_mode, set_fan_mode, set_preset_mode, turn_on/turn_off)
- cover
- button
- switch
- select
- number/input_number
- wake/refresh where exposed
- horn/flash/remote start where exposed
- frunk/trunk where exposed
- charging limit/current controls where writable entities exist

The Climate quick-control button opens the climate/interior view (it does not dispatch a command); HVAC on/off is an explicit button inside that view. The preset selector cycles the climate entity's preset_modes via climate.set_preset_mode and only renders when preset_modes is exposed. When a preset mode is active, the interior view shows mode imagery from the mode_images config key, falling back to an inline SVG icon if no matching or working image is configured.

High-impact actions use in-card confirmation:

- unlock
- honk
- flash
- remote start
- frunk open
- trunk open

Lock/close actions do not require confirmation.

### Command acknowledgement

The current _service() behavior is intentionally honest about Home Assistant execution versus vehicle state:

1. The Home Assistant service call is attempted.
2. For stateful domains, the card briefly observes the selected entity for a state change.
3. If the selected entity changes, the notice is:
   "Vehicle state updated"
4. If the service call succeeds but no observed state change occurs during the short window, the notice is:
   "Command accepted \u00b7 vehicle state pending"
5. If Home Assistant rejects the service call, the card shows:
   "Command failed: <bounded error>"

This is not proof that Tesla has completed the physical action. It is service acceptance plus best-effort state observation.

Busy entities block duplicate service calls until the command cycle finishes.

## 8. Recorder history and trip intelligence

The card queries Home Assistant Recorder history for the selected vehicle device_tracker.

Defaults and limits:

- history_days default: 7
- history_days maximum: 30
- history cache TTL default: 5 minutes
- retry/backoff behavior prevents repeated Recorder failures from hammering the API

GPS history:

- uses latitude/longitude attributes when retained by Recorder
- displays the full retained Recorder route
- explains when GPS data is unavailable

Trip estimation:

- Recorder gaps over 30 minutes segment history
- consecutive GPS coordinates are used to estimate distance with haversine distance
- legs below 0.05 km are ignored
- trips below 0.35 km are ignored
- internal trip processing can retain up to 20 trips
- the UI shows the latest 5 trips
- trip distance is explicitly an estimate from Recorder GPS points, not Tesla odometer or official trip data

Use the labels:

- Latest estimated trip
- Estimated trip N
- Full retained Recorder route
- Recorder route history

Do not call estimated Recorder trips official Tesla trips.

## 9. Accessibility and interaction

- native buttons for actionable controls
- aria-pressed for toggles
- aria-busy while commands are pending
- aria-live for command status
- keyboard support for interactive controls
- visible focus treatment
- reduced-motion handling
- confirmation/submenu Escape dismissal
- modal focus handling
- descriptive image/SVG labels

## 10. Performance and reliability

The card uses:

- render signatures to avoid unnecessary full DOM replacement
- input-focus deferral for active range/color controls
- cached Recorder history and trip calculations
- registry/history retry and backoff behavior
- CSS container queries where supported
- no build system
- no package.json dependency chain

The production JS should remain ASCII-only. Use HTML entities for visible non-ASCII symbols where needed.

## 11. Local preview and verification

There is no committed preview fixture in this repository. A historical handover referenced a preview.html served on port 8631; that file does not exist in git history and the reference was stale. Browser-level verification of the current source was done with a local scratch fixture (mocked Home Assistant state, registry, and service calls) that is deliberately not committed; recreate one locally if browser verification is needed again.

Required release checks:

    node -e 'const fs=require("fs"); new Function(fs.readFileSync("tesla-share-card.js","utf8")); console.log("parser ok")'
    node -e 'new Function("this is not valid js ((")'
    git diff --check
    LC_ALL=C grep -nP '[^\x00-\x7F]' tesla-share-card.js
    git status --short
    git diff --stat

Also verify:

- Model 3, Model Y, Model S, Model X, Cybertruck, Roadster, and unknown fallback fixtures
- tesla_custom and tesla_fleet fixtures
- charging/not-charging/low-battery states
- lock/unlock
- climate on/off/unavailable
- panels open/closed/unavailable
- TPMS warning/normal/unavailable
- cover/button/switch/seat/charging-control domains
- every visible action emits to a live handler
- confirmation cancel/approve
- keyboard interaction and Escape dismissal
- paint selection
- charging controls
- climate controls
- desktop and narrow mobile visual layouts
- remote artwork fallback behavior
- no dead links or obsolete external image dependencies

A historical 51/51 browser verification run existed before the latest October 1 cleanup. It must not be presented as verification of the current commit unless rerun after the current changes.

## 12. Release discipline

Before changing semantic behavior, re-check current Tesla owner documentation and Home Assistant Tesla Fleet behavior.

Before release:

1. Verify main is the intended release branch.
2. Run parser/static checks.
3. Run the full browser/fixture suite if available.
4. Review visual output for all model fixtures.
5. Confirm preview.html and scratch artifacts are not included accidentally.
6. Review the final diff.
7. Commit directly to main only when the requested workflow explicitly calls for it.

## 13. Current synchronization receipt

This handover is synchronized to the October 1, 2026 main state represented by:

dc2552f38e55248423f47bc608cfe87eda8d98c9

The previous handover receipt pointing to 23fe5ad5792283d456874c9b5992ea228297e89f is historical and no longer describes the current main state. (The 23fe5ad receipt itself had replaced 62a84a85a5b9d67f2da93ec1338dacdd78c141e6.)

Key documentation corrections made here:

- current main commit and card blob SHA are updated (main dc2552f; card blob 475dd88 after the third October 1 pass)
- the defect-fix pass (render crash, regex repairs, color guard) is documented in section 2
- the second October 1 pass (vehicle_images scheme validation, numeric-state null handling) is documented in section 2
- the third October 1 pass (climate view interaction, preset modes, mode imagery, duotone paint recolor, asleep hint) is documented in sections 2, 3, 5, and 7
- section 11 no longer references a committed preview fixture; none exists in git history
- a known placeholder-state limitation for tesla_custom restarts is documented in section 6
- command acknowledgement wording matches _service() including the vehicle-asleep hint
- paint treatment wording matches the current CSS-filter implementation
- TPMS/native-unit behavior is documented
- Recorder route and estimated-trip terminology matches the current UI
- current verification status does not overclaim a new 51/51 browser run
- the remote-image dependency description reflects the removal of cross-origin mask recoloring

## 14. Cross-agent protocol (instructions for any AI agent working in this repo)

These instructions apply to every AI agent (Claude, Codex, or any other assistant) that touches this repository. They are part of the handover and carry the same authority as the release discipline rules.

### Dialogue is required, not optional

1. **Ask before you assume.** If any instruction, requirement, or repository state is ambiguous, you must ask the maintainer a clarifying question before acting. Do not guess and do not silently pick an interpretation. The only exception: if the ambiguity is fully reversible (no data loss, no destructive change, no public-facing effect), you may pick the most conventional option, but you MUST state the assumption explicitly in your report and in the task record.
2. **Ask before destructive or external actions.** Pushing, deleting branches, rewriting history, force-pushing, editing release artifacts, or anything visible outside the working tree requires explicit approval first. "Push it" said once covers the task in front of you, not future tasks.
3. **Ask when you find something unexpected.** If the code contradicts the documentation, or a verification claim in this handover fails to reproduce, stop and report the discrepancy. Do not silently "fix" the docs to match what you found, and do not silently change code to match the docs. Dialogue first.
4. **Report in dialogue, not monologue.** Progress reports should surface open questions and failed assumptions, not just completed steps. An agent that only reports success is hiding the information the maintainer needs.

### Questioning behaviors (mandatory self-audit)

5. **Question the handover itself.** Verify current state against `git log` / `git rev-parse` before trusting any SHA or claim in this document. This handover has gone stale before; treat every claim as a hypothesis to verify, not a fact to obey.
6. **Question your own findings.** Before reporting a bug as confirmed, reproduce it at runtime or with a harness. Before reporting a bug as refuted, prove the refutation at runtime too. A code read alone is never evidence.
7. **Question your own completion.** Before claiming done: every requirement implemented and evidenced, every affected integration verified, adversarial cases tried, and a fresh validation pass run after the last change. If any item is unverified, report `STATUS: NOT DONE` with the specific remaining items. Never convert an unverified claim into a positive summary.
8. **Question scope.** Do not add unrequested features, dependencies, refactors, or documentation rewrites. If you believe extra work is needed, propose it and wait for the answer.

### Working rules

9. Verify before modifying; understand before changing.
10. Keep the audit evidence (harnesses, checks) reproducible; run the section 11 release checks before claiming any release state.
11. Do not merge or delete the v2-tesla-app-ui / v3-vehicle-command-center branches.

End of handover.

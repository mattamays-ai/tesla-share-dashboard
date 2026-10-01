# Tesla Share

A Tesla-inspired Home Assistant vehicle command center for **Tesla Custom** and **Tesla Fleet**.

Tesla Share is designed around one idea: put the car first. It combines live vehicle state, practical controls, model-aware vehicle artwork, charging and climate controls, and Recorder-backed location history in a single Home Assistant card.

## What it does

Each detected Tesla gets its own live vehicle screen with:

- Model-aware Tesla vehicle artwork for Model 3, Model Y, Model S, Model X, and Cybertruck
- Automatic vehicle and entity discovery
- Per-vehicle paint selection
- Battery percentage and range
- Charge limit, charging power, current, energy added, and time remaining when exposed
- Charging state and charging animation
- Lock and unlock state
- Climate state, HVAC mode, fan mode, cabin temperature, and outside temperature
- Sentry Mode
- Charge-port state
- Frunk and trunk state
- Window and individual door/window states when the integration exposes them
- Wake and refresh actions when available
- Flash, horn, and remote-start actions when available
- Frunk and trunk controls when available
- Charge-limit and charging-current controls when writable entities exist
- Live GPS coordinates and integration-provided location/address attributes
- Recorder-backed route history
- Estimated trip detection and trip summaries

Unsupported capabilities are omitted rather than replaced with fake controls.

## Installation

### HACS

**[Install Tesla Share from this GitHub repository](https://github.com/mattamays-ai/tesla-share-dashboard)**

1. Open the repository in GitHub.
2. In Home Assistant, open **HACS → Dashboard**.
3. Search for **Tesla Share** and select **Tesla Share**.
4. Select **Download**.
5. Refresh the Home Assistant frontend if prompted.
6. Add the card to a dashboard:

```yaml
type: custom:tesla-share-card
```

**HACS direct repository:**  
https://github.com/mattamays-ai/tesla-share-dashboard

If Tesla Share is not yet visible in your HACS catalog, add the GitHub repository as a **custom repository** with category **Dashboard**, then install it from HACS.

### Manual Home Assistant install

**[Open the JavaScript file on GitHub](https://github.com/mattamays-ai/tesla-share-dashboard/blob/main/tesla-share-card.js)**

1. Download `tesla-share-card.js` from the GitHub repository.
2. Copy it to:
   `/config/www/tesla-share-card.js`
3. In Home Assistant, go to **Settings → Dashboards → Resources**.
4. Add:

```yaml
url: /local/tesla-share-card.js
type: module
```

5. Refresh the Home Assistant frontend.
6. Add:

```yaml
type: custom:tesla-share-card
```

### GitHub files

- **[Repository](https://github.com/mattamays-ai/tesla-share-dashboard)**
- **[README](https://github.com/mattamays-ai/tesla-share-dashboard/blob/main/README.md)**
- **[Tesla Share card](https://github.com/mattamays-ai/tesla-share-dashboard/blob/main/tesla-share-card.js)**
- **[HACS configuration](https://github.com/mattamays-ai/tesla-share-dashboard/blob/main/hacs.json)**

### Requirements

- Home Assistant 2024.8.0 or newer
- A supported Tesla integration exposing the vehicle entities Tesla Share can discover
- Home Assistant Recorder for route and trip history

No build step or package installation is required.

## Configuration

The minimum configuration is:

```yaml
type: custom:tesla-share-card
```

Optional configuration:

```yaml
type: custom:tesla-share-card
history_days: 7
history_ttl_ms: 300000
colors:
  My Model Y: "#171A20"
```

### Configuration options

| Option | Default | Range | Purpose |
| --- | ---: | ---: | --- |
| `history_days` | 7 | 1-30 | Recorder history window |
| `history_ttl_ms` | 300000 | 60000-900000 | Recorder cache lifetime |
| `colors` | {} | Any | Per-vehicle paint colors |
| `vehicle_images` | {} | Any | Optional model-specific artwork URLs |

History is read from Home Assistant Recorder. It is not stored in browser localStorage.

## Automatic discovery

Tesla Share discovers entities through Home Assistant's WebSocket entity and device registries.

Supported platforms include:

- `tesla_custom`
- `tesla_fleet`

Entities are grouped by Home Assistant device and scored using domain, device class, name, capability, and state information. Unknown or unavailable candidates are deprioritized, and charge-port entities are prevented from being mistaken for the vehicle's primary lock.

This allows a single card to handle multiple Teslas without manually entering every entity ID.

## Vehicle artwork

Tesla Share uses model-aware vehicle artwork and falls back gracefully when remote artwork is unavailable.

- Model 3, Model Y, Model S, and Model X use official Tesla CDN artwork when available.
- Cybertruck and fallback models use built-in transparent SVG artwork.
- Paint selection uses lightweight CSS image treatment rather than a cross-origin SVG mask dependency.
- Remote artwork failures fall back to the built-in vehicle illustration.
- Artwork preserves a transparent vehicle-first presentation rather than placing a rectangular image over the card background.

Paint rendering is a visual approximation. It is not intended to reproduce an automotive paint formula exactly.

## Controls and command feedback

Tesla Share only exposes controls backed by discovered Home Assistant entities.

High-impact actions use an in-card confirmation flow:

- Unlock
- Honk
- Flash
- Remote start
- Open frunk
- Open trunk

Locking and closing actions do not require confirmation.

After a service call:

- **Vehicle state updated** means the selected state entity changed during the short observation window.
- **Command accepted · vehicle state pending** means Home Assistant accepted the service call but the selected state did not change during that observation window.
- **Command failed: ...** means Home Assistant rejected the service call and the card surfaces the bounded error.

The acknowledgement is deliberately not presented as proof that Tesla has completed the physical action.

## Charging and climate

When the integration exposes the required entities, Tesla Share provides:

- Charging status
- Charge limit
- Charging current
- HVAC mode
- Fan mode
- Cabin temperature
- Outside temperature
- Temperature selection and apply
- Charging power and energy information

Controls are capability-driven, so unavailable functions are not rendered as dead buttons.

## Location history and trips

Tesla Share can query Recorder history for the vehicle's `device_tracker`.

### Route history

The card can display:

- Current vehicle coordinates
- Integration-provided address/location attributes
- Full retained Recorder GPS route
- Route availability information when GPS data is missing

Set:

```yaml
history_days: 30
```

to inspect up to 30 days of retained Recorder history.

Actual history depends on Home Assistant Recorder retention and whether the Tesla integration records latitude/longitude attributes.

### Estimated trips

Recorder GPS points are converted into conservative estimated trips.

- Recorder gaps greater than 30 minutes create a new segment.
- Distance is estimated from consecutive GPS points using haversine distance.
- Legs below 0.05 km are ignored.
- Trips below 0.35 km are ignored.
- Up to 20 trips may be retained internally.
- The UI displays the latest 5 trips.
- Trip distance is an estimate from Recorder GPS points, not Tesla's odometer or official Tesla trip data.

The card labels these as **estimated trips** to keep that distinction explicit.

## State and units

Tesla Share follows the source entity wherever possible.

- Active charging uses green semantic treatment.
- Battery at or below 20% uses amber treatment.
- Heating uses red semantic treatment.
- Cooling uses blue semantic treatment.
- Open vehicle panels are shown as state information rather than invented faults.
- TPMS values use the source entity's native unit.
- TPMS warning color comes from the corresponding warning entity when available.
- Unknown and unavailable states remain visibly unavailable.
- Temperature units prefer the source entity/Home Assistant unit system.

No universal PSI threshold or guessed fault state is applied.

## Accessibility

The card includes:

- Native keyboard-accessible controls
- `aria-pressed` for toggles
- `aria-busy` while commands are pending
- `aria-live` command feedback
- Keyboard activation for interactive vehicle controls
- Focus-visible treatment
- Escape handling for menus and confirmations
- Reduced-motion support
- Descriptive image and SVG labels

## Performance and reliability

The card remains a single-file, no-build Home Assistant resource.

It uses:

- Render signatures to avoid unnecessary DOM replacement
- Input-focus deferral for active controls
- Cached Recorder history and trip calculations
- Registry and history retry/backoff behavior
- Capability scoring instead of fragile first-match entity selection
- Shadow DOM and delegated event handling
- CSS container queries where supported

There are no npm dependencies or build artifacts required for installation.

## Design philosophy

Tesla's product UI is the visual reference, not a pixel-for-pixel copy.

The card prioritizes:

1. The vehicle and its current state
2. Useful controls
3. Clear semantic feedback
4. Reliable Home Assistant integration
5. Location and history
6. Minimal decoration

The implementation intentionally avoids inventing vehicle capabilities or rendering controls that the connected integration cannot support.

## Development

The repository includes a local `preview.html` fixture for browser testing.

Start a local server:

```bash
python3 -m http.server 8631
```

Then open:

```
http://localhost:8631/preview.html?v=<incrementing-number>
```

The fixture mocks Home Assistant state, registries, Recorder history, and service calls.

Keep the registry mock and state mock synchronized because discovery is registry-driven.

### Basic release checks

```bash
node -e 'const fs=require("fs"); new Function(fs.readFileSync("tesla-share-card.js","utf8")); console.log("parser ok")'
node -e 'new Function("this is not valid js ((")'
git diff --check
LC_ALL=C grep -nP '[^\\x00-\\x7F]' tesla-share-card.js
git status --short
git diff --stat
```

The production JavaScript should remain ASCII-only.

## Project status

The current vehicle command center is maintained on `main`.

Current main includes the October 1, 2026 hardening work covering:

- State and unavailable handling
- Service-call acknowledgement
- Native unit handling
- Recorder route/trip terminology
- Vehicle artwork reliability
- Entity selection hardening
- Charge-port versus vehicle-lock matching
- Model-aware vehicle presentation
- Capability-driven controls

No new browser-suite result is claimed here unless the suite has been rerun against the current commit.

## License

See the repository license file for the project's current license terms.

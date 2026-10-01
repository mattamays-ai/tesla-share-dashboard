# Tesla Share

A Tesla-inspired Home Assistant vehicle command center for Tesla Custom and Tesla Fleet.

## Card

```yaml
type: custom:tesla-share-card
```

No image configuration is required. Tesla Share automatically uses built-in vehicle artwork based on the detected Tesla model.

Optional:

```yaml
type: custom:tesla-share-card
history_days: 7
colors:
  My Model Y: "#171A20"
```

## v3 vehicle command center

Each Tesla gets a live vehicle screen with:

- Built-in Model 3, Model Y, Model S, Model X, and Cybertruck artwork
- Automatic vehicle/model discovery
- Battery percentage, range, charge limit, charging power, amps, energy added, and time remaining
- Charging state and visual charging animation
- Lock state
- Climate state and cabin/outside temperature
- Sentry Mode
- Charge-port state
- Frunk and trunk state
- Windows state
- Individual door/window states when the Tesla integration exposes them
- Wake, refresh, flash, horn, and remote-start actions when available
- Charge-limit and charging-amp controls when available
- Live GPS coordinates and the integration's location/address attributes
- Recorder-backed location history with a route view

### Location history

The card queries Home Assistant Recorder history for the vehicle's `device_tracker` entity. Set:

```yaml
history_days: 30
```

to inspect up to 30 days of retained history.

The history is not stored in browser localStorage. It comes from Home Assistant, so it can survive browser changes and card reloads. Actual history length depends on Home Assistant Recorder retention and whether the Tesla integration records latitude/longitude attributes.

If GPS coordinates are not exposed by the selected Tesla integration, the live vehicle state still works and the history panel explains why route data is unavailable.

## Automatic discovery

Tesla Share discovers entities from `tesla_custom` and `tesla_fleet`, groups them by Home Assistant device, and only renders controls supported by the entities it finds.

That means one card can show multiple Teslas without manually entering entity IDs.

## HACS

Install the repository through HACS as a dashboard plugin, then add:

```yaml
type: custom:tesla-share-card
```

## Requirements

Home Assistant 2024.8.0 or newer, matching the HACS manifest.

## Design

Tesla's product UI is used as the design reference, not copied pixel-for-pixel. The goal is a restrained, vehicle-first experience inside Home Assistant while retaining Home Assistant's live state, controls, Recorder history, and integration-specific capabilities.

## Development

The v3 vehicle command center is developed on the `v3-vehicle-command-center` branch before review and merge into `main`.

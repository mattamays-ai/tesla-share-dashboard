# Tesla Share

A Tesla-inspired Home Assistant vehicle dashboard for Tesla Custom and Tesla Fleet.

The v2 card is intentionally designed around the visual language of the Tesla vehicle app: dark vehicle stage, large battery readout, restrained status information, compact vehicle actions, and charging controls.

## Card

```yaml
type: custom:tesla-share-card
colors:
  Model Y: "#171A20"
  Model 3: "#E82127"
images:
  Model Y: /local/tesla/model-y.png
  Model 3: /local/tesla/model-3.png
```

### Visual configuration

- `colors` accepts a Home Assistant device name or model key.
- Paint selections made in the card are remembered separately for each vehicle.
- `images` lets you use your own vehicle side-profile photo. The configured image is shown instead of the fallback SVG.
- Put photos in `/config/www/tesla/` so `/local/tesla/...` works.
- A dark, side-profile image with transparent or dark surroundings works best.

### What is shown

- Battery percentage and range
- Charging state, power, and time remaining when available
- Cabin and outside temperature
- Lock, climate, frunk, trunk, charge-port, windows, Sentry, horn, flash, wake, and refresh controls when the corresponding entities exist
- Charge limit and charging-amp sliders when exposed by the integration
- Per-vehicle paint selection

The card discovers Tesla entities from `tesla_custom` and `tesla_fleet` and groups them by Home Assistant device.

## Design direction

Tesla's product UI is used as the design reference, not copied pixel-for-pixel. The goal is a native-feeling Tesla experience inside Home Assistant while retaining Home Assistant's real-time entity state and controls.

## HACS

Install the repository through HACS as a dashboard plugin, then add:

```yaml
type: custom:tesla-share-card
```

## Requirements

Home Assistant 2024.8.0 or newer, matching the HACS manifest.

## Development

The active redesign lives on the `v2-tesla-app-ui` branch. `main` remains unchanged until the redesign is reviewed and tested on a real Home Assistant instance.

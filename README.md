# Tesla Share

One card. Every car on the Tesla integration. Nothing to rename.

Reads `tesla_custom` ([alandtse/tesla](https://github.com/alandtse/tesla)) and official `tesla_fleet`. Black field, Tesla red, app-blue on active controls. Styled inside the card, so it still looks right if the theme is not installed.

[![Open your Home Assistant instance and open a repository inside the Home Assistant Community Store.](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=mattamays-ai&repository=tesla-share-dashboard&category=plugin)
[![Open your Home Assistant instance and show your dashboard resources.](https://my.home-assistant.io/badges/lovelace_resources.svg)](https://my.home-assistant.io/redirect/lovelace_resources/)
[![Open your Home Assistant instance and show your Home Assistant dashboards.](https://my.home-assistant.io/badges/lovelace_dashboards.svg)](https://my.home-assistant.io/redirect/lovelace_dashboards/)

## Install with HACS

1. Open the HACS shortcut above, or use this link:
   [Add Tesla Share in HACS](https://my.home-assistant.io/redirect/hacs_repository/?owner=mattamays-ai&repository=tesla-share-dashboard&category=plugin)
2. Download **Tesla Share**
3. Hard refresh
4. Add a card → manual:

```yaml
type: custom:tesla-share-card
```

If the resource is missing, use the resources shortcut and add:

- URL: `/hacsfiles/tesla-share-dashboard/tesla-share-card.js`
- Type: JavaScript module

Older HACS uses `/local/community/tesla-share-dashboard/tesla-share-card.js`.

Manual path if the badge does not fire:

1. HACS → Frontend → three dots → Custom repositories
2. Paste `https://github.com/mattamays-ai/tesla-share-dashboard`
3. Category: **Dashboard**

## Install without HACS

1. Copy `tesla-share-card.js` to `/config/www/tesla-share-card.js`
2. [Open resources](https://my.home-assistant.io/redirect/lovelace_resources/) → Add resource
   - URL: `/local/tesla-share-card.js`
   - Type: JavaScript module
3. Hard refresh. Add the card above.

## Optional theme

`themes/tesla.yaml` paints the rest of Home Assistant the same way. Copy it to `/config/themes/tesla.yaml`. Needs:

```yaml
frontend:
  themes: !include_dir_merge_named themes
```

Reload themes. Profile → Theme → Tesla.

## What you get

One block per car, named from the device. Battery, range, cabin, outside, lock, climate, sentry, port, frunk, trunk, vent, wake, flash, honk, remote start, charge limit, amps, charge switch. Powerwall devices get their own block. Missing entities are skipped.

Wake, lock, climate, sentry, frunk, trunk, honk, and flash spend Tesla API quota.

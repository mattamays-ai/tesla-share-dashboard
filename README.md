# Tesla Share

One card. Every car on the Tesla integration. Nothing to rename.

Reads `tesla_custom` ([alandtse/tesla](https://github.com/alandtse/tesla)) and official `tesla_fleet`. Black field, Tesla red, app-blue on active controls. Styled inside the card, so it still looks right if the theme is not installed.

## Install with HACS

1. HACS → Frontend → three dots → Custom repositories
2. Paste `https://github.com/mattamays-ai/tesla-share-dashboard`
3. Category: **Dashboard**
4. Add, then download **Tesla Share**
5. Hard refresh
6. Add a card → manual:

```yaml
type: custom:tesla-share-card
```

HACS asks to add the resource. If it does not, add it yourself:

- URL: `/hacsfiles/tesla-share-dashboard/tesla-share-card.js`
- Type: JavaScript module

Older HACS uses `/local/community/tesla-share-dashboard/tesla-share-card.js`.

## Install without HACS

1. Copy `tesla-share-card.js` to `/config/www/tesla-share-card.js`
2. Settings → Dashboards → Resources → Add resource
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

# Tesla Share

One card. Every car on the Tesla integration. Nothing to rename.

[![Open your Home Assistant instance and open a repository inside the Home Assistant Community Store.](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=mattamays-ai&repository=tesla-share-dashboard&category=plugin)

```yaml
type: custom:tesla-share-card
colors:
  Model Y: "#E82127"
  Model 3: "#171A20"
images:
  Model Y: /local/tesla/model-y.png
  Model 3: /local/tesla/model-3.png
```

Keys are the Home Assistant device names. Dots under each car also set paint and remember it per car.

Put photos in `/config/www/tesla/` so `/local/tesla/...` works. Side profile on a dark field looks closest to the app.

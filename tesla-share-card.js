// Tesla Share — one card, every car on tesla_custom or tesla_fleet.
const PLATFORMS = new Set(["tesla_custom", "tesla_fleet"]);

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&" + "amp;")
    .replace(/</g, "&" + "lt;")
    .replace(/>/g, "&" + "gt;")
    .replace(/"/g, "&" + "quot;");
}

function listTesla(hass) {
  const reg = hass.entities || {};
  const out = [];
  for (const [id, meta] of Object.entries(reg)) {
    if (!meta || meta.hidden || !PLATFORMS.has(meta.platform)) continue;
    const state = hass.states?.[id];
    if (!state) continue;
    out.push({ id, platform: meta.platform, device_id: meta.device_id || null, state });
  }
  return out;
}

function deviceName(hass, deviceId) {
  const dev = deviceId && hass.devices ? hass.devices[deviceId] : null;
  return (dev && (dev.name_by_user || dev.name)) || "Tesla";
}

function isEnergy(entities) {
  const car = entities.some((e) => e.id.startsWith("lock.") || e.id.startsWith("climate."));
  if (car) return false;
  return entities.some((e) => /solar|grid_power|load_power|backup_reserve|powerwall/.test(e.id));
}

function find(entities, tests) {
  for (const test of tests) {
    const hit = entities.find(test);
    if (hit) return hit;
  }
  return null;
}
const ends = (sx) => (e) => sx.some((s) => e.id.endsWith(s));
const domain = (d) => (e) => e.id.startsWith(d + ".");
const dc = (name) => (e) => e.state?.attributes?.device_class === name;

function pick(entities) {
  return {
    battery: find(entities, [(e) => domain("sensor")(e) && dc("battery")(e) && !/powerwall|backup/.test(e.id), ends(["_battery", "_battery_level"])]),
    range: find(entities, [ends(["_battery_range", "_estimated_range"])]),
    charging: find(entities, [ends(["_charging_state", "_charging"])]),
    online: find(entities, [ends(["_online", "_status"]), dc("connectivity")]),
    asleep: find(entities, [ends(["_asleep"])]),
    inside: find(entities, [ends(["_temperature_inside", "_inside_temperature"])]),
    outside: find(entities, [ends(["_temperature_outside", "_outside_temperature"])]),
    lock: find(entities, [(e) => domain("lock")(e) && /door/.test(e.id) && !/charge|port|cable/.test(e.id), ends(["_doors", "_door_lock", "_lock"])]),
    climate: find(entities, [domain("climate")]),
    sentry: find(entities, [ends(["_sentry_mode"])]),
    port: find(entities, [ends(["_charger_door", "_charge_port_door"])]),
    frunk: find(entities, [ends(["_frunk"])]),
    trunk: find(entities, [ends(["_trunk", "_boot"])]),
    windows: find(entities, [ends(["_windows", "_vent_windows"])]),
    wake: find(entities, [ends(["_wake_up", "_wake"])]),
    flash: find(entities, [ends(["_flash_lights"])]),
    horn: find(entities, [ends(["_horn", "_honk_horn"])]),
    start: find(entities, [ends(["_remote_start", "_keyless_driving"])]),
    refresh: find(entities, [ends(["_force_data_update"])]),
    power: find(entities, [ends(["_charger_power"])]),
    added: find(entities, [ends(["_energy_added", "_charge_energy_added"])]),
    timeLeft: find(entities, [ends(["_time_charge_complete", "_time_to_full_charge"])]),
    chargeSwitch: find(entities, [(e) => domain("switch")(e) && ends(["_charger", "_charge"])(e)]),
    limit: find(entities, [ends(["_charge_limit"])]),
    amps: find(entities, [ends(["_charging_amps", "_charge_current"])]),
    tracker: find(entities, [ends(["_location_tracker", "_location"]), (e) => domain("device_tracker")(e) && !/destination|route/.test(e.id)]),
  };
}

function stateOf(hass, ent) {
  if (!ent) return "";
  return hass.states[ent.id]?.state ?? "";
}
function num(hass, ent) {
  const n = Number(stateOf(hass, ent));
  return Number.isFinite(n) ? n : null;
}

class TeslaShareCard extends HTMLElement {
  static getConfigElement() { return null; }
  setConfig(config) { this._config = config || {}; }
  set hass(hass) {
    this._hass = hass;
    this._render();
  }
  getCardSize() { return 8; }

  connectedCallback() {
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    this._render();
  }

  _call(domainName, service, entity, data) {
    if (!entity || !this._hass) return;
    this._hass.callService(domainName, service, { entity_id: entity.id, ...(data || {}) });
  }

  _toggleLock(ent) {
    const st = stateOf(this._hass, ent);
    this._call("lock", st === "locked" ? "unlock" : "lock", ent);
  }
  _toggleClimate(ent) {
    const st = stateOf(this._hass, ent);
    this._call("climate", st === "off" ? "turn_on" : "turn_off", ent);
  }
  _toggleSwitch(ent) {
    const st = stateOf(this._hass, ent);
    this._call("switch", st === "on" ? "turn_off" : "turn_on", ent);
  }
  _toggleCover(ent) {
    const st = stateOf(this._hass, ent);
    this._call("cover", st === "open" ? "close_cover" : "open_cover", ent);
  }
  _press(ent) { this._call("button", "press", ent); }

  _onClick(ev) {
    const btn = ev.target.closest("[data-act]");
    if (!btn || !this._cars) return;
    const car = this._cars[Number(btn.dataset.car)];
    const ent = car?.picked?.[btn.dataset.key];
    const act = btn.dataset.act;
    if (act === "lock") this._toggleLock(ent);
    else if (act === "climate") this._toggleClimate(ent);
    else if (act === "switch") this._toggleSwitch(ent);
    else if (act === "cover") this._toggleCover(ent);
    else if (act === "press") this._press(ent);
  }

  _onInput(ev) {
    const el = ev.target;
    if (!el.dataset.key || !this._cars) return;
    const car = this._cars[Number(el.dataset.car)];
    const ent = car?.picked?.[el.dataset.key];
    if (!ent) return;
    this._call("number", "set_value", ent, { value: Number(el.value) });
  }

  _ctrl(carIndex, key, label, act, on) {
    return `<button class="ctrl${on ? " on" : ""}" data-car="${carIndex}" data-key="${key}" data-act="${act}"><span>${esc(label)}</span></button>`;
  }

  _carHtml(car, index, hass) {
    const p = car.picked;
    const soc = num(hass, p.battery);
    const range = stateOf(hass, p.range);
    const unit = p.range ? hass.states[p.range.id]?.attributes?.unit_of_measurement || "" : "";
    const inside = stateOf(hass, p.inside);
    const outside = stateOf(hass, p.outside);
    const charging = stateOf(hass, p.charging) || "—";
    const online = stateOf(hass, p.online);
    const locked = stateOf(hass, p.lock) === "locked";
    const climateOn = p.climate && stateOf(hass, p.climate) !== "off";
    const sentryOn = stateOf(hass, p.sentry) === "on";
    const width = soc == null ? 0 : Math.max(0, Math.min(100, soc));
    const limit = num(hass, p.limit);
    const amps = num(hass, p.amps);
    const loc = p.tracker ? stateOf(hass, p.tracker) : "";

    const controls = [
      p.lock && this._ctrl(index, "lock", locked ? "Locked" : "Unlocked", "lock", locked),
      p.climate && this._ctrl(index, "climate", climateOn ? "Climate on" : "Climate", "climate", climateOn),
      p.sentry && this._ctrl(index, "sentry", "Sentry", "switch", sentryOn),
      p.port && this._ctrl(index, "port", "Port", "cover", stateOf(hass, p.port) === "open"),
      p.frunk && this._ctrl(index, "frunk", "Frunk", "cover", false),
      p.trunk && this._ctrl(index, "trunk", "Trunk", "cover", false),
      p.windows && this._ctrl(index, "windows", "Vent", "cover", false),
      p.wake && this._ctrl(index, "wake", "Wake", "press", false),
      p.flash && this._ctrl(index, "flash", "Flash", "press", false),
      p.horn && this._ctrl(index, "horn", "Honk", "press", false),
      p.start && this._ctrl(index, "start", "Start", "press", false),
      p.refresh && this._ctrl(index, "refresh", "Refresh", "press", false),
    ].filter(Boolean).join("");

    const sliders = [
      p.limit && `<label>Charge limit <b>${limit ?? "—"}%</b><input data-car="${index}" data-key="limit" type="range" min="50" max="100" value="${limit ?? 80}"></label>`,
      p.amps && `<label>Amps <b>${amps ?? "—"}</b><input data-car="${index}" data-key="amps" type="range" min="1" max="48" value="${amps ?? 5}"></label>`,
    ].filter(Boolean).join("");

    return `
      <article class="car">
        <header><b>${esc(car.name)}</b><span>${esc(charging)}</span></header>
        <div class="soc">${soc == null ? "—" : soc}<small>%</small></div>
        <div class="bar"><i style="width:${width}%"></i></div>
        <div class="meta">
          <span><b>${esc(range || "—")}</b> ${esc(unit)}</span>
          <span><b>${esc(inside || "—")}</b> cabin</span>
          <span><b>${esc(outside || "—")}</b> outside</span>
          ${online ? `<span><b>${esc(online)}</b></span>` : ""}
          ${loc ? `<span><b>${esc(loc)}</b></span>` : ""}
        </div>
        <div class="controls">${controls}</div>
        ${sliders ? `<div class="sliders">${sliders}</div>` : ""}
        <div class="rows">
          ${p.power ? `<div><span>Power</span><b>${esc(stateOf(hass, p.power))} ${esc(hass.states[p.power.id]?.attributes?.unit_of_measurement || "")}</b></div>` : ""}
          ${p.added ? `<div><span>Added</span><b>${esc(stateOf(hass, p.added))}</b></div>` : ""}
          ${p.timeLeft ? `<div><span>Time left</span><b>${esc(stateOf(hass, p.timeLeft))}</b></div>` : ""}
          ${p.chargeSwitch ? `<div><span>Charge</span><b>${esc(stateOf(hass, p.chargeSwitch))}</b></div>` : ""}
        </div>
      </article>`;
  }

  _render() {
    if (!this.shadowRoot || !this._hass) return;
    const hass = this._hass;
    const all = listTesla(hass);
    const byDevice = new Map();
    for (const ent of all) {
      const key = ent.device_id || ent.id;
      if (!byDevice.has(key)) byDevice.set(key, []);
      byDevice.get(key).push(ent);
    }
    this._cars = [];
    const sites = [];
    for (const [deviceId, entities] of byDevice) {
      if (isEnergy(entities)) sites.push({ name: deviceName(hass, deviceId), entities });
      else this._cars.push({ name: deviceName(hass, deviceId), picked: pick(entities) });
    }

    const body = this._cars.length
      ? this._cars.map((car, i) => this._carHtml(car, i, hass)).join("")
      : `<article class="car"><p class="empty">No Tesla cars yet. Add Tesla Custom or Tesla Fleet, then reload.</p></article>`;
    const energy = sites.map((site) => {
      const rows = site.entities.filter((e) => e.id.startsWith("sensor.")).slice(0, 8)
        .map((e) => `<div><span>${esc(e.state.attributes.friendly_name || e.id)}</span><b>${esc(e.state.state)}</b></div>`).join("");
      return `<article class="car"><header><b>${esc(site.name)}</b><span>Energy</span></header><div class="rows">${rows}</div></article>`;
    }).join("");

    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; }
        .wrap { background: #000; color: #fff; border-radius: 18px; padding: 8px; font-family: Inter, "Helvetica Neue", Helvetica, Arial, sans-serif; letter-spacing: -0.02em; }
        .car { background: #171717; border: 1px solid #242424; border-radius: 16px; padding: 16px; margin: 8px; }
        header { display: flex; justify-content: space-between; align-items: baseline; }
        header b { font-size: 18px; font-weight: 580; }
        header span, .meta { color: #9a9a9e; font-size: 13px; }
        .soc { font-size: 64px; line-height: .9; font-weight: 560; margin: 10px 0 6px; }
        .soc small { font-size: 22px; color: #9a9a9e; }
        .bar { height: 6px; background: #2c2c2e; border-radius: 99px; overflow: hidden; }
        .bar i { display: block; height: 100%; background: linear-gradient(90deg, #e82127, #fff 42%); }
        .meta { display: flex; flex-wrap: wrap; gap: 14px; margin: 10px 0 14px; }
        .meta b { color: #fff; font-weight: 560; }
        .controls { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
        .ctrl { background: #111; color: #fff; border: 1px solid #2a2a2a; border-radius: 14px; padding: 14px 8px; font: inherit; cursor: pointer; }
        .ctrl.on { border-color: #3e6ae1; }
        .sliders { margin-top: 14px; display: grid; gap: 10px; }
        label { display: grid; grid-template-columns: 1fr auto; gap: 8px; color: #9a9a9e; font-size: 13px; }
        label b { color: #fff; }
        input[type=range] { grid-column: 1 / -1; accent-color: #e82127; width: 100%; }
        .rows { margin-top: 12px; }
        .rows div { display: flex; justify-content: space-between; padding: 7px 0; border-top: 1px solid #242424; font-size: 14px; }
        .rows span { color: #9a9a9e; }
        .empty { color: #9a9a9e; line-height: 1.4; }
      </style>
      <div class="wrap">${body}${energy}</div>`;
    this.shadowRoot.querySelector(".wrap").onclick = (ev) => this._onClick(ev);
    this.shadowRoot.querySelector(".wrap").onchange = (ev) => this._onInput(ev);
  }
}

customElements.define("tesla-share-card", TeslaShareCard);
window.customCards = window.customCards || [];
window.customCards.push({
  type: "tesla-share-card",
  name: "Tesla Share",
  description: "Every Tesla on tesla_custom or tesla_fleet. No entity ids.",
});

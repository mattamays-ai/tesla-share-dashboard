// Tesla Share - every Tesla, as a card or Tesla-style dashboard.
const PLATFORMS = new Set(["tesla_custom", "tesla_fleet"]);
const VEHICLE_IMGS={
  "model 3":"https://digitalassets.tesla.com/tesla-contents/image/upload/e_bgremoval,f_png,q_auto:best,w_900/Meet-Your-Tesla_Model-3.jpg",
  "model y":"https://digitalassets.tesla.com/tesla-contents/image/upload/e_bgremoval,f_png,q_auto:best,w_900/Meet-Your-Tesla_Model-Y.jpg",
  "model s":"https://digitalassets.tesla.com/tesla-contents/image/upload/e_bgremoval,f_png,q_auto:best,w_900/Meet-Your-Tesla_Model-S.jpg",
  "model x":"https://digitalassets.tesla.com/tesla-contents/image/upload/e_bgremoval,f_png,q_auto:best,w_900/Meet-Your-Tesla_Model-X.jpg"
};

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&" + "amp;")
    .replace(/</g, "&" + "lt;")
    .replace(/>/g, "&" + "gt;")
    .replace(/"/g, "&" + "quot;");
}
function escAttr(value){return esc(value).replace(/'/g,"&"+"#39;")}
function unitOf(hass,ent,fallback=""){return ent?(hass.states?.[ent.id]?.attributes?.unit_of_measurement||fallback):fallback}
function unavailable(hass,ent){return !!ent&&/^(unavailable|unknown)$/i.test(stateOf(hass,ent))}

async function loadTeslaRegistry(hass) {
  if (!hass?.callWS) return { entities: [], devices: {} };

  // Use the compact display registry first, but fall back to the full entity
  // registry. Discovery must not fail just because one registry endpoint is
  // unavailable or returns a slightly different response shape.
  const entityResponse = await (async () => {
    try {
      const result = await hass.callWS({ type: "config/entity_registry/list_for_display" });
      const entities = Array.isArray(result)
        ? result
        : (result?.entities || result?.result?.entities || []);
      if (entities.length) return entities;
    } catch (_) {}
    try {
      const result = await hass.callWS({ type: "config/entity_registry/list" });
      return Array.isArray(result)
        ? result
        : (result?.entities || result?.result?.entities || []);
    } catch (_) {
      return [];
    }
  })();

  let rawDevices = [];
  try {
    const result = await hass.callWS({ type: "config/device_registry/list" });
    rawDevices = Array.isArray(result)
      ? result
      : (result?.devices || result?.result?.devices || []);
  } catch (_) {
    rawDevices = [];
  }

  const entities = entityResponse
    .map((meta) => {
      const id = meta?.ei || meta?.entity_id || null;
      const state = meta?.ei ? hass.states?.[meta.ei] : hass.states?.[meta?.entity_id];
      const platform = String(meta?.pl || meta?.platform || "").toLowerCase();
      const attribution = String(state?.attributes?.attribution || "");
      const teslaEntityDomain = /^(binary_sensor|button|climate|cover|device_tracker|lock|number|select|sensor|switch)\./i.test(String(id || ""));
      const teslaEntityName = String(id || "").toLowerCase().includes("tesla");
      const teslaSignature = String(attribution).toLowerCase().includes("tesla") || (teslaEntityDomain && teslaEntityName);
      return {
        id,
        platform,
        device_id: meta?.di || meta?.device_id || null,
        name: meta?.en || meta?.name || "",
        state,
        teslaSignature,
      };
    })
    .filter((e) => e.id && e.state && (PLATFORMS.has(e.platform) || e.teslaSignature));

  const devices = {};
  for (const device of rawDevices) {
    if (device?.id) devices[device.id] = device;
  }

  return { entities, devices };
}

function deviceName(registry, deviceId) {
  const dev = deviceId && registry?.devices?.[deviceId];
  return (dev && (dev.name_by_user || dev.name)) || "Tesla";
}

function pick(entities) {
  const text = e => (e.id + " " + (e.name || "") + " " + (e.state?.attributes?.friendly_name || "")).toLowerCase();
  const best = (tests, penalties = [], filter = null) => {
    let winner = null, bestScore = -Infinity;
    for (const e of (filter ? entities.filter(filter) : entities)) {
      const t = text(e);
      if (penalties.some(re => re.test(t))) continue;
      let score = 0;
      for (const test of tests) score += test(e, t);
      if (/^(unavailable|unknown)$/i.test(e.state?.state||"")) score -= 8;
      if (score > bestScore) { bestScore = score; winner = e; }
    }
    return bestScore > 0 ? winner : null;
  };
  const rx = re => (e,t) => re.test(t) ? 5 : 0;
  const suffix = sx => (e) => sx.some(s => e.id.endsWith(s)) ? 7 : 0;
  const dom = d => (e) => e.id.startsWith(d + ".") ? 6 : 0;
  const cls = name => (e) => e.state?.attributes?.device_class === name ? 8 : 0;
  return {
    battery: best([rx(/battery.*(?:level|percent|percentage|soc)|state.*of.*charge/),suffix(["_battery","_battery_level"]),cls("battery")], [/powerwall|backup|solar|range/]),
    range: best([rx(/battery.*range|estimated.*range|range.*battery/),suffix(["_battery_range","_estimated_range"])], [/powerwall|backup|solar/]),
    charging: best([rx(/charging.*state|charge.*state/),suffix(["_charging_state","_charging"])], [/powerwall|backup|solar/]),
    online: best([rx(/online|connectivity|vehicle.*status/),cls("connectivity"),suffix(["_online","_status"])], [/route|destination/]),
    asleep: best([rx(/asleep|sleeping/),suffix(["_asleep"])]),
    seatLeft: best([rx(/heated.*seat|seat.*heat/),rx(/left/)],[/rear/],(e)=>/^(select|switch)$/.test(domainOf(e))&&/(heated.*seat|seat.*heat)/.test(text(e))),
    seatRight: best([rx(/heated.*seat|seat.*heat/),rx(/right/)],[/rear/],(e)=>/^(select|switch)$/.test(domainOf(e))&&/(heated.*seat|seat.*heat)/.test(text(e))),
    seatRL: best([rx(/seat.*heat|heated.*seat/),rx(/left/)],[/front/],(e)=>/^(select|switch)$/.test(domainOf(e))&&/rear/.test(text(e))&&/(heated.*seat|seat.*heat)/.test(text(e))),
    seatRC: best([rx(/seat.*heat|heated.*seat/),rx(/center|middle/)],[/front/],(e)=>/^(select|switch)$/.test(domainOf(e))&&/rear/.test(text(e))&&/(heated.*seat|seat.*heat)/.test(text(e))),
    seatRR: best([rx(/seat.*heat|heated.*seat/),rx(/right/)],[/front|third/],(e)=>/^(select|switch)$/.test(domainOf(e))&&/rear/.test(text(e))&&!/third/.test(text(e))&&/(heated.*seat|seat.*heat)/.test(text(e))),
    seat3L: best([rx(/seat.*heat|heated.*seat/),rx(/left/)],[/front/],(e)=>/^(select|switch)$/.test(domainOf(e))&&/(third.*row|row.*third)/.test(text(e))&&/(heated.*seat|seat.*heat)/.test(text(e))),
    seat3R: best([rx(/seat.*heat|heated.*seat/),rx(/right/)],[/front/],(e)=>/^(select|switch)$/.test(domainOf(e))&&/(third.*row|row.*third)/.test(text(e))&&/(heated.*seat|seat.*heat)/.test(text(e))),
    steering: best([rx(/steering/),rx(/heat|wheel/)],[],(e)=>/^(switch|button)$/.test(domainOf(e))&&/steering/.test(text(e))),
    odometer: best([rx(/odometer/),suffix(["_odometer"])]),
    parkingBrake: best([rx(/parking.*brake/),suffix(["_parking_brake"])]),
    shift: best([rx(/shift.*state|gear/),suffix(["_shift_state"])]),
    schedCharging: best([rx(/scheduled.*charg/)]),
    schedDeparture: best([rx(/scheduled.*depart/)]),
    chargeTime: best([rx(/time.*charge.*complete|charge.*complete/)]),
    chargeRate: best([rx(/charging.*rate|charge.*rate/)]),
    energyAdded: best([rx(/energy.*added/)]),
    charger: best([rx(/charger.*connection|charging.*connector/),suffix(["_charger"])]),
    userPresent: best([rx(/user.*present/)]),
    arrival: best([rx(/arrival.*time|time.*arrival/)]),
    distanceArrival: best([rx(/distance.*arrival|arrival.*distance/)]),
    tpmsFL: best([rx(/tpms.*front.*left|tire.*pressure.*front.*left|front.*left.*(tire|tpms)/)]),
    tpmsFR: best([rx(/tpms.*front.*right|tire.*pressure.*front.*right|front.*right.*(tire|tpms)/)]),
    tpmsRL: best([rx(/tpms.*rear.*left|tire.*pressure.*rear.*left|rear.*left.*(tire|tpms)/)]),
    tpmsRR: best([rx(/tpms.*rear.*right|tire.*pressure.*rear.*right|rear.*right.*(tire|tpms)/)]),
    tpmsWarnFL: best([rx(/tire.*pressure.*warning.*front.*left|front.*left.*tire.*warning/)]),
    tpmsWarnFR: best([rx(/tire.*pressure.*warning.*front.*right|front.*right.*tire.*warning/)]),
    tpmsWarnRL: best([rx(/tire.*pressure.*warning.*rear.*left|rear.*left.*tire.*warning/)]),
    tpmsWarnRR: best([rx(/tire.*pressure.*warning.*rear.*right|rear.*right.*tire.*warning/)]),
    inside: best([rx(/inside.*temperature|cabin.*temperature|interior.*temperature/),suffix(["_temperature_inside","_inside_temperature"])]),
    outside: best([rx(/outside.*temperature|exterior.*temperature/),suffix(["_temperature_outside","_outside_temperature"])]),
    lock: best([rx(/door.*lock|vehicle.*lock/),suffix(["_doors","_door_lock","_vehicle_lock","_lock"])], [/charge.*cable|charge.*port.*latch|charge.*port.*door|charge.*lock/]),
    climate: best([dom("climate"),rx(/climate|hvac/)]),
    sentry: best([rx(/sentry/),suffix(["_sentry_mode"])]),
    port: best([rx(/charge.*port.*door|charger.*door/),suffix(["_charger_door","_charge_port_door"]),dom("cover")], [/frunk|trunk|boot|window|sunroof/]),
    portOpen: best([rx(/charge.*port.*open|charger.*door.*open/),suffix(["_charge_port_open","_charger_door_open"])]),
    portClose: best([rx(/charge.*port.*close|charger.*door.*close/),suffix(["_charge_port_close","_charger_door_close"])]),
    frunk: best([rx(/frunk/),suffix(["_frunk"]),dom("cover")], [/charge.*port|trunk|boot|window|sunroof/]),
    trunk: best([rx(/trunk|boot/),suffix(["_trunk","_boot"]),dom("cover")], [/frunk|charge.*port|window|sunroof/]),
    windows: best([rx(/windows|window.*state/),suffix(["_windows","_vent_windows"]),dom("cover")], [/charge.*port|frunk|trunk|boot|sunroof/]),
    doorDriver: best([rx(/driver.*door|left.*front.*door|front.*left.*door/)]),
    doorPassenger: best([rx(/passenger.*door|right.*front.*door|front.*right.*door/)]),
    doorRearDriver: best([rx(/rear.*driver.*door|driver.*rear.*door|rear.*left.*door|left.*rear.*door/)]),
    doorRearPassenger: best([rx(/rear.*passenger.*door|passenger.*rear.*door|rear.*right.*door|right.*rear.*door/)]),
    windowDriver: best([rx(/driver.*window|left.*front.*window|front.*left.*window/)]),
    windowPassenger: best([rx(/passenger.*window|right.*front.*window|front.*right.*window/)]),
    windowRearDriver: best([rx(/rear.*driver.*window|driver.*rear.*window|rear.*left.*window|left.*rear.*window/)]),
    windowRearPassenger: best([rx(/rear.*passenger.*window|passenger.*rear.*window|rear.*right.*window|right.*rear.*window/)]),
    wake: best([rx(/wake/),suffix(["_wake_up","_wake"])]),
    flash: best([rx(/flash.*light|lights.*flash/),suffix(["_flash_lights"])]),
    horn: best([rx(/horn|honk/),suffix(["_horn","_honk_horn"])]),
    start: best([rx(/remote.*start|keyless/),suffix(["_remote_start","_keyless_driving"])]),
    refresh: best([rx(/force.*data.*update|refresh/),suffix(["_force_data_update"])]),
    power: best([rx(/charger.*power|charging.*power/),suffix(["_charger_power"])]),
    added: best([rx(/energy.*added|charge.*energy.*added/),suffix(["_energy_added","_charge_energy_added"])]),
    timeLeft: best([rx(/time.*charge|time.*full|charge.*complete/),suffix(["_time_charge_complete","_time_to_full_charge","_minutes_to_full_charge"])]),
    chargeSwitch: best([rx(/charger|charging|charge.*switch/),suffix(["_charger","_charge"]),dom("switch")], [/sentry|defrost|seat|steering|polling|valet/],(e)=>domainOf(e)==="switch"),
    limit: best([rx(/charge.*limit/),suffix(["_charge_limit"]),dom("number")], [/current|amps|power|backup|reserve/]),
    amps: best([rx(/charging.*amps|charge.*current/),suffix(["_charging_amps","_charge_current"]),dom("number")], [/limit|backup|reserve/]),
    tracker: best([rx(/location|vehicle/),dom("device_tracker")], [/destination|route/]),
  };
}

function haversine(a,b){const R=6371,rad=Math.PI/180,dLat=(b.lat-a.lat)*rad,dLon=(b.lon-a.lon)*rad,q=Math.sin(dLat/2)**2+Math.cos(a.lat*rad)*Math.cos(b.lat*rad)*Math.sin(dLon/2)**2;return R*2*Math.atan2(Math.sqrt(q),Math.sqrt(Math.max(0,1-q)))}
function historyPoints(rows){return (rows||[]).map(x=>{const a=x.attributes||{},lat=Number(a.latitude),lon=Number(a.longitude),t=new Date(x.last_changed||x.last_updated||0).getTime();return Number.isFinite(lat)&&Number.isFinite(lon)&&Number.isFinite(t)?{lat,lon,t,state:x.state,attrs:a}:null}).filter(Boolean).sort((a,b)=>a.t-b.t)}
function detectTrips(rows){const pts=historyPoints(rows),trips=[],MAX_GAP=1800000,MIN_DISTANCE=.35;let current=[],distance=0;const finish=()=>{if(current.length<2){current=[];distance=0;return}if(distance>=MIN_DISTANCE){const first=current[0],last=current[current.length-1];trips.push({points:current.slice(),distance,start:first.t,end:last.t,duration:last.t-first.t})}current=[];distance=0};for(let i=0;i<pts.length;i++){const p=pts[i],prev=pts[i-1];if(!prev||p.t-prev.t>MAX_GAP){finish();current=[p];continue}const d=haversine(prev,p);if(d>.05)distance+=d;current.push(p)}finish();return trips.slice(-20).reverse()}
function fmtDistance(km){if(!Number.isFinite(km))return "-";return km<1?Math.round(km*1000)+" m":(km<10?km.toFixed(1):Math.round(km))+" km"}
function fmtDuration(ms){if(!Number.isFinite(ms)||ms<0)return "-";const min=Math.round(ms/60000),h=Math.floor(min/60),m=min%60;return h?h+"h "+m+"m":m+"m"}
function fmtTime(ts){if(!ts)return "-";return new Date(ts).toLocaleTimeString([], {hour:"numeric",minute:"2-digit"})}
function stateOf(hass, ent) {
  if (!ent) return "";
  return hass.states[ent.id]?.state ?? "";
}
function num(hass, ent) {
  const n = Number(stateOf(hass, ent));
  return Number.isFinite(n) ? n : null;
}


function vehicleModel(hass, registry, deviceId, entities) {
  const d = registry?.devices?.[deviceId] || {};
  const text = [d.model,d.name,d.name_by_user,...entities.map(e=>(e.state?.attributes?.model||"")+" "+e.id)].filter(Boolean).join(" ").replace(/[_-]+/g," ");
  return ["Model 3","Model Y","Model S","Model X","Cybertruck","Roadster"].find(m=>new RegExp("\\b"+m.replace(" ","\\s+")+"\\b","i").test(text)) || "Tesla";
}
function coords(hass, ent) {
  const a = ent ? hass.states?.[ent.id]?.attributes || {} : {};
  const lat=Number(a.latitude), lon=Number(a.longitude);
  return Number.isFinite(lat)&&Number.isFinite(lon)?{lat,lon}:null;
}
function titleState(s){const x=String(s||"").replace(/_/g," ");return x?x[0].toUpperCase()+x.slice(1):"Unknown";}
function openState(s){return /^(open|opening|on|true|unlocked|vented)$/i.test(String(s));}
function domainOf(ent){return ent?.id?.split(".")[0]||""}
function readableState(hass,ent,closed="Closed"){const s=stateOf(hass,ent);if(!s)return "Unknown";if(/^(closed|off|false)$/i.test(s))return closed;return titleState(s)}
const TESLA_PAINTS={
  "cybertruck":[["Stainless Steel","#b0b2ac"],["Stealth Grey Wrap","#43474b"],["Satin White Wrap","#e8e6e1"]],
  "model x":[["Pearl White Multi-Coat","#f0ece4"],["Solid Black","#16181a"],["Stealth Grey","#43474b"],["Deep Blue Metallic","#2a4a78"],["Ultra Red","#b8201a"],["Midnight Cherry Red","#5a1020"],["Lunar Silver","#cbcdcd"]],
  "model s":[["Pearl White Multi-Coat","#f0ece4"],["Solid Black","#16181a"],["Stealth Grey","#43474b"],["Deep Blue Metallic","#2a4a78"],["Ultra Red","#b8201a"],["Midnight Cherry Red","#5a1020"],["Lunar Silver","#cbcdcd"]],
  "model 3":[["Pearl White Multi-Coat","#f0ece4"],["Solid Black","#16181a"],["Stealth Grey","#43474b"],["Deep Blue Metallic","#2a4a78"],["Ultra Red","#b8201a"],["Quicksilver","#6e7377"],["Frost Blue Metallic","#c8d8e2"]],
  "roadster":[["Signature Red","#8f1017"],["Solid Black","#16181a"],["Glacier Blue","#7f9cab"]],
  "model y":[["Pearl White Multi-Coat","#f0ece4"],["Solid Black","#16181a"],["Stealth Grey","#43474b"],["Deep Blue Metallic","#2a4a78"],["Ultra Red","#b8201a"],["Quicksilver","#6e7377"],["Frost Blue Metallic","#c8d8e2"]]
};
const TESLA_PAINTS_DEFAULT=TESLA_PAINTS["model 3"];
const TPMS_ART_SEDAN='<defs><radialGradient id="tpms-spot-sedan" cx="50%" cy="46%" r="52%"><stop offset="0%" stop-color="#ffffff" stop-opacity=".07"/><stop offset="100%" stop-color="#ffffff" stop-opacity="0"/></radialGradient>'
      +'<linearGradient id="tpms-body-sedan" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#33383f"/><stop offset="45%" stop-color="#1d2126"/><stop offset="100%" stop-color="#292e35"/></linearGradient></defs>'
      +'<ellipse cx="320" cy="278" rx="230" ry="260" fill="url(#tpms-spot-sedan)"/>'
      +'<rect x="240" y="80" width="28" height="66" rx="10" fill="#050607" stroke="#4a5058" stroke-width="2"/>'
      +'<rect x="372" y="80" width="28" height="66" rx="10" fill="#050607" stroke="#4a5058" stroke-width="2"/>'
      +'<rect x="240" y="398" width="28" height="66" rx="10" fill="#050607" stroke="#4a5058" stroke-width="2"/>'
      +'<rect x="372" y="398" width="28" height="66" rx="10" fill="#050607" stroke="#4a5058" stroke-width="2"/>'
      +'<rect x="244" y="90" width="20" height="46" rx="7" fill="none" stroke="#6a7076" stroke-width="1.5" opacity=".55"/>'
      +'<rect x="376" y="90" width="20" height="46" rx="7" fill="none" stroke="#6a7076" stroke-width="1.5" opacity=".55"/>'
      +'<rect x="244" y="408" width="20" height="46" rx="7" fill="none" stroke="#6a7076" stroke-width="1.5" opacity=".55"/>'
      +'<rect x="376" y="408" width="20" height="46" rx="7" fill="none" stroke="#6a7076" stroke-width="1.5" opacity=".55"/>'
      +'<path d="M259 182l-23 8v10l23 2z" fill="#8a9096"/><path d="M381 182l23 8v10l-23 2z" fill="#8a9096"/>'
      +'<path d="M320 38C288 38 270 56 265 90C260 150 257 260 259 340C260 420 264 480 278 502C288 514 302 518 320 518C338 518 352 514 362 502C376 480 380 420 381 340C383 260 380 150 375 90C370 56 352 38 320 38Z" fill="url(#tpms-body-sedan)" stroke="#3e444c" stroke-width="1.5"/>'
      +'<path d="M290 174Q320 182 350 174L344 142Q320 130 296 142Z" fill="#0e1013"/>'
      +'<rect x="296" y="178" width="48" height="120" rx="10" fill="#101317" stroke="#262b31" stroke-width="1"/>'
      +'<path d="M296 302L344 302Q346 330 334 344Q320 350 306 344Q294 330 296 302Z" fill="#0e1013"/>'
      +'<path d="M294 106Q320 98 346 106" stroke="#5a6068" stroke-width="2" fill="none" opacity=".5"/>'
      +'<path d="M294 462Q320 470 346 462" stroke="#5a6068" stroke-width="2" fill="none" opacity=".5"/>'
      +'<path d="M268 96C265 160 263 260 264 336" stroke="#ffffff" stroke-width="1.5" fill="none" opacity=".12"/>'
      +'<path d="M372 96C375 160 377 260 376 336" stroke="#000000" stroke-width="2" fill="none" opacity=".3"/>'
      +'<path d="M313 62q7-5 14 0M320 58v9" stroke="#9aa0a6" stroke-width="1.5" fill="none" opacity=".7"/>';
const TPMS_ART_SUV='<defs><radialGradient id="tpms-spot-suv" cx="50%" cy="46%" r="52%"><stop offset="0%" stop-color="#ffffff" stop-opacity=".07"/><stop offset="100%" stop-color="#ffffff" stop-opacity="0"/></radialGradient>'
      +'<linearGradient id="tpms-body-suv" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#33383f"/><stop offset="45%" stop-color="#1d2126"/><stop offset="100%" stop-color="#292e35"/></linearGradient></defs>'
      +'<ellipse cx="320" cy="278" rx="230" ry="260" fill="url(#tpms-spot-suv)"/>'
      +'<rect x="232" y="78" width="28" height="68" rx="10" fill="#050607" stroke="#4a5058" stroke-width="2"/>'
      +'<rect x="380" y="78" width="28" height="68" rx="10" fill="#050607" stroke="#4a5058" stroke-width="2"/>'
      +'<rect x="232" y="396" width="28" height="68" rx="10" fill="#050607" stroke="#4a5058" stroke-width="2"/>'
      +'<rect x="380" y="396" width="28" height="68" rx="10" fill="#050607" stroke="#4a5058" stroke-width="2"/>'
      +'<rect x="236" y="88" width="20" height="48" rx="7" fill="none" stroke="#6a7076" stroke-width="1.5" opacity=".55"/>'
      +'<rect x="384" y="88" width="20" height="48" rx="7" fill="none" stroke="#6a7076" stroke-width="1.5" opacity=".55"/>'
      +'<rect x="236" y="406" width="20" height="48" rx="7" fill="none" stroke="#6a7076" stroke-width="1.5" opacity=".55"/>'
      +'<rect x="384" y="406" width="20" height="48" rx="7" fill="none" stroke="#6a7076" stroke-width="1.5" opacity=".55"/>'
      +'<path d="M250 178l-26 9v11l26 3z" fill="#8a9096"/><path d="M390 178l26 9v11l-26 3z" fill="#8a9096"/>'
      +'<path d="M320 34C286 34 266 50 262 82C255 152 252 272 254 352C255 430 259 490 273 507C284 518 301 522 320 522C339 522 356 518 367 507C381 490 385 430 386 352C388 272 385 152 378 82C374 50 354 34 320 34Z" fill="url(#tpms-body-suv)" stroke="#3e444c" stroke-width="1.5"/>'
      +'<path d="M284 174Q320 180 356 174L349 138Q320 126 291 138Z" fill="#0e1013"/>'
      +'<rect x="293" y="178" width="54" height="122" rx="10" fill="#101317" stroke="#262b31" stroke-width="1"/>'
      +'<path d="M291 302L349 302Q350 332 337 346Q320 353 303 346Q290 332 291 302Z" fill="#0e1013"/>'
      +'<path d="M292 104Q320 96 348 104" stroke="#5a6068" stroke-width="2" fill="none" opacity=".5"/>'
      +'<path d="M292 464Q320 472 348 464" stroke="#5a6068" stroke-width="2" fill="none" opacity=".5"/>'
      +'<path d="M268 94C264 162 262 264 263 340" stroke="#ffffff" stroke-width="1.5" fill="none" opacity=".12"/>'
      +'<path d="M372 94C376 162 378 264 377 340" stroke="#000000" stroke-width="2" fill="none" opacity=".3"/>'
      +'<path d="M313 60q7-5 14 0M320 56v9" stroke="#9aa0a6" stroke-width="1.5" fill="none" opacity=".7"/>';
const TPMS_ART_CYBER='<defs><radialGradient id="tpms-spot-cyber" cx="50%" cy="46%" r="52%"><stop offset="0%" stop-color="#ffffff" stop-opacity=".07"/><stop offset="100%" stop-color="#ffffff" stop-opacity="0"/></radialGradient>'
      +'<linearGradient id="tpms-body-cyber" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#7e858c"/><stop offset="45%" stop-color="#474d53"/><stop offset="100%" stop-color="#5b6167"/></linearGradient></defs>'
      +'<ellipse cx="320" cy="278" rx="230" ry="260" fill="url(#tpms-spot-cyber)"/>'
      +'<rect x="228" y="76" width="38" height="70" rx="6" fill="#050607" stroke="#4a5058" stroke-width="2"/>'
      +'<rect x="374" y="76" width="38" height="70" rx="6" fill="#050607" stroke="#4a5058" stroke-width="2"/>'
      +'<rect x="228" y="394" width="38" height="70" rx="6" fill="#050607" stroke="#4a5058" stroke-width="2"/>'
      +'<rect x="374" y="394" width="38" height="70" rx="6" fill="#050607" stroke="#4a5058" stroke-width="2"/>'
      +'<rect x="234" y="86" width="24" height="50" rx="4" fill="none" stroke="#8a9096" stroke-width="1.5" opacity=".6"/>'
      +'<rect x="382" y="86" width="24" height="50" rx="4" fill="none" stroke="#8a9096" stroke-width="1.5" opacity=".6"/>'
      +'<rect x="234" y="404" width="24" height="50" rx="4" fill="none" stroke="#8a9096" stroke-width="1.5" opacity=".6"/>'
      +'<rect x="382" y="404" width="24" height="50" rx="4" fill="none" stroke="#8a9096" stroke-width="1.5" opacity=".6"/>'
      +'<path d="M254 176l-27 10v10l27 2z" fill="#9aa0a6"/><path d="M386 176l27 10v10l-27 2z" fill="#9aa0a6"/>'
      +'<path d="M320 30L268 54L258 96L254 340L260 470L272 506L368 506L380 470L386 340L382 96L372 54Z" fill="url(#tpms-body-cyber)" stroke="#22262a" stroke-width="1.5"/>'
      +'<path d="M280 172L360 172L346 130L320 122L294 130Z" fill="#0e1013"/>'
      +'<path d="M292 176L348 176L344 300L296 300Z" fill="#101317" stroke="#262b31" stroke-width="1"/>'
      +'<path d="M292 302L348 302L344 346L296 346Z" fill="#0e1013"/>'
      +'<path d="M292 102L348 102" stroke="#5a6068" stroke-width="2" fill="none" opacity=".5"/>'
      +'<path d="M292 462L348 462" stroke="#5a6068" stroke-width="2" fill="none" opacity=".5"/>'
      +'<path d="M266 98L262 338" stroke="#ffffff" stroke-width="1.5" fill="none" opacity=".12"/>'
      +'<path d="M374 98L378 338" stroke="#000000" stroke-width="2" fill="none" opacity=".3"/>'
      +'<path d="M312 64h16l-8-14z" fill="#9aa0a6" opacity=".7"/>';
const TESLA_CARD_CSS=":host{container-type:inline-size;--ts-bg:#050607;--ts-surface:#0b0d10;--ts-panel:#0d0f13;--ts-control:#14171b;--ts-border-subtle:#171a1f;--ts-border:#262b31;--ts-text:#e9ebed;--ts-muted:#8a9096;--ts-dim:#6f767d;--ts-blue:#3e6ae1;--ts-green:#31d158;--ts-red:#e82127;--ts-amber:#f5a623;display:block;color-scheme:dark}*{box-sizing:border-box}.wrap{background:var(--ts-bg);color:var(--ts-text);border-radius:16px;padding:8px;font-family:-apple-system,BlinkMacSystemFont,\"Helvetica Neue\",Arial,sans-serif;letter-spacing:-.01em}.car{position:relative;background:var(--ts-surface);border:1px solid var(--ts-border-subtle);border-radius:16px;margin:8px;overflow:hidden;box-shadow:0 14px 40px rgba(0,0,0,.45)}.empty{padding:22px;color:#787f86}.tile-head{padding:18px 20px 2px}.wordmark{font-size:11px;font-weight:600;letter-spacing:.42em;color:#fff}.model-name{font-size:26px;font-weight:500;letter-spacing:.01em;color:#f4f5f6;margin-top:7px}.car-sub{font-size:11px;color:#787f86;margin-top:3px}.visual{height:225px;padding:0 18px;display:flex;align-items:center;justify-content:center;background:radial-gradient(ellipse 62% 58% at 50% 60%,#20242a 0%,#0e1013 62%,#0a0c0f 100%)}.visual .car-svg{height:212px}.hero-panel{display:grid;grid-template-columns:1.05fr 1.3fr 1.6fr;gap:1px;background:var(--ts-border-subtle);border:1px solid var(--ts-border-subtle);border-radius:18px;overflow:hidden;margin:4px 14px 14px}.panel{background:var(--ts-panel);padding:13px}.panel-kicker{font-size:9px;color:var(--ts-dim);text-transform:uppercase;letter-spacing:.14em;margin-bottom:9px}.panel-note{font-size:9px;color:#565d64;margin-top:8px}.colors{display:flex;gap:9px;align-items:center;flex-wrap:wrap}.swatch{width:17px;height:17px;border-radius:50%;border:1px solid rgba(255,255,255,.16);padding:0;cursor:pointer}.swatch.on{outline:2px solid var(--ts-blue);outline-offset:2px}.picker{position:relative;width:17px;height:17px;border-radius:50%;border:1px dashed #3a4046;display:flex;align-items:center;justify-content:center;color:var(--ts-dim);cursor:pointer;overflow:hidden}.picker span{font-size:11px;line-height:1;pointer-events:none}.picker input{position:absolute;inset:-4px;opacity:0;cursor:pointer}.soc-row{display:flex;align-items:center;gap:9px}.soc-row .bat{flex:none;fill:#f4f5f6}.soc-row .bat.low{fill:var(--ts-amber)}.soc-row .bat.charging{fill:var(--ts-green)}.soc-row strong{font-size:38px;line-height:.9;letter-spacing:-.05em;color:#fff;font-weight:600}.soc-row strong small{font-size:16px;color:var(--ts-dim);font-weight:500}.bar{height:6px;background:#22262b;border-radius:99px;overflow:hidden;margin:10px 0 9px}.bar i{display:block;height:100%;background:#f4f5f6;border-radius:99px}.bar.low i{background:var(--ts-amber)}.bar.charging i{background:var(--ts-green)}.bar.charging i{animation:glow 1.6s ease-in-out infinite}.meta-row{display:flex;align-items:center;gap:9px;color:var(--ts-muted);font-size:10.5px;white-space:nowrap;overflow:hidden}.meta-row .dot{width:3px;height:3px;border-radius:50%;background:#3a4046;flex:none}.charge-head{display:flex;align-items:center;gap:9px;margin-bottom:4px}.charge-head svg{width:15px;height:15px;color:var(--ts-green);flex:none}.charge-head.idle svg{color:#545b62}.charge-head b{display:block;font-size:13px;font-weight:600;color:#fff}.charge-head small{display:block;font-size:10px;color:#787f86;margin-top:1px;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.charge-line{width:100%;display:flex;background:none;border:0;justify-content:space-between;align-items:center;margin-top:8px;padding:7px 0 0;border-top:1px solid var(--ts-border-subtle);font-size:11px;color:var(--ts-muted)}.charge-line b{color:var(--ts-text);font-size:12px;font-weight:600}.charge-line .chev{color:#545b62;margin-left:7px;font-size:13px;font-style:normal}.quick-controls{background:var(--ts-panel);padding:9px;display:grid;grid-template-columns:repeat(4,1fr);gap:7px;align-content:start}.ctrl{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;min-height:54px;background:var(--ts-control);border:1px solid #212529;border-radius:12px;color:#c6cbcf;font-size:9.5px;cursor:pointer;padding:6px 2px}.ctrl svg{width:16px;height:16px}.ctrl.on{background:rgba(62,106,231,.16);border-color:var(--ts-blue);color:#a4bef5}section{border-top:1px solid var(--ts-border-subtle);padding:13px 20px}.title{display:flex;justify-content:space-between;margin-bottom:9px;font-size:13px}.title b{font-weight:600}.title small{color:#787f86;font-size:10px}.states div{display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid var(--ts-border-subtle);font-size:12px;color:var(--ts-muted)}.states b{color:#dfe1e3;font-weight:500}.states b.alert{color:var(--ts-red)}.states b.open-state{color:#fff}.climate{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;color:#787f86;font-size:10px}.climate b,.chargegrid b{display:block;color:#fff;font-size:12px;margin-top:4px}.chargegrid{display:grid;grid-template-columns:repeat(2,1fr);gap:8px}.chargegrid span{background:var(--ts-control);border:1px solid #212529;border-radius:11px;padding:10px;color:#787f86;font-size:10px}label{display:grid;grid-template-columns:1fr auto;gap:5px;color:#787f86;font-size:11px;margin-top:12px}label.climate-temp{display:flex;align-items:center;gap:8px}label b{color:#fff}label input{grid-column:1/-1;width:100%;accent-color:var(--ts-green)}.address{font-size:14px}.climate-controls{grid-column:1/-1;display:flex;gap:7px;align-items:center;flex-wrap:wrap;margin-top:5px}.climate-controls button{background:#1a1e23;color:var(--ts-text);border:1px solid var(--ts-border);border-radius:9px;padding:7px 10px;font-size:10px}.climate-controls input{flex:1;min-width:100px;accent-color:var(--ts-red)}.comfort{margin-top:12px;padding-top:10px;border-top:1px solid var(--ts-border-subtle)}.comfort-head{font-size:9px;color:var(--ts-dim);text-transform:uppercase;letter-spacing:.14em;margin-bottom:9px}.comfort-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:8px}.notice{position:sticky;top:8px;z-index:5;margin:8px;padding:10px 13px;border-radius:12px;background:#242424;color:#fff;font-size:12px}.confirm{position:fixed;inset:0;background:rgba(0,0,0,.68);z-index:20;display:flex;align-items:center;justify-content:center;padding:24px}.confirm-box{max-width:360px;width:100%;background:#1d1d1d;border:1px solid #444;border-radius:18px;padding:20px;box-shadow:0 20px 60px #000}.confirm-box p{color:#aaa;font-size:12px;line-height:1.5}.confirm-actions{display:flex;gap:8px}.confirm-actions button{flex:1;padding:12px;border:0;border-radius:11px}.confirm-actions .yes{background:var(--ts-blue);color:#fff}.confirm-actions .no{background:#333;color:#fff}.trips{display:grid;gap:9px}.trip{background:var(--ts-panel);border:1px solid var(--ts-border-subtle);border-radius:14px;padding:10px}.trip-head,.trip-meta{display:flex;justify-content:space-between;gap:8px;font-size:11px}.trip-meta{color:#787f86;margin:5px 0 8px}.trip .route{height:120px}.route-full{background:var(--ts-panel);border:1px solid var(--ts-border-subtle);border-radius:14px;padding:10px;margin-top:9px}.route-full .route{height:150px}.trip-empty{background:var(--ts-panel);color:var(--ts-dim);border-radius:14px;padding:18px;font-size:11px}.route{width:100%;height:170px;background:var(--ts-panel);border-radius:14px}.map-empty{background:var(--ts-panel);color:var(--ts-dim);border-radius:14px;padding:22px;text-align:center;font-size:11px}.car-svg{width:100%;height:180px;filter:drop-shadow(0 18px 15px rgba(0,0,0,.5));transition:transform .35s ease,filter .35s ease}.car-svg .body{transition:filter .35s ease}.car-svg.open{transform:translateY(-3px) scale(1.015)}.car-svg.cyber .body{stroke-opacity:.35}.bolt{opacity:0}.charging .bolt{opacity:1;animation:pulse 1.1s infinite}.charging .body{filter:drop-shadow(0 0 8px rgba(62,106,225,.35))}@keyframes pulse{50%{opacity:.3}}@keyframes glow{50%{opacity:.6}}@container (max-width:760px){.hero-panel{grid-template-columns:1fr 1fr}.charge-panel{grid-column:1/-1}.quick-controls{grid-column:1/-1}.model-name{font-size:22px}.soc-row strong{font-size:32px}}.sec-title{display:flex;align-items:center;gap:7px;background:none;border:0;color:inherit;font:inherit;padding:0;cursor:pointer}.sec-title b{font-weight:600}.sec-title .chev{display:inline-block;font-style:normal;color:#545b62;transition:transform .25s ease}.sec-title .chev.rot{transform:rotate(90deg)}.interior{position:relative;height:190px;border-radius:14px;overflow:hidden;margin-bottom:10px;background:#0e1013}.interior-chips{position:absolute;left:10px;bottom:10px;z-index:2;display:flex;gap:6px}.interior-chips span{background:rgba(5,6,7,.72);border:1px solid rgba(255,255,255,.09);color:#dfe1e3;font-size:10px;padding:4px 9px;border-radius:99px}.states .rowicon{font-style:normal}.states .rowicon+span{flex:1;text-align:left;margin-left:8px}.states .rowicon svg{width:13px;height:13px;vertical-align:-2.5px;margin-right:7px;color:var(--ts-dim)}.tires{width:100%;height:auto;display:block;background:var(--ts-panel);border:1px solid var(--ts-border-subtle);border-radius:14px}.tile-head{position:relative}.gear-btn{position:absolute;right:14px;top:14px;width:30px;height:30px;border-radius:50%;background:var(--ts-control);border:1px solid #212529;color:var(--ts-muted);cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0}.gear-btn svg{width:15px;height:15px}.gear-btn.on{color:var(--ts-text);border-color:var(--ts-blue);background:rgba(62,106,231,.16)}.paint-menu{position:absolute;right:14px;top:66px;z-index:6;background:var(--ts-control);border:1px solid var(--ts-border);border-radius:14px;padding:12px 14px;box-shadow:0 14px 40px rgba(0,0,0,.6)}.paint-menu .colors{margin-top:2px}.paint-menu .panel-note{margin-top:8px}.paint-menu{min-width:190px}.paint-menu input[type=\"color\"]{cursor:pointer}.interior.seatpage{height:auto;padding:10px 10px 4px}.interior.seatpage .interior-chips{position:static;justify-content:center;margin-top:4px}.seat-cabin{width:100%;height:auto;display:block}.seatc{cursor:pointer;outline:none}.vehicle-stack{position:relative;width:100%;height:100%;display:flex;align-items:center;justify-content:center}.vehicle-fallback{position:absolute;inset:0;display:flex;align-items:center;justify-content:center}.vehicle-photo{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;opacity:0;filter:var(--vehicle-filter)}.vehicle-stack.loaded .vehicle-photo{opacity:1}.vehicle-stack.loaded .vehicle-fallback{opacity:0}.vehicle-stack.failed .vehicle-photo{display:none}.vehicle-stack .tint{position:absolute;inset:0;background:var(--vehicle-paint);opacity:.16;mix-blend-mode:color;pointer-events:none;border-radius:16px}.vehicle-stack.loaded .tint{opacity:.08}button:focus-visible,[role=\"button\"]:focus-visible,input:focus-visible{outline:2px solid var(--ts-blue);outline-offset:3px}.ctrl:disabled,.climate-controls button:disabled{cursor:wait;opacity:.55}.ctrl.busy svg{animation:pulse .8s ease-in-out infinite}.charge-line{cursor:pointer;text-align:left;font:inherit}.charge-line .chev{transition:transform .25s ease}.charge-line[aria-expanded=\"true\"] .chev{transform:rotate(90deg)}@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}}.dashboard-mode{min-height:100%;padding:0 0 24px}.dashboard-mode .dash-nav{position:sticky;top:0;z-index:10;display:flex;gap:6px;overflow:auto;padding:12px 16px;background:rgba(5,6,7,.94);backdrop-filter:blur(18px);border-bottom:1px solid var(--ts-border-subtle)}.dash-tab{flex:none;background:transparent;border:1px solid transparent;border-radius:999px;color:var(--ts-muted);padding:8px 14px;font-size:11px;cursor:pointer}.dash-tab.active{background:#fff;color:#050607;border-color:#fff}.dashboard-overview{padding:42px 34px 24px}.dashboard-kicker{font-size:11px;font-weight:600;letter-spacing:.48em;color:#fff}.dashboard-overview h1{font-size:42px;font-weight:500;letter-spacing:-.04em;margin:9px 0 2px}.dashboard-overview>p{color:var(--ts-muted);font-size:13px;margin:0 0 28px}.overview-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:14px}.overview-car{appearance:none;text-align:left;width:100%;padding:0;background:var(--ts-surface);color:var(--ts-text);border:1px solid var(--ts-border-subtle);border-radius:18px;overflow:hidden;cursor:pointer;box-shadow:0 16px 45px rgba(0,0,0,.32);transition:transform .2s ease,border-color .2s ease}.overview-car:hover{transform:translateY(-2px);border-color:#343a42}.overview-car-head{display:flex;justify-content:space-between;gap:16px;padding:18px 18px 4px}.overview-car-head b{display:block;font-size:24px;font-weight:500;margin-top:5px}.overview-car-head small{display:block;color:var(--ts-muted);font-size:10px;margin-top:3px}.overview-car-head>span{font-size:10px;color:var(--ts-muted);padding-top:5px}.overview-visual{height:220px;background:radial-gradient(ellipse 62% 58% at 50% 60%,#20242a 0%,#0e1013 62%,#0a0c0f 100%);display:flex;align-items:center;justify-content:center}.overview-visual .vehicle-stack,.overview-visual .car-svg{width:100%;height:205px}.overview-stats{display:grid;grid-template-columns:1.2fr 1fr 1fr;gap:1px;background:var(--ts-border-subtle);border-top:1px solid var(--ts-border-subtle)}.overview-stats>div{background:var(--ts-panel);padding:12px 14px;min-width:0}.overview-stats strong{display:block;font-size:20px;color:#fff;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.overview-stats strong small{font-size:11px;color:var(--ts-dim);margin-left:2px}.overview-stats span{display:block;color:var(--ts-dim);font-size:9px;text-transform:uppercase;letter-spacing:.12em;margin-top:4px}.overview-stats i{display:block;height:3px;background:#22262b;border-radius:99px;margin-top:9px;overflow:hidden}.overview-stats em{display:block;height:100%;background:#fff;border-radius:99px}.overview-open{display:flex;justify-content:space-between;align-items:center;padding:12px 14px;color:var(--ts-muted);font-size:10px;border-top:1px solid var(--ts-border-subtle)}.overview-open b{font-size:18px;color:#fff;font-weight:400}.dashboard-mode>.car{margin:0;border:0;border-radius:0;box-shadow:none}.dashboard-mode>.notice{margin:8px 16px}.dashboard-mode>.car .tile-head{padding-left:28px;padding-right:28px}.dashboard-mode>.car section{padding-left:28px;padding-right:28px}.dashboard-mode>.car .hero-panel{margin-left:22px;margin-right:22px}@container (max-width:760px){.dashboard-overview{padding:30px 16px 18px}.dashboard-overview h1{font-size:34px}.overview-grid{grid-template-columns:1fr}.dashboard-mode>.car .tile-head{padding-left:18px;padding-right:18px}.dashboard-mode>.car section{padding-left:18px;padding-right:18px}.dashboard-mode>.car .hero-panel{margin-left:12px;margin-right:12px}}";
class TeslaShareCard extends HTMLElement {
  setConfig(config){if(!config||typeof config!=="object")throw new Error("Tesla Share requires a card configuration");this._config=config;this._dashboardView="overview";this._renderSignature=""}
  getCardSize(){return 12}
  connectedCallback(){if(!this.shadowRoot)this.attachShadow({mode:"open"});this._render(true)}
  disconnectedCallback(){clearTimeout(this._noticeTimer)}
  set hass(h){
    this._hass=h;
    if(!this._registryReady && Date.now() >= (this._registryRetryAt||0)) this._loadRegistry();
    else this._syncRegistryStates();
    this._render();
    this._historyLoad();
  }
  async _loadRegistry(){
    if(!this._hass?.callWS||this._registryLoading)return;
    this._registryLoading=true;
    try{
      this._registry=await loadTeslaRegistry(this._hass);
      this._registryReady=true;
      this._syncRegistryStates();
      this._render(true);
      this._historyKey="";
      await this._historyLoad();
    }catch(e){
      this._registry=null;
      this._registryReady=false;
      this._registryRetryAt=Date.now()+10000;
      this._render(true);
    }finally{
      this._registryLoading=false;
    }
  }
  _syncRegistryStates(){
    if(!this._registry?.entities||!this._hass?.states)return;
    for(const e of this._registry.entities)e.state=this._hass.states[e.id];
  }
  async _service(ent,service,data={}){
    if(!ent||!this._hass||unavailable(this._hass,ent)||this._busy?.has(ent.id))return false;
    const d=ent.id.split(".")[0];
    const before=stateOf(this._hass,ent);
    this._busy=this._busy||new Set();this._busy.add(ent.id);this._render(true);
    try{
      await this._hass.callService(d,service,{entity_id:ent.id,...data});
      const stateful=/^(lock|climate|cover|switch|number|input_number)$/.test(d);
      let changed=false;
      if(stateful){
        const deadline=Date.now()+3500;
        while(Date.now()<deadline){
          await new Promise(resolve=>setTimeout(resolve,250));
          const now=stateOf(this._hass,ent);
          if(now!==before){changed=true;break}
        }
      }
      this._notice=changed?"Vehicle state updated":"Command accepted \u00b7 vehicle state pending";
      return true;
    }catch(e){
      const msg=String(e?.message||e?.error?.message||e||"Unknown Home Assistant error").replace(/\s+/g," ").slice(0,180);
      this._notice="Command failed: "+msg;
      return false;
    }finally{
      this._busy.delete(ent.id);this._render(true);clearTimeout(this._noticeTimer);
      this._noticeTimer=setTimeout(()=>{this._notice="";this._render(true)},5000);
    }
  }
  async _action(ent,kind,key){
    if(!ent)return;
    const d=ent.id.split(".")[0],s=stateOf(this._hass,ent);
    if(d==="button"||(kind==="press"&&d!=="switch")){
      await this._service(ent,"press");
      return;
    }
    if(kind==="press"&&d==="switch"){await this._service(ent,"turn_on");return}
    if(kind==="turn_on"||kind==="turn_off"){
      await this._service(ent,kind);
      return;
    }
    if(kind==="toggle"){
      let service=null;
      if(key==="lock"&&d==="lock")service=s==="locked"?"unlock":"lock";
      else if(key==="climate"&&d==="climate")service=s==="off"?"turn_on":"turn_off";
      else if(d==="switch")service=s==="on"?"turn_off":"turn_on";
      else if(d==="cover")service=openState(s)?"close_cover":"open_cover";
      if(service)await this._service(ent,service);
      else this._notice="No compatible command for "+key;
      if(!service)this._render(true);
    }
  }
  _cycleSelect(ent){
    if(!ent)return;
    const st=this._hass.states?.[ent.id],opts=st?.attributes?.options||[];
    if(!opts.length)return;
    const cur=String(st.state||"").toLowerCase(),idx=opts.findIndex(o=>String(o).toLowerCase()===cur);
    this._service(ent,"select_option",{option:opts[(idx+1+opts.length)%opts.length]});
  }
  async _climateAction(car,action){
    const ent=car.picked?.climate;if(!ent)return;
    const a=this._hass.states?.[ent.id]?.attributes||{};
    if(action==="temp"){
      const value=Number(this._climateDraft?.[car.id]??a.temperature);
      if(Number.isFinite(value)){
        await this._service(ent,"set_temperature",{temperature:value});
        if(this._climateDraft)delete this._climateDraft[car.id];
      }
    }else if(action==="mode"){
      const modes=a.hvac_modes||[],i=modes.indexOf(a.hvac_mode),next=modes[(i+1+modes.length)%Math.max(1,modes.length)];
      if(next)await this._service(ent,"set_hvac_mode",{hvac_mode:next});
    }else if(action==="fan"){
      const modes=a.fan_modes||[],i=modes.indexOf(a.fan_mode),next=modes[(i+1+modes.length)%Math.max(1,modes.length)];
      if(next)await this._service(ent,"set_fan_mode",{fan_mode:next});
    }
  }
  _color(car){
    const key=car.device_id||car.id||car.name,cfg=this._config?.colors||{};
    const hexColor=(v)=>{const s=String(v||"").trim();return /^#[0-9a-fA-F]{6}$/.test(s)?s:null};
    if(hexColor(cfg[key]))return hexColor(cfg[key]); if(hexColor(cfg[car.name]))return hexColor(cfg[car.name]);
    const def=(this._paints&&this._paints(car)[0]&&this._paints(car)[0][1])||"#f0ece4";
    try{return localStorage.getItem("tesla-share-color:"+key)||def}catch{return def}
  }
  _paintFilter(paint){
    const p=String(paint||"").toLowerCase();
    if(p==="#16181a")return "brightness(.38) saturate(.72)";
    if(/b8201a|8f1017|5a1020/.test(p))return "saturate(1.8) hue-rotate(-12deg) brightness(.78)";
    if(/2a4a78|7f9cab|c8d8e2/.test(p))return "saturate(1.35) hue-rotate(155deg)";
    if(/43474b|6e7377|b0b2ac|cbcdcd/.test(p))return "grayscale(.25) saturate(.65) brightness(1.02)";
    return "saturate(.72) brightness(1.08)";
  }
  _onClick(e){
    const path=typeof e.composedPath==="function"?e.composedPath():[];
    const b=(path.find(n=>n?.nodeType===1&&n.hasAttribute?.("data-act"))||e.target?.closest?.("[data-act]"));
    if(!b||b.disabled||b.getAttribute("aria-disabled")==="true")return;
    if(b.dataset.act==="dashboard-view"){
      if(String(this._config?.mode||"").toLowerCase()==="dashboard" && b.dataset.view){
        e.preventDefault?.();
        this._dashboardView=String(b.dataset.view);
        this._renderSignature="";
        this._render(true);
      }
      return;
    }
    if(b.dataset.act==="confirm"){
      if(this._confirm&&b.dataset.choice==="yes"){const c=this._confirm;this._confirm=null;this._render(true);this._action(c.ent,c.act,c.key)}
      else{this._confirm=null;this._render(true)}
      return;
    }
    const car=this._cars?.[+b.dataset.car];if(!car)return;
    if(b.dataset.act==="climate-mode"){this._climateAction(car,"mode");return}
    if(b.dataset.act==="climate-fan"){this._climateAction(car,"fan");return}
    if(b.dataset.act==="climate-temp-apply"){this._climateAction(car,"temp");return}
    if(b.dataset.act==="paint-gear"){this._paintOpen=this._paintOpen||{};this._paintOpen[car.id]=!this._paintOpen[car.id];this._render(true);return}
    if(b.dataset.act==="seat-tap"){
      const key=b.dataset.key,ent=car.picked?.[key];if(!ent)return;
      if(domainOf(ent)==="switch"){this._action(ent,"toggle",key);return}
      if(domainOf(ent)==="select"){this._cycleSelect(ent);return}
      this._notice="Unsupported "+key+" entity";this._render(true);return;
    }
    if(b.dataset.act==="climate-tab"){this._climateOpen=this._climateOpen||{};this._climateOpen[car.id]=!this._climateOpen[car.id];this._render(true);return}
    if(b.dataset.act==="charging-tab"){this._chargingOpen=this._chargingOpen||{};this._chargingOpen[car.id]=!this._chargingOpen[car.id];this._render(true);return}
    if(b.dataset.act==="windows-vent"){const ent=car.picked?.windows;if(ent)this._service(ent,"open_cover");return}
    if(b.dataset.act==="windows-close"){const ent=car.picked?.windows;if(ent)this._service(ent,"close_cover");return}
    if(b.dataset.act==="color"){try{localStorage.setItem("tesla-share-color:"+(car.device_id||car.id||car.name),b.dataset.color||b.value)}catch{}this._render(true);return}
    const key=b.dataset.key;
    if(key==="port"&&b.dataset.act==="toggle"){
      const open=car.picked?.portOpen,close=car.picked?.portClose,main=car.picked?.port;
      const target=openState(stateOf(this._hass,main))?close:open;
      if(target){this._action(target,"press","port");return}
    }
    const ent=car.picked?.[key];if(!ent)return;
    const state=stateOf(this._hass,ent),risky=key==="horn"||key==="flash"||key==="start"||((key==="frunk"||key==="trunk")&&!openState(state))||(key==="lock"&&state==="locked");
    if(risky){this._confirm={car:car.name,key,ent,act:b.dataset.act};this._render(true);return}
    this._action(ent,b.dataset.act,key);
  }
  _onInput(e){
    const x=e.target;if(x.type!=="range")return;
    const car=this._cars?.[+x.dataset.car];if(!car)return;
    const label=x.closest("label"),value=label?.querySelector("b");
    if(x.dataset.act==="climate-temp"){
      this._climateDraft=this._climateDraft||{};this._climateDraft[car.id]=+x.value;
      if(value)value.textContent=x.value+(x.dataset.unit||"");
    }else if(value)value.textContent=x.value+(x.dataset.unit||"");
  }
  _onKeyDown(e){
    if(e.key==="Escape"){
      if(this._confirm){this._confirm=null;this._render(true);return}
      let changed=false;for(const map of [this._paintOpen,this._climateOpen,this._chargingOpen])if(map)for(const k in map)if(map[k]){map[k]=false;changed=true}
      if(changed)this._render(true);return;
    }
    if(e.key==="Tab"&&this._confirm){const a=[...this.shadowRoot.querySelectorAll('.confirm button')];if(a.length){const i=a.indexOf(this.shadowRoot.activeElement),n=e.shiftKey?(i<=0?a.length-1:i-1):(i<0||i===a.length-1?0:i+1);e.preventDefault();a[n].focus()}return}
    if((e.key==="Enter"||e.key===" ")&&e.target?.getAttribute?.("role")==="button"){
      e.preventDefault();this._onClick({target:e.target});
    }
  }
  _onChange(e){
    const x=e.target,car=this._cars?.[+x.dataset.car];if(!car)return;
    if(x.dataset.act==="color"){try{localStorage.setItem("tesla-share-color:"+(car.device_id||car.id||car.name),x.value)}catch{}this._render(true);return}
    if(x.dataset.act==="climate-temp"){
      this._climateDraft=this._climateDraft||{};
      this._climateDraft[car.id]=+x.value;
      return;
    }
    const ent=car.picked?.[x.dataset.key];if(!ent)return;
    if(x.type==="range"&&/^(number|input_number)$/.test(domainOf(ent)))this._service(ent,"set_value",{value:+x.value});
  }
  _stockCar(car,charging,open){
    const paint=this._color(car),m=car.model||"Tesla";
    const cyber=/cybertruck/i.test(m),x=/model x/i.test(m),y=/model y/i.test(m),s=/model s/i.test(m),road=/roadster/i.test(m);
    const uid=(car.device_id||car.id||"tesla").replace(/[^a-z0-9]/gi,"");
    const ids={body:"body-"+uid,glass:"glass-"+uid,shine:"shine-"+uid,wheel:"wheel-"+uid,ground:"ground-"+uid};
    const body=cyber
      ?"M58 154L83 128L112 119L169 82L390 68L468 78L526 104L579 143L566 168H72Z"
      :x
      ?"M42 153C55 124 81 102 120 87C166 69 221 64 294 65L402 70C476 76 531 104 586 143L568 169H68Z"
      :y
      ?"M43 153C56 119 89 94 137 79C184 64 250 59 316 61L404 69C477 78 532 107 588 144L569 168H68Z"
      :s
      ?"M43 153C61 119 99 91 151 76C213 58 294 58 364 63L428 74C494 86 544 109 590 144L569 168H68Z"
      :road
      ?"M47 153C70 112 124 82 190 72C264 61 351 65 425 77C495 89 548 113 593 145L568 168H68Z"
      :"M43 153C60 117 101 90 158 75C222 58 301 59 371 64L431 75C496 87 546 110 590 145L569 168H68Z";
    const glass=cyber
      ?"M99 119L168 84L389 71L468 81L527 108L548 124H99Z"
      :x
      ?"M102 119C130 95 169 80 219 72C278 63 353 65 411 75C466 84 511 101 548 122L570 135H96Z"
      :y
      ?"M103 119C132 93 174 78 226 70C286 61 351 64 412 75C468 84 511 102 550 123L569 135H96Z"
      :s
      ?"M112 116C143 91 188 76 239 69C298 61 353 64 408 75C464 85 507 102 548 123L569 136H104Z"
      :road
      ?"M112 116C145 91 190 77 244 71C305 64 359 67 414 77C466 87 511 103 550 123L570 136H104Z"
      :"M110 116C143 90 188 76 239 69C300 61 355 64 410 75C466 85 508 102 549 123L570 136H103Z";
    const roof=cyber
      ?"M169 84L390 71L468 81L423 102L202 101Z"
      :x
      ?"M157 91C213 69 320 64 408 77L496 108L210 104Z"
      :y
      ?"M157 87C220 66 335 65 414 77L500 109L204 105Z"
      :s
      ?"M170 84C232 64 342 65 416 77L500 109L210 104Z"
      :road
      ?"M178 82C246 66 345 68 417 79L495 108L216 104Z"
      :"M170 83C235 63 345 65 417 77L500 109L211 104Z";
    const lower=cyber
      ?"M72 145L568 145L566 168H68Z"
      :"M68 144C192 156 441 157 570 144L569 168H68Z";
    const wheel=(cx,cyy,scale=1)=>'<g transform="translate('+cx+' '+cyy+') scale('+scale+')">'+
      '<ellipse rx="34" ry="37" fill="#030405" stroke="#30343a" stroke-width="3"/>'+
      '<circle r="27" fill="url(#'+ids.wheel+')"/>'+
      '<circle r="22" fill="#17191c" stroke="#666a6f" stroke-width="1.5"/>'+
      '<path d="M0-19L5-5L19-3L7 5L11 19L0 10L-11 19L-7 5L-19-3L-5-5Z" fill="#85898d"/>'+
      '<circle r="5" fill="#111317" stroke="#a5a7aa" stroke-width="1.5"/>'+
      '</g>';
    const wheelPos=cyber?[174,468]:x?[173,474]:y?[174,470]:s?[175,474]:road?[177,470]:[174,472];
    const seams=cyber
      ?'<path d="M275 83L276 145M393 79L400 145M169 117L468 119" class="seam"/><path d="M91 130L160 112M468 112L549 130" class="seam faint"/>'
      :x
      ?'<path d="M276 72L275 145M393 76L397 145M132 119C231 131 421 131 545 119" class="seam"/>'
      :'<path d="M286 70L284 145M383 74L386 145M128 121C240 132 423 132 549 121" class="seam"/>';
    const lights=cyber
      ?'<path d="M88 134L127 123L146 125L121 136Z" class="head"/><path d="M533 123L560 132L548 137L527 129Z" class="tail"/>'
      :'<path d="M86 133L126 121L149 124L123 136Z" class="head"/><path d="M535 122L565 132L549 138L529 129Z" class="tail"/>';
    const mirrors=cyber?"":'<path d="M119 113L101 108L94 115L116 120Z" class="mirror"/><path d="M529 111L548 106L556 113L532 119Z" class="mirror"/>';
    const handles=cyber?"":'<path d="M289 112h18M383 111h18" class="handle"/>';
    const panels=open
      ?(x||y
        ?'<path d="M176 112L146 52L183 45L210 109" class="open-panel"/><path d="M474 113L506 68L532 80L514 119" class="open-panel"/>'
        :'<path d="M178 113L146 58L181 51L209 111" class="open-panel"/><path d="M474 113L505 70L529 81L512 119" class="open-panel"/>')
      :"";
    const cable=charging
      ?'<path d="M111 137C83 157 84 181 112 191C143 202 173 193 190 174" class="cable"/><circle cx="111" cy="137" r="7" class="charge-dot"/>'
      :'<circle cx="111" cy="137" r="7" class="charge-dot"/>';
    const badge=cyber
      ?'<text x="320" y="139" class="model-badge">CYBERTRUCK</text>'
      :"";
    return '<svg viewBox="0 0 640 220" class="car-svg '+(charging?"charging ":"")+(open?"open ":"")+(cyber?"cyber ":"")+(x?"model-x ":y?"model-y ":s?"model-s ":road?"roadster ":"model-3 ")+'" role="img" aria-label="'+esc(m)+'">'+
      '<defs>'+
      '<linearGradient id="'+ids.body+'" x1="0" y1="0" x2=".92" y2="1">'+
      '<stop offset="0" stop-color="'+paint+'" stop-opacity=".99"/><stop offset=".3" stop-color="'+paint+'"/><stop offset=".58" stop-color="#4d5358"/><stop offset=".78" stop-color="#15181c"/><stop offset="1" stop-color="#030405"/>'+
      '</linearGradient>'+
      '<linearGradient id="'+ids.glass+'" x1="0" y1="0" x2=".9" y2="1">'+
      '<stop offset="0" stop-color="#87929c" stop-opacity=".62"/><stop offset=".25" stop-color="#303c47" stop-opacity=".9"/><stop offset=".65" stop-color="#0c1218" stop-opacity=".98"/><stop offset="1" stop-color="#020305"/>'+
      '</linearGradient>'+
      '<linearGradient id="'+ids.shine+'" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".42" stop-color="#fff" stop-opacity=".48"/><stop offset=".66" stop-color="#fff" stop-opacity=".12"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>'+
      '<radialGradient id="'+ids.wheel+'"><stop offset="0" stop-color="#b7babd"/><stop offset=".3" stop-color="#555a60"/><stop offset=".68" stop-color="#202328"/><stop offset="1" stop-color="#08090a"/></radialGradient>'+
      '<radialGradient id="'+ids.ground+'"><stop offset="0" stop-color="#fff" stop-opacity=".16"/><stop offset=".55" stop-color="#fff" stop-opacity=".045"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>'+
      '<filter id="blur-'+uid+'"><feGaussianBlur stdDeviation="7"/></filter>'+
      '</defs>'+
      '<ellipse cx="325" cy="184" rx="278" ry="19" fill="#000" opacity=".72"/>'+
      '<ellipse cx="325" cy="177" rx="220" ry="13" fill="url(#'+ids.ground+')" filter="url(#blur-'+uid+')"/>'+
      '<path d="M66 178H575" stroke="#fff" stroke-opacity=".035" stroke-width="1"/>'+
      '<path class="body" d="'+body+'" fill="url(#'+ids.body+')" stroke="#fff" stroke-opacity=".24" stroke-width="1.8"/>'+
      '<path d="'+lower+'" fill="#020304" opacity=".58"/>'+
      '<path class="glass" d="'+glass+'" fill="url(#'+ids.glass+')" stroke="#05070a" stroke-width="4"/>'+
      '<path d="'+roof+'" fill="#030507" opacity=".62" stroke="#aab0b6" stroke-opacity=".16" stroke-width="1"/>'+
      '<path d="M116 113C208 86 416 88 550 121" fill="none" stroke="#fff" stroke-opacity=".12" stroke-width="2"/>'+
      '<path d="M101 125C222 111 421 111 560 128" fill="none" stroke="#fff" stroke-opacity=".07" stroke-width="2"/>'+
      '<path d="M150 94C237 75 375 78 470 96" fill="none" stroke="url(#'+ids.shine+')" stroke-width="8" opacity=".5"/>'+
      seams+mirrors+handles+lights+
      '<path d="M102 145C229 158 435 159 555 145" fill="none" stroke="#fff" stroke-opacity=".08" stroke-width="2"/>'+
      wheel(wheelPos[0],158,1)+wheel(wheelPos[1],158,1)+
      cable+panels+
      '<circle cx="111" cy="137" r="12" fill="none" stroke="#fff" stroke-opacity=".12"/>'+
      '<path class="bolt" d="M249 119h28l-8 16h20l-33 39 8-24h-22z" fill="#fff" opacity="'+(charging?".98":"0")+'"/>'+
      badge+
      '</svg>';
  }
  _gearIcon(){
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.09a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.09a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';
  }
  _paints(car){
    const m=String(car.model||"").toLowerCase();
    for(const k in TESLA_PAINTS)if(m.includes(k))return TESLA_PAINTS[k];
    return TESLA_PAINTS_DEFAULT;
  }
  _swatches(car,i){
    const paints=this._paints(car),cur=this._color(car);
    return '<div class="colors">'+paints.map(([n,x])=>'<button class="swatch '+(x.toLowerCase()===cur.toLowerCase()?"on":"")+'" title="'+escAttr(n)+'" aria-label="'+escAttr(n)+'" aria-pressed="'+(x.toLowerCase()===cur.toLowerCase())+'" data-car="'+i+'" data-act="color" data-color="'+x+'" style="background:'+x+'"></button>').join("")+'<label class="picker" title="Custom paint"><span>+</span><input data-car="'+i+'" data-act="color" aria-label="Custom paint color" type="color" value="'+(/^#[0-9a-f]{6}$/i.test(cur)?cur:(paints[0]&&paints[0][1])||"#f0ece4")+'"></label></div>';
  }
  _icon(key){
    const P={
      lock:'<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
      climate:'<circle cx="12" cy="12" r="2.1"/><path d="M12 9.9C12 6.8 10.9 4.8 9.2 4.8c-1.8 0-2.9 2.1-1.1 3.9 1.1 1 2.9 1.2 3.9 1.2zM14.1 12c3.1 0 5.1-1.1 5.1-2.8s-2.1-2.8-3.9-1c-1 1.1-1.2 2.8-1.2 3.8zM12 14.1c0 3.1 1.1 5.1 2.8 5.1s2.8-2.1 1-3.9c-1.1-1-2.8-1.2-3.8-1.2zM9.9 12c-3.1 0-5.1 1.1-5.1 2.8s2.1 2.8 3.9 1c1-1.1 1.2-2.8 1.2-3.8z"/>',
      horn:'<path d="M4 10v4h4l5 4V6l-5 4H4z"/><path d="M16.5 9.5a3.5 3.5 0 0 1 0 5"/>',
      flash:'<path d="M13 2L5 13h5l-1 9 8-11h-5l1-9z"/>',
      frunk:'<path d="M4 12l2.2-4.4A2 2 0 0 1 8 6.5h8a2 2 0 0 1 1.8 1.1L20 12v6H4v-6z"/><path d="M4 12h16M12 6.5V12M7 18v1.5M17 18v1.5"/>',
      trunk:'<path d="M4 12l2.2-4.4A2 2 0 0 1 8 6.5h8a2 2 0 0 1 1.8 1.1L20 12v6H4v-6z"/><path d="M4 12h16M7 18v1.5M17 18v1.5"/>',
      port:'<path d="M9 3v5M15 3v5M7 8h10v3a5 5 0 0 1-10 0V8z"/><path d="M12 16v5"/>',
      sentry:'<path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3z"/>',
      heat:'<path d="M6 4c0 2.5-2 2.5-2 5s2 2.5 2 5M12 4c0 2.5-2 2.5-2 5s2 2.5 2 5M18 4c0 2.5-2 2.5-2 5s2 2.5 2 5"/>',
      gauge:'<circle cx="12" cy="12" r="8"/><path d="M12 12l3.5-3.5M8 15h8"/>',
      brake:'<circle cx="12" cy="12" r="8"/><path d="M12 8v5M9.5 15.5h5"/>',
      shift:'<path d="M6 5h3v3H6zM15 5h3v3h-3zM6 16h3v3H6z"/>',
      calendar:'<rect x="4" y="5" width="16" height="16" rx="2"/><path d="M8 3v4M16 3v4M4 10h16"/>',
      clock:'<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>',
      user:'<circle cx="10" cy="8" r="3.5"/><path d="M4 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5"/>',
      hourglass:'<path d="M7 3h10M7 21h10M8 3c0 7 8 7 8 14M16 3c0 7-8 7-8 14"/>',
      pin:'<path d="M12 21s-6-5.3-6-10a6 6 0 1 1 12 0c0 4.7-6 10-6 10z"/><circle cx="12" cy="11" r="2"/>',
      windows:'<rect x="4" y="8" width="16" height="9" rx="2"/><path d="M4 12.5h16M12 8v9"/>',
      wake:'<path d="M20 12a8 8 0 1 1-2.3-5.7M20 3v4h-4"/>',
      refresh:'<path d="M20 12a8 8 0 1 1-2.3-5.7M20 3v4h-4"/>',
      start:'<path d="M7 4l13 8-13 8V4z"/>',
      plug:'<path d="M9 3v5M15 3v5M7 8h10v3a5 5 0 0 1-10 0V8z"/><path d="M12 16v5"/>'
    };
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+(P[key]||'<circle cx="12" cy="12" r="8"/>')+'</svg>';
  }
  _btn(i,key,label,act="toggle",on=false){
    const ent=this._cars?.[i]?.picked?.[key],busy=!!ent&&this._busy?.has(ent.id),disabled=!!ent&&unavailable(this._hass,ent);
    return '<button class="ctrl '+(on?"on ":"")+(busy?"busy":"")+'" data-car="'+i+'" data-key="'+key+'" data-act="'+act+'" title="'+escAttr(label)+'" aria-label="'+escAttr(label)+'"'+(act==="toggle"?' aria-pressed="'+on+'"':"")+(busy?' aria-busy="true"':"")+((busy||disabled)?" disabled":"")+'>'+this._icon(key)+'<small>'+esc(label)+'</small></button>'
  }
  _vehicleArt(car,active,open){
    const cfg=this._config||{},model=String(car.model||"").toLowerCase();
    const map=cfg.vehicle_images||{};
    let url="";
    for(const k in map)if(model.includes(String(k).toLowerCase()))url=map[k];
    if(!url){for(const k in VEHICLE_IMGS)if(model.includes(k))url=VEHICLE_IMGS[k]}
    if(!url)return this._stockCar(car,active,open);
    const paint=this._color(car),safe=escAttr(url),filter=this._paintFilter(paint);
    return '<div class="vehicle-stack" style="--vehicle-paint:'+escAttr(paint)+';--vehicle-filter:'+escAttr(filter)+'"><div class="vehicle-fallback">'+this._stockCar(car,active,open)+'</div><img class="vehicle-photo" loading="eager" decoding="async" referrerpolicy="no-referrer" src="'+safe+'" alt="'+escAttr(car.model)+' side view"><i class="tint" aria-hidden="true"></i></div>';
  }
  _seatCabin(h,car,i){
    const lvl=s=>{const m=String(s).toLowerCase(),cool=m.indexOf("cool")>=0,map={off:0,on:3,false:0,true:3,low:1,medium:2,med:2,warm:2,high:3,hot:3};return{n:cool?(map[m.replace(/cool[\s_-]*/,"")]||0):(map[m]||0),cool}};
    const wave=(cx,y0,n,cool,w)=>[0,1,2].map(j=>{const lit=j<n;const col=lit?(cool?"#3e6ae1":"#e82127"):"#a39e91";const y=y0+j*20;return '<path d="M'+(cx-w/2)+' '+y+' q'+(w/8)+' -9 '+(w/4)+' 0 t'+(w/4)+' 0 t'+(w/4)+' 0 t'+(w/4)+' 0" fill="none" stroke="'+col+'" stroke-width="'+(lit?5:3)+'" stroke-linecap="round" opacity="'+(lit?1:.75)+'"'+(lit?' style="filter:drop-shadow(0 0 4px '+(cool?"rgba(62,106,225,.6)":"rgba(232,33,39,.6)")+')"':"")+'/>'}).join("");
    const seat=(key,cx,cy,label,rear)=>{
      const ent=car.picked?.[key];if(!ent)return "";
      const st=h.states?.[ent.id],cur=String(st?.state||"").toLowerCase();
      const lv=lvl(cur),n=lv.n,cool=lv.cool;
      const rot=rear?' transform="rotate(180 '+cx+' '+cy+')"':"";
      return '<g class="seatc" data-act="seat-tap" data-car="'+i+'" data-key="'+key+'" role="button" tabindex="0" aria-label="'+esc(label)+' heat '+(n?String(n):"off")+'">'
        +'<g'+rot+'>'
        +'<rect x="'+(cx-56)+'" y="'+(cy-50)+'" width="112" height="92" rx="28" fill="url(#'+leatherId+')" stroke="#b3aea1" stroke-width="1.5"/>'
        +'<rect x="'+(cx-66)+'" y="'+(cy-36)+'" width="15" height="64" rx="7" fill="#d3cec1" stroke="#aaa59a" stroke-width="1"/>'
        +'<rect x="'+(cx+51)+'" y="'+(cy-36)+'" width="15" height="64" rx="7" fill="#d3cec1" stroke="#aaa59a" stroke-width="1"/>'
        +'<rect x="'+(cx-46)+'" y="'+(cy+42)+'" width="92" height="52" rx="18" fill="#e2ded2" stroke="#b3aea1" stroke-width="1.5"/>'
        +wave(cx,cy-30,n,cool,60)
        +'</g></g>';
    };
    const uid=(car.device_id||car.id||"tesla").replace(/[^a-z0-9]/gi,"");
    const leatherId="seat-leather-"+uid,spotId="cabin-spot-"+uid;
    const stW=car.picked?.steering?h.states?.[car.picked.steering.id]:null;
    const wh=!!stW&&!/^(off|false|0|unknown|unavailable)$/i.test(String(stW.state));
    const wcol=wh?"#e82127":"#8a8578",model=String(car.model||"");
    const cyberCab=/cybertruck/i.test(model),yoke=/cybertruck|model [sx]/i.test(model);
    const third=!!(car.picked?.seat3L||car.picked?.seat3R),cabinHeight=third?620:472;
    const dashBar=cyberCab?'<rect x="80" y="10" width="480" height="20" rx="4" fill="#1a1e23" stroke="#2c323a"/>':'<rect x="80" y="12" width="480" height="26" rx="13" fill="#16191d" stroke="#24292f"/>';
    const consoleBar=cyberCab?'<path d="M306 122h28l-3 140h-22z" fill="#16191d" stroke="#24292f"/>':'<rect x="306" y="122" width="28" height="140" rx="12" fill="#16191d" stroke="#24292f"/>';
return '<svg class="seat-cabin" viewBox="0 0 640 '+cabinHeight+'" role="group" aria-label="'+escAttr(car.model)+' cabin seat controls">'
      +'<defs><linearGradient id="'+leatherId+'" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#efece4"/><stop offset="100%" stop-color="#dcd7ca"/></linearGradient>'
      +'<radialGradient id="'+spotId+'" cx="50%" cy="40%" r="70%"><stop offset="0%" stop-color="#ffffff" stop-opacity=".05"/><stop offset="100%" stop-color="#ffffff" stop-opacity="0"/></radialGradient></defs>'
      +'<rect width="640" height="'+cabinHeight+'" rx="18" fill="#0a0c0f"/>'
      +'<rect width="640" height="'+cabinHeight+'" rx="18" fill="url(#'+spotId+')"/>'
      +dashBar
      +consoleBar
      +'<g class="seatc" data-act="seat-tap" data-car="'+i+'" data-key="steering" role="button" tabindex="0" aria-label="Steering wheel heat '+(wh?"on":"off")+'">'
      +(yoke?'<path d="M154 48Q190 34 226 48L216 86L198 72H182L164 86Z" fill="none" stroke="'+wcol+'" stroke-width="9" stroke-linejoin="round"'+(wh?' style="filter:drop-shadow(0 0 6px rgba(232,33,39,.7))"':"")+'/><path d="M190 72v25" stroke="'+wcol+'" stroke-width="8" stroke-linecap="round"/>':'<circle cx="190" cy="70" r="38" fill="none" stroke="'+wcol+'" stroke-width="9"'+(wh?' style="filter:drop-shadow(0 0 6px rgba(232,33,39,.7))"':"")+'/><circle cx="190" cy="70" r="8" fill="'+wcol+'"/><path d="M190 78v24M158 62l24 6M222 62l-24 6" stroke="'+wcol+'" stroke-width="7" stroke-linecap="round"/>')
      +'</g>'
      +[["seatLeft",195,170,"Front left",0],["seatRight",445,170,"Front right",0],["seatRL",155,third?340:356,"Rear left",1],["seatRC",320,third?340:356,"Rear center",1],["seatRR",485,third?340:356,"Rear right",1],["seat3L",230,505,"Third row left",1],["seat3R",410,505,"Third row right",1]].filter(d=>!/^seat3/.test(d[0])||third).map(d=>seat(d[0],d[1],d[2],d[3],d[4])).join("")
      +'</svg>';
  }
    _tireHtml(h,p,car){
    const m=String(car&&car.model||"").toLowerCase();
    const baseArt=/cybertruck/.test(m)?TPMS_ART_CYBER:/model [xy]/.test(m)?TPMS_ART_SUV:TPMS_ART_SEDAN;
    const uid=(car.device_id||car.id||"tesla").replace(/[^a-z0-9]/gi,"");
    const art=baseArt.replace(/tpms-(spot|body)-([a-z]+)/g,"tpms-$1-$2-"+uid);
    const W=[["tpmsFL","tpmsWarnFL","Front left",218,"end",135],["tpmsFR","tpmsWarnFR","Front right",422,"start",135],["tpmsRL","tpmsWarnRL","Rear left",218,"end",440],["tpmsRR","tpmsWarnRR","Rear right",422,"start",440]];
    const parts=W.map(([key,warnKey,label,x,anchor,y])=>{
      const ent=p[key];if(!ent)return "";
      const v=stateOf(h,ent),n=parseFloat(v),warning=openState(stateOf(h,p[warnKey]));
      const col=!Number.isFinite(n)?"#545b62":warning?"#f5a623":"#e9ebed";
      const shown=Number.isFinite(n)?String(Math.round(n)):"-",unit=unitOf(h,ent,"");
      return '<text x="'+x+'" y="'+y+'" text-anchor="'+anchor+'" font-size="30" font-weight="600" fill="'+col+'" font-family="inherit">'+shown+' <tspan font-size="15" font-weight="500">'+esc(unit)+'</tspan></text>'
        +'<text x="'+x+'" y="'+(y+22)+'" text-anchor="'+anchor+'" font-size="12" fill="#8a9096" font-family="inherit">'+label+'</text>';
    }).join("");
    if(!parts)return "";
    return '<svg class="tires" viewBox="0 0 640 560" role="img" aria-label="Tire pressure" style="max-height:560px">'+art+parts+'</svg>';
  }
  _sensorRow(h,ent,icon){
    if(!ent)return "";
    const u=h.states?.[ent.id]?.attributes?.unit_of_measurement||"";
    return '<div><i class="rowicon">'+this._icon(icon)+'</i><span>'+esc(ent.name||ent.id.split(".").pop())+'</span><b>'+esc(stateOf(h,ent)||"-")+(u?" "+esc(u):"")+'</b></div>';
  }
  async _historyLoad(){
    if(this._historyLoading||!this._hass?.callWS||!this._cars?.length||Date.now()<(this._historyRetryAt||0))return;
    const ids=this._cars.map(c=>c.picked.tracker?.id).filter(Boolean).sort();
    if(!ids.length)return;
    const days=Math.max(1,Math.min(30,+this._config?.history_days||7));
    const key=days+"|"+ids.join(",");
    const ttl=Math.max(60000,Math.min(900000,+this._config?.history_ttl_ms||300000));
    if(this._historyKey===key && Date.now()-(this._historyAt||0)<ttl)return;
    this._historyLoading=true;
    this._historyKey=key;
    try{
      const end=new Date(),start=new Date(end.getTime()-days*86400000);
      const rows=await this._hass.callWS({
        type:"history/history_during_period",
        start_time:start.toISOString(),
        end_time:end.toISOString(),
        entity_ids:ids,
        minimal_response:false,
        significant_changes_only:false
      });
      this._history=rows||{};
      this._historyAt=Date.now();
      this._render(true);
    }catch(e){
      this._historyKey="";this._historyRetryAt=Date.now()+30000;
    }finally{this._historyLoading=false}
  }
  _route(car,points){
    const pts=points||historyPoints(this._history?.[car.picked.tracker?.id]||[]);
    if(pts.length<2)return '<div class="map-empty">Recorder route history appears when Home Assistant retains latitude/longitude.</div>';
    const la=pts.map(p=>p.lat),lo=pts.map(p=>p.lon),a=Math.min(...la),b=Math.max(...la),c=Math.min(...lo),d=Math.max(...lo),sx=x=>24+(x-c)/Math.max(d-c,.00001)*352,sy=y=>176-(y-a)/Math.max(b-a,.00001)*136;
    const path=pts.map((p,i)=>(i?"L":"M")+sx(p.lon).toFixed(1)+" "+sy(p.lat).toFixed(1)).join(" "),q=pts[pts.length-1];
    return '<svg class="route" viewBox="0 0 400 200"><path d="'+path+'" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"/><circle cx="'+sx(q.lon)+'" cy="'+sy(q.lat)+'" r="6" fill="#e82127"/></svg>';
  }
  _tripHtml(car){
    const id=car.picked.tracker?.id||"",key=id+"|"+(this._historyAt||0);
    this._tripCache=this._tripCache||new Map();let cached=this._tripCache.get(key);
    if(!cached){const retained=historyPoints(this._history?.[id]||[]),trips=detectTrips(this._history?.[id]||[]),retainedDistance=retained.reduce((sum,p,i,a)=>i?sum+haversine(a[i-1],p):sum,0);cached={retained,trips,retainedDistance};this._tripCache.clear();this._tripCache.set(key,cached)}
    const {retained,trips,retainedDistance}=cached;
    if(!trips.length)return '<div class="trip-empty">No completed trips detected in retained GPS history.</div>';
    return '<div class="trips">'+trips.slice(0,5).map((t,i)=>'<article class="trip"><div class="trip-head"><b>'+(i===0?"Latest estimated trip":"Estimated trip "+(i+1))+'</b><span>'+fmtDistance(t.distance)+'</span></div><div class="trip-meta"><span>'+fmtTime(t.start)+' -> '+fmtTime(t.end)+'</span><span>'+fmtDuration(t.duration)+'</span></div>'+this._route(car,t.points)+'</article>').join("")+'</div><div class="route-full"><div class="trip-head"><b>Full retained Recorder route</b><span>'+fmtDistance(retainedDistance)+'</span></div>'+this._route(car,retained)+'</div>';
  }
  _carHtml(car,i,h){
    const p=car.picked,soc=num(h,p.battery),range=stateOf(h,p.range),charging=stateOf(h,p.charging),inside=stateOf(h,p.inside),outside=stateOf(h,p.outside);
    const locked=stateOf(h,p.lock)==="locked",climateState=stateOf(h,p.climate),climate=!!p.climate&&!/^(|off|unknown|unavailable)$/i.test(climateState),sentry=stateOf(h,p.sentry)==="on";
    const port=openState(stateOf(h,p.port)),frunk=openState(stateOf(h,p.frunk)),trunk=openState(stateOf(h,p.trunk)),windows=openState(stateOf(h,p.windows));
    const active=/^(charging|starting)\b/i.test(String(charging).trim()),width=soc==null?0:Math.max(0,Math.min(100,soc)),lowBattery=soc!=null&&soc<=20;
    const t=p.tracker,attrs=t?h.states[t.id]?.attributes||{}:{},cc=coords(h,t),address=attrs.address||attrs.location_name||stateOf(h,t)||"Location unavailable";
    const doors=[["doorDriver","Front driver",p.doorDriver],["doorPassenger","Front passenger",p.doorPassenger],["doorRearDriver","Rear driver",p.doorRearDriver],["doorRearPassenger","Rear passenger",p.doorRearPassenger]].filter(x=>x[2]);
    const wins=[["windowDriver","Front driver",p.windowDriver],["windowPassenger","Front passenger",p.windowPassenger],["windowRearDriver","Rear driver",p.windowRearDriver],["windowRearPassenger","Rear passenger",p.windowRearPassenger]].filter(x=>x[2]);
    const climateAttrs=p.climate?h.states[p.climate.id]?.attributes||{}:{};
    const climateTemp=Number(climateAttrs.temperature);
    const climateMin=Number.isFinite(Number(climateAttrs.min_temp))?Number(climateAttrs.min_temp):(Number.isFinite(climateTemp)?climateTemp-10:0);
    const climateMax=Number.isFinite(Number(climateAttrs.max_temp))?Number(climateAttrs.max_temp):(Number.isFinite(climateTemp)?climateTemp+10:100);
    const climateStep=Number.isFinite(Number(climateAttrs.target_temp_step))?Number(climateAttrs.target_temp_step):1;
    const chargeOn=stateOf(h,p.chargeSwitch)==="on";
    const controls=[
      domainOf(p.lock)==="lock"&&this._btn(i,"lock",locked?"Unlock":"Lock","toggle",locked),
      domainOf(p.climate)==="climate"&&this._btn(i,"climate","Climate","toggle",climate),
      domainOf(p.horn)==="button"&&this._btn(i,"horn","Honk","press"),
      domainOf(p.flash)==="button"&&this._btn(i,"flash","Flash","press"),
      p.frunk&&/^(cover|button|switch)$/.test(domainOf(p.frunk))&&this._btn(i,"frunk","Frunk","toggle",frunk),
      p.trunk&&/^(cover|button|switch)$/.test(domainOf(p.trunk))&&this._btn(i,"trunk","Trunk","toggle",trunk),
      ((p.port&&/^(cover|button|switch)$/.test(domainOf(p.port)))||p.portOpen||p.portClose)&&this._btn(i,"port","Charge Port","toggle",port),
      domainOf(p.sentry)==="switch"&&this._btn(i,"sentry","Sentry","toggle",sentry),
      domainOf(p.chargeSwitch)==="switch"&&this._btn(i,"chargeSwitch",chargeOn?"Stop Charge":"Start Charge","toggle",chargeOn),
      domainOf(p.wake)==="button"&&this._btn(i,"wake","Wake","press"),
      domainOf(p.refresh)==="button"&&this._btn(i,"refresh","Refresh","press"),
      /^(button|switch)$/.test(domainOf(p.start))&&this._btn(i,"start","Start","press")
    ].filter(Boolean).join("");
    const comfort=(domainOf(p.windows)==="cover"?'<button class="ctrl" data-car="'+i+'" data-act="windows-vent">'+this._icon("windows")+'<small>Vent Windows</small></button><button class="ctrl" data-car="'+i+'" data-act="windows-close">'+this._icon("windows")+'<small>Close Windows</small></button>':"");
    const cOpen=!!this._climateOpen?.[car.id],chgOpen=!!this._chargingOpen?.[car.id];
    const tempUnit=h.config?.unit_system?.temperature||"\u00b0F";
    const interior='<div class="interior seatpage">'+this._seatCabin(h,car,i)+'<div class="interior-chips"><span>Cabin '+esc(inside||"-")+esc(tempUnit)+'</span><span>Outside '+esc(outside||"-")+esc(tempUnit)+'</span><span>'+(climate?"HVAC on":"HVAC off")+'</span></div></div>';
    const tires=this._tireHtml(h,p,car);
    const sensors=this._sensorRow(h,p.energyAdded,"flash")+this._sensorRow(h,p.odometer,"gauge")+this._sensorRow(h,p.parkingBrake,"brake")+this._sensorRow(h,p.shift,"shift")+this._sensorRow(h,p.chargeRate,"gauge")+this._sensorRow(h,p.chargeTime,"clock")+this._sensorRow(h,p.schedCharging,"calendar")+this._sensorRow(h,p.schedDeparture,"calendar")+this._sensorRow(h,p.userPresent,"user")+this._sensorRow(h,p.arrival,"hourglass")+this._sensorRow(h,p.distanceArrival,"pin")+this._sensorRow(h,p.charger,"plug");
    const rows='<div><span>Online</span><b>'+esc(p.online?titleState(stateOf(h,p.online)):"Unknown")+'</b></div><div><span>Charge port</span><b class="'+(port?"open-state":"")+'">'+esc(readableState(h,p.port))+'</b></div><div><span>Frunk</span><b class="'+(frunk?"open-state":"")+'">'+esc(readableState(h,p.frunk))+'</b></div><div><span>Trunk</span><b class="'+(trunk?"open-state":"")+'">'+esc(readableState(h,p.trunk))+'</b></div><div><span>Windows</span><b class="'+(windows?"open-state":"")+'">'+esc(readableState(h,p.windows))+'</b></div>'+doors.map(x=>'<div><span>'+esc(x[1])+' door</span><b class="'+(openState(stateOf(h,x[2]))?"open-state":"")+'">'+esc(readableState(h,x[2]))+'</b></div>').join("")+wins.map(x=>'<div><span>'+esc(x[1])+' window</span><b class="'+(openState(stateOf(h,x[2]))?"open-state":"")+'">'+esc(readableState(h,x[2]))+'</b></div>').join("");
    const trip=this._tripHtml(car);
    const rangeUnit=unitOf(h,p.range),powerUnit=unitOf(h,p.power,"kW"),limitUnit=unitOf(h,p.limit,"%"),ampsUnit=unitOf(h,p.amps,"A");
    const shortLoc=String(address).split(",")[0]||"-";
    const pOpen=!!this._paintOpen?.[car.id];
    return '<article class="car">'+
      '<header class="tile-head"><div class="wordmark">TESLA</div><div class="model-name">'+esc(car.model)+'</div><div class="car-sub">'+esc(car.name)+' &middot; '+(active?"Charging":stateOf(h,p.asleep)==="on"?"Asleep":/^(unavailable|unknown)$/i.test(stateOf(h,p.online))?"Status unavailable":"Parked")+'</div><button class="gear-btn'+(pOpen?" on":"")+'" data-car="'+i+'" data-act="paint-gear" title="Vehicle settings \u2022 paint color" aria-label="Vehicle settings and paint color" aria-expanded="'+pOpen+'">'+this._gearIcon()+'</button></header>'+
      (pOpen?'<div class="paint-menu" role="dialog" aria-label="'+escAttr(car.model)+' paint selection"><div class="panel-kicker">Paint Color</div>'+this._swatches(car,i)+'<div class="panel-note">Saved for this vehicle</div></div>':"")+
      '<div class="visual">'+this._vehicleArt(car,active,frunk||trunk||port)+'</div>'+
      '<div class="hero-panel">'+
        '<div class="panel energy-panel"><div class="soc-row"><svg class="bat '+(active?"charging":lowBattery?"low":"normal")+'" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><rect x="2" y="7" width="17" height="10" rx="3"/><rect x="20.5" y="10" width="2.5" height="4" rx="1.2"/></svg><strong>'+(soc==null?"-":soc)+'<small>%</small></strong></div><div class="bar '+(active?"charging":lowBattery?"low":"normal")+'"><i style="width:'+width+'%"></i></div><div class="meta-row"><span>'+esc(range||"-")+(rangeUnit?" "+esc(rangeUnit):"")+'</span><i class="dot"></i><span>'+esc(inside||"-")+esc(tempUnit)+' cabin</span><i class="dot"></i><span>'+esc(stateOf(h,p.power)||"-")+(stateOf(h,p.power)?' '+esc(powerUnit):'')+'</span></div></div>'+
        '<div class="panel charge-panel"><div class="charge-head'+(active?"":" idle")+'"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13 2L5 13h5l-1 9 8-11h-5l1-9z"/></svg><div><b>'+esc(active?"Charging":(charging||"Not charging"))+'</b><small>'+esc(shortLoc)+'</small></div></div><button class="charge-line" data-car="'+i+'" data-act="charging-tab" aria-expanded="'+chgOpen+'"><span>Charge Limit</span><span><b>'+esc(num(h,p.limit)??"-")+esc(limitUnit)+'</b><i class="chev">&rsaquo;</i></span></button><button class="charge-line" data-car="'+i+'" data-act="charging-tab" aria-expanded="'+chgOpen+'"><span>Amps</span><span><b>'+esc(num(h,p.amps)??"-")+esc(ampsUnit)+'</b><i class="chev">&rsaquo;</i></span></button></div>'+
        '<div class="quick-controls">'+controls+'</div>'+
      '</div>'+
      '<section><div class="title"><button class="sec-title" data-car="'+i+'" data-act="climate-tab" aria-expanded="'+cOpen+'"><b>Climate</b><i class="chev'+(cOpen?" rot":"")+'">&rsaquo;</i></button><small>'+esc(climateAttrs.hvac_action||"Live cabin state")+'</small></div>'+(cOpen?interior:"")+'<div class="climate"><span>Cabin <b>'+esc(inside||"-")+'</b></span><span>Outside <b>'+esc(outside||"-")+'</b></span><span>Mode <b>'+esc(titleState(climateAttrs.hvac_mode||climateAttrs.hvac_action||"-"))+'</b></span><span>State <b>'+(climate?"ON":"OFF")+'</b></span></div>'+
        (p.climate?'<div class="climate-controls">'+
          (Number.isFinite(climateTemp)?'<label class="climate-temp"><span>Target</span><b>'+esc(this._climateDraft?.[car.id]??climateTemp)+esc(tempUnit)+'</b><input data-car="'+i+'" data-act="climate-temp" data-unit="'+escAttr(tempUnit)+'" aria-label="Target cabin temperature" type="range" min="'+esc(climateMin)+'" max="'+esc(climateMax)+'" step="'+esc(climateStep)+'" value="'+esc(this._climateDraft?.[car.id]??climateTemp)+'"></label><button data-car="'+i+'" data-act="climate-temp-apply"'+(this._busy?.has(p.climate.id)?' disabled aria-busy="true"':'')+'>Apply</button>':"")+
          ((climateAttrs.hvac_modes||[]).length>1?'<button data-car="'+i+'" data-act="climate-mode"'+(this._busy?.has(p.climate.id)?' disabled':'')+'>Mode: '+esc(titleState(climateAttrs.hvac_mode||"-"))+'</button>':"")+
          ((climateAttrs.fan_modes||[]).length>1?'<button data-car="'+i+'" data-act="climate-fan"'+(this._busy?.has(p.climate.id)?' disabled':'')+'>Fan: '+esc(titleState(climateAttrs.fan_mode||"-"))+'</button>':"")+
        '</div>':"")+
        (comfort?'<div class="comfort"><div class="comfort-head">Comfort</div><div class="comfort-grid">'+comfort+'</div></div>':"")+
      '</section>'+
      '<section><div class="title"><b>Vehicle</b><small>Live state</small></div><div class="states">'+rows+'</div></section>'+
      (tires?'<section><div class="title"><b>Tires</b><small>TPMS live pressure</small></div>'+tires+'</section>':"")+
      (sensors?'<section><div class="title"><b>Sensors</b><small>Everything the integration exposes</small></div><div class="states sensors">'+sensors+'</div></section>':"")+
      '<section><div class="title"><button class="sec-title" data-car="'+i+'" data-act="charging-tab" aria-expanded="'+chgOpen+'"><b>Charging</b><i class="chev'+(chgOpen?" rot":"")+'">&rsaquo;</i></button><small>'+esc(/^(unknown|unavailable)$/i.test(charging)?"Unknown":charging||"Unknown")+'</small></div>'+(chgOpen?'<div class="chargegrid"><span>Limit <b>'+esc(num(h,p.limit)??"-")+esc(limitUnit)+'</b></span><span>Amps <b>'+esc(num(h,p.amps)??"-")+esc(ampsUnit)+'</b></span><span>Added <b>'+esc(stateOf(h,p.added)||"-")+(stateOf(h,p.added)?" "+esc(unitOf(h,p.added)):"")+'</b></span><span>Time <b>'+esc(stateOf(h,p.timeLeft)||"-")+(stateOf(h,p.timeLeft)?" "+esc(unitOf(h,p.timeLeft)):"")+'</b></span></div>'+(/^(number|input_number)$/.test(domainOf(p.limit))?'<label>Charge limit <b>'+esc(num(h,p.limit)??"-")+esc(limitUnit)+'</b><input data-car="'+i+'" data-key="limit" data-unit="'+escAttr(limitUnit)+'" aria-label="Charge limit" type="range" min="'+(h.states[p.limit.id]?.attributes?.min??50)+'" max="'+(h.states[p.limit.id]?.attributes?.max??100)+'" step="'+(h.states[p.limit.id]?.attributes?.step??1)+'" value="'+(num(h,p.limit)??80)+'"></label>':"")+(/^(number|input_number)$/.test(domainOf(p.amps))?'<label>Charge current <b>'+esc(num(h,p.amps)??"-")+esc(ampsUnit)+'</b><input data-car="'+i+'" data-key="amps" data-unit="'+escAttr(ampsUnit)+'" aria-label="Charge current" type="range" min="'+(h.states[p.amps.id]?.attributes?.min??1)+'" max="'+(h.states[p.amps.id]?.attributes?.max??48)+'" step="'+(h.states[p.amps.id]?.attributes?.step??1)+'" value="'+(num(h,p.amps)??5)+'"></label>':""):"")+'</section>'+
      '<section><div class="title"><b>Location</b><small>'+(cc?cc.lat.toFixed(5)+", "+cc.lon.toFixed(5):"GPS unavailable")+'</small></div><strong class="address">'+esc(address)+'</strong></section>'+
      '<section><div class="title"><b>Recorder route history</b><small>Estimated trips \u00b7 '+Math.max(1,Math.min(30,+this._config?.history_days||7))+' days</small></div>'+trip+'</section>'+
      '</article>';
  }
  _dashboardNav(){
    if(String(this._config?.mode||"").toLowerCase()!=="dashboard")return "";
    const items=[["overview","Overview"]].concat((this._cars||[]).map((c,i)=>["car:"+i,c.name||c.model||("Tesla "+(i+1))]));
    return '<nav class="dash-nav" aria-label="Tesla dashboard views">'+items.map(([key,label])=>'<button class="dash-tab '+(this._dashboardView===key?"active":"")+'" data-act="dashboard-view" data-view="'+escAttr(key)+'">'+esc(label)+'</button>').join("")+'</nav>';
  }
  _overviewHtml(h){
    const cards=(this._cars||[]).map((car,i)=>{
      const p=car.picked||{},soc=num(h,p.battery),range=stateOf(h,p.range),charging=stateOf(h,p.charging),online=stateOf(h,p.online);
      const active=/^(charging|starting)\b/i.test(String(charging).trim()),width=soc==null?0:Math.max(0,Math.min(100,soc));
      const status=active?"Charging":stateOf(h,p.asleep)==="on"?"Asleep":/^(unavailable|unknown)$/i.test(String(online))?"Status unavailable":"Parked";
      return '<button class="overview-car" data-act="dashboard-view" data-view="car:'+i+'" aria-label="Open '+escAttr(car.name||car.model)+'">'+
        '<div class="overview-car-head"><div><div class="wordmark">TESLA</div><b>'+esc(car.model||"Tesla")+'</b><small>'+esc(car.name||"Tesla")+'</small></div><span>'+esc(status)+'</span></div>'+
        '<div class="overview-visual">'+this._vehicleArt(car,active,false)+'</div>'+
        '<div class="overview-stats"><div><strong>'+(soc==null?"-":soc)+'<small>%</small></strong><span>Charge</span><i><em style="width:'+width+'%"></em></i></div><div><strong>'+esc(range||"-")+'</strong><span>Range</span></div><div><strong>'+esc(stateOf(h,p.inside)||"-")+'</strong><span>Cabin</span></div></div>'+
        '<div class="overview-open">Open vehicle <b>\u203a</b></div></button>';
    }).join("");
    return '<section class="dashboard-overview"><div class="dashboard-kicker">TESLA</div><h1>Garage</h1><p>Every vehicle. One command center.</p><div class="overview-grid">'+cards+'</div></section>';
  }

  _render(force=false){
    if(!this.shadowRoot||!this._hass)return;
    const activeInput=this.shadowRoot.activeElement;
    if(!force&&activeInput&&/^(range|color)$/.test(activeInput.type)){this._pendingRender=true;return}
    const h=this._hass,all=this._registry?.entities||[],by=new Map();

    // Most Tesla entities have a device_id. A few versions/configurations of
    // integrations can expose valid Tesla entities without one, so don't drop
    // those entities and render an empty dashboard. Group orphaned entities by
    // the vehicle portion of their friendly name/entity id.
    const vehicleKey=(e)=>{
      const raw=String(
        e.state?.attributes?.friendly_name ||
        e.name ||
        e.id ||
        ""
      ).toLowerCase().replace(/[._-]+/g," ");
      const cleaned=raw
        .replace(/\b(battery|charge|charging|range|climate|hvac|lock|door|window|frunk|trunk|horn|flash|sentry|wake|refresh|odometer|location|vehicle|status|online|temperature|inside|outside|tire|tpms|seat|steering|charger|connector|port|power|amps|current|limit|energy|time|schedule|departure|arrival|distance|parking|brake|shift|user|present|remote|start|keyless|driving|switch|button|sensor|number|select|cover|tracker)\b/g," ")
        .replace(/\s+/g," ").trim();
      return cleaned || "tesla";
    };

    for(const e of all){
      const state=h.states?.[e.id];
      if(!state)continue;
      e.state=state;
      const k=e.device_id || "orphan:"+vehicleKey(e);
      if(!by.has(k))by.set(k,[]);
      by.get(k).push(e);
    }

    this._cars=[...by].map(([id,es])=>{
      const deviceId=id.startsWith("orphan:")?null:id;
      const fallbackName=es.map(e=>e.state?.attributes?.friendly_name||e.name).find(Boolean);
      return {
        id,
        device_id:deviceId,
        name:deviceId?deviceName(this._registry,deviceId):String(fallbackName||"Tesla").replace(/\s+(battery|charge|charging|range|climate|lock|door|window|frunk|trunk|horn|sentry|odometer|location|status).*$/i,"").trim()||"Tesla",
        model:vehicleModel(h,this._registry,deviceId,es),
        picked:pick(es)
      };
    }).filter(c=>Object.values(c.picked).some(Boolean));
    const signature=JSON.stringify(this._cars.map(c=>[c.id,...Object.values(c.picked).filter(Boolean).map(e=>{const st=h.states[e.id];return[e.id,st?.state,st?.last_updated,st?.attributes]})]));
    if(!force&&signature===this._renderSignature&&this.shadowRoot.querySelector(".wrap"))return;
    this._renderSignature=signature;
    const notice=this._notice?'<div class="notice" role="status" aria-live="polite">'+esc(this._notice)+'</div>':"";
    const confirm=this._confirm?'<div class="confirm"><div class="confirm-box" role="dialog" aria-modal="true" aria-labelledby="tesla-confirm-title"><b id="tesla-confirm-title">Confirm '+esc(this._confirm.key)+' command</b><p>Send this command to '+esc(this._confirm.car)+'?</p><div class="confirm-actions"><button class="no" data-act="confirm" data-choice="no">Cancel</button><button class="yes" data-act="confirm" data-choice="yes">Confirm</button></div></div></div>':"";
    const dashboard=String(this._config?.mode||"").toLowerCase()==="dashboard";
    if(dashboard&&this._dashboardView!=="overview"){
      const n=Number(String(this._dashboardView).split(":")[1]);
      if(!Number.isInteger(n)||!this._cars[n])this._dashboardView="overview";
    }
    const body=this._registry
      ? (this._cars.length
          ? (dashboard
              ? (this._dashboardView==="overview" ? this._overviewHtml(h) : this._carHtml(this._cars[Number(String(this._dashboardView).split(":")[1])],Number(String(this._dashboardView).split(":")[1]),h))
              : this._cars.map((c,i)=>this._carHtml(c,i,h)).join(""))
          : '<article class="car empty">No Tesla vehicles detected. Add Tesla Custom or Tesla Fleet and reload.</article>')
      : '<article class="car empty">Loading Tesla vehicles...</article>';
    this.shadowRoot.innerHTML='<style>'+TESLA_CARD_CSS+'</style><div class="wrap '+(dashboard?"dashboard-mode":"card-mode")+'">'+notice+(dashboard?this._dashboardNav():"")+body+confirm+'</div>';
    const w=this.shadowRoot.querySelector(".wrap");
    w.onclick=e=>this._onClick(e);w.oninput=e=>this._onInput(e);w.onchange=e=>this._onChange(e);w.onkeydown=e=>this._onKeyDown(e);w.onfocusout=()=>setTimeout(()=>{if(this._pendingRender&&!/^(range|color)$/.test(this.shadowRoot.activeElement?.type||"")){this._pendingRender=false;this._render()}},0);
    this.shadowRoot.querySelectorAll('.vehicle-photo').forEach(img=>{const box=img.closest('.vehicle-stack'),done=ok=>{box?.classList.toggle('loaded',ok);box?.classList.toggle('failed',!ok)};img.onload=()=>done(true);img.onerror=()=>done(false);if(img.complete)done(img.naturalWidth>0)});
    if(this._confirm)queueMicrotask(()=>this.shadowRoot.querySelector('.confirm .no')?.focus());
  }
}
if(!customElements.get("tesla-share-card"))customElements.define("tesla-share-card", TeslaShareCard);
window.customCards = window.customCards || [];
if(!window.customCards.some(c=>c.type==="tesla-share-card"))window.customCards.push({
  type: "tesla-share-card",
  name: "Tesla Share",
  description: "Every Tesla, automatically discovered. Card or Tesla-style dashboard. No entity ids.",
});

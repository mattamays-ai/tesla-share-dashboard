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
  const byText = re => find(entities, [e => re.test((e.id + " " + (e.state?.attributes?.friendly_name || "")).toLowerCase())]);
  return {
    battery: find(entities,[e=>domain("sensor")(e)&&dc("battery")(e)&&!/powerwall|backup/.test(e.id),ends(["_battery","_battery_level"])]),
    range: find(entities,[byText(/battery.*range|estimated.*range/),ends(["_battery_range","_estimated_range"])]),
    charging: find(entities,[byText(/charging.*state|charge.*state/),ends(["_charging_state","_charging"])]),
    online: find(entities,[byText(/online|connectivity|vehicle.*status/),ends(["_online","_status"]),dc("connectivity")]),
    asleep: find(entities,[byText(/asleep|sleeping/),ends(["_asleep"])]),
    inside: find(entities,[byText(/inside.*temperature|cabin.*temperature|interior.*temperature/),ends(["_temperature_inside","_inside_temperature"])]),
    outside: find(entities,[byText(/outside.*temperature|exterior.*temperature/),ends(["_temperature_outside","_outside_temperature"])]),
    lock: find(entities,[domain("lock"),byText(/door.*lock|vehicle.*lock|lock/),ends(["_lock"])]),
    climate: find(entities,[domain("climate"),byText(/climate|hvac/)]),
    sentry: find(entities,[byText(/sentry/),ends(["_sentry_mode"])]),
    port: find(entities,[byText(/charge.*port|charger.*door/),ends(["_charger_door","_charge_port_door"])]),
    frunk: find(entities,[byText(/frunk/),ends(["_frunk"])]),
    trunk: find(entities,[byText(/trunk|boot/),ends(["_trunk","_boot"])]),
    windows: find(entities,[byText(/windows|window.*state/),ends(["_windows","_vent_windows"])]),
    doorDriver: byText(/driver.*door|left.*front.*door|front.*left.*door/),
    doorPassenger: byText(/passenger.*door|right.*front.*door|front.*right.*door/),
    doorRearLeft: byText(/rear.*left.*door|left.*rear.*door/),
    doorRearRight: byText(/rear.*right.*door|right.*rear.*door/),
    windowDriver: byText(/driver.*window|left.*front.*window/),
    windowPassenger: byText(/passenger.*window|right.*front.*window/),
    windowRear: byText(/rear.*window/),
    wake: find(entities,[byText(/wake/),ends(["_wake_up","_wake"])]),
    flash: find(entities,[byText(/flash.*light|lights.*flash/),ends(["_flash_lights"])]),
    horn: find(entities,[byText(/horn|honk/),ends(["_horn","_honk_horn"])]),
    start: find(entities,[byText(/remote.*start|keyless/),ends(["_remote_start","_keyless_driving"])]),
    refresh: find(entities,[byText(/force.*data.*update|refresh/),ends(["_force_data_update"])]),
    power: find(entities,[byText(/charger.*power|charging.*power/),ends(["_charger_power"])]),
    added: find(entities,[byText(/energy.*added|charge.*energy.*added/),ends(["_energy_added","_charge_energy_added"])]),
    timeLeft: find(entities,[byText(/time.*charge|time.*full|charge.*complete/),ends(["_time_charge_complete","_time_to_full_charge"])]),
    chargeSwitch: find(entities,[domain("switch"),byText(/charger|charge/)]),
    limit: find(entities,[byText(/charge.*limit/),ends(["_charge_limit"])]),
    amps: find(entities,[byText(/charging.*amps|charge.*current/),ends(["_charging_amps","_charge_current"])]),
    tracker: find(entities,[domain("device_tracker"),byText(/location|vehicle/),e=>!/destination|route/.test(e.id)]),
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


function vehicleModel(hass, deviceId, entities) {
  const d = hass.devices?.[deviceId] || {};
  const text = [d.model,d.name,d.name_by_user,...entities.map(e=>e.state?.attributes?.model)].filter(Boolean).join(" ");
  return ["Model 3","Model Y","Model S","Model X","Cybertruck","Roadster"].find(m=>new RegExp("\\b"+m.replace(" ","\\s+")+"\\b","i").test(text)) || "Tesla";
}
function coords(hass, ent) {
  const a = ent ? hass.states?.[ent.id]?.attributes || {} : {};
  const lat=Number(a.latitude), lon=Number(a.longitude);
  return Number.isFinite(lat)&&Number.isFinite(lon)?{lat,lon}:null;
}
function titleState(s){const x=String(s||"").replace(/_/g," ");return x?x[0].toUpperCase()+x.slice(1):"Unknown";}
function openState(s){return /^(open|opening|on|true|unlocked)$/i.test(String(s));}
class TeslaShareCard extends HTMLElement {
  static getConfigElement(){return null}
  setConfig(config){this._config=config||{}}
  getCardSize(){return 12}
  connectedCallback(){if(!this.shadowRoot)this.attachShadow({mode:"open"});this._render()}
  set hass(h){this._hass=h;this._render();this._historyLoad()}
  _service(ent,service,data={}){
    if(!ent||!this._hass)return;
    const d=ent.id.split(".")[0];
    this._hass.callService(d,service,{entity_id:ent.id,...data});
  }
  _action(ent,kind){
    if(!ent)return;
    const d=ent.id.split(".")[0], s=stateOf(this._hass,ent);
    if(kind==="toggle"){
      const service=d==="lock"?(s==="locked"?"unlock":"lock"):d==="switch"?(s==="on"?"turn_off":"turn_on"):d==="climate"?(s==="off"?"turn_on":"turn_off"):d==="cover"?(openState(s)?"close_cover":"open_cover"):null;
      if(service)this._service(ent,service);
    } else if(kind==="press") this._service(ent,"press");
  }
  _color(car){
    const key=car.device_id||car.id||car.name,cfg=this._config?.colors||{};
    if(cfg[key])return cfg[key]; if(cfg[car.name])return cfg[car.name];
    try{return localStorage.getItem("tesla-share-color:"+key)||"#f4f4f4"}catch{return "#f4f4f4"}
  }
  _onClick(e){
    const b=e.target.closest("[data-act]");if(!b)return;
    const car=this._cars?.[+b.dataset.car];if(!car)return;
    if(b.dataset.act==="color"){try{localStorage.setItem("tesla-share-color:"+(car.device_id||car.id||car.name),b.dataset.color||b.value)}catch{}this._render();return}
    this._action(car.picked?.[b.dataset.key],b.dataset.act);
  }
  _onChange(e){
    const x=e.target,car=this._cars?.[+x.dataset.car];if(!car)return;
    if(x.dataset.act==="color"){try{localStorage.setItem("tesla-share-color:"+(car.device_id||car.id||car.name),x.value)}catch{}this._render();return}
    const ent=car.picked?.[x.dataset.key];if(!ent)return;
    const d=ent.id.split(".")[0];if(x.type==="range")this._service(ent,d==="number"?"set_value":"set_value",{value:+x.value});
  }
  _stockCar(car,charging,open){
    const p=this._color(car),m=car.model;
    const shape=m==="Cybertruck"?"M65 145L120 72L360 58L505 74L575 116L595 145L560 158H90Z":
      m==="Model S"?"M65 147C90 95 150 73 255 70L430 77C505 82 550 108 590 142L565 160H92Z":
      m==="Model X"?"M65 147C90 91 150 69 250 68L430 74C505 78 550 106 590 142L565 160H92Z":
      "M65 147C90 98 145 77 230 72L425 77C505 80 550 106 590 142L565 160H92Z";
    return '<svg viewBox="0 0 640 220" class="car-svg '+(charging?"charging ":"")+(open?"open":"")+'"><path d="'+shape+'" fill="'+p+'"/><path d="M160 82C220 67 330 68 405 78C450 83 480 96 515 116H168Z" fill="#17181b"/><circle cx="175" cy="158" r="27" fill="#080808" stroke="'+p+'" stroke-width="8"/><circle cx="465" cy="158" r="27" fill="#080808" stroke="'+p+'" stroke-width="8"/><circle class="charge" cx="112" cy="133" r="7" fill="#3e6ae1"/><path class="bolt" d="M250 140h42l-10 17h28l-40 38 10-22h-27z" fill="#e82127"/>'+(open?'<path d="M190 112V73M360 112V76" stroke="'+p+'" stroke-width="5" stroke-linecap="round"/>':"")+'</svg>';
  }
  _swatches(car,i){
    const cs=["#f4f4f4","#171a20","#e82127","#3e6ae1","#9a9a9e","#c4a574"],cur=this._color(car);
    return '<div class="colors">'+cs.map(x=>'<button class="swatch '+(x.toLowerCase()===cur.toLowerCase()?"on":"")+'" data-car="'+i+'" data-act="color" data-color="'+x+'" style="background:'+x+'"></button>').join("")+'<input class="picker" data-car="'+i+'" data-act="color" type="color" value="'+(/^#[0-9a-f]{6}$/i.test(cur)?cur:"#f4f4f4")+'"></div>';
  }
  _btn(i,key,label,act="toggle",on=false){return '<button class="ctrl '+(on?"on":"")+'" data-car="'+i+'" data-key="'+key+'" data-act="'+act+'"><span>'+esc({lock:"🔒",climate:"◌",sentry:"◉",port:"ϟ",frunk:"▱",trunk:"▱",windows:"▥",wake:"↻",refresh:"↻",flash:"✦",horn:"♬",start:"▶"}[key]||"•")+'</span><small>'+esc(label)+'</small></button>'}
  async _historyLoad(){
    if(this._historyLoading||!this._hass?.callWS||!this._cars?.length)return;
    const ids=this._cars.map(c=>c.picked.tracker?.id).filter(Boolean);if(!ids.length)return;
    this._historyLoading=true;
    try{
      const days=Math.max(1,Math.min(30,+this._config?.history_days||7));
      const rows=await this._hass.callWS({type:"history/history_during_period",start_time:new Date(Date.now()-days*86400000).toISOString(),end_time:new Date().toISOString(),entity_ids:ids,minimal_response:false,significant_changes_only:false});
      this._history=rows||{};this._render();
    }catch(e){}finally{this._historyLoading=false}
  }
  _route(car){
    const rows=this._history?.[car.picked.tracker?.id]||[],pts=rows.map(x=>{const a=x.attributes||{},lat=+a.latitude,lon=+a.longitude;return Number.isFinite(lat)&&Number.isFinite(lon)?{lat,lon}:null}).filter(Boolean);
    if(pts.length<2)return '<div class="map-empty">GPS history appears here when Recorder retains latitude/longitude.</div>';
    const la=pts.map(p=>p.lat),lo=pts.map(p=>p.lon),a=Math.min(...la),b=Math.max(...la),c=Math.min(...lo),d=Math.max(...lo),sx=x=>24+(x-c)/Math.max(d-c,.00001)*352,sy=y=>176-(y-a)/Math.max(b-a,.00001)*136;
    const path=pts.map((p,i)=>(i?"L":"M")+sx(p.lon).toFixed(1)+" "+sy(p.lat).toFixed(1)).join(" "),q=pts[pts.length-1];
    return '<svg class="route" viewBox="0 0 400 200"><path d="'+path+'" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"/><circle cx="'+sx(q.lon)+'" cy="'+sy(q.lat)+'" r="6" fill="#e82127"/></svg>';
  }
  _carHtml(car,i,h){
    const p=car.picked,soc=num(h,p.battery),range=stateOf(h,p.range),charging=stateOf(h,p.charging),inside=stateOf(h,p.inside),outside=stateOf(h,p.outside);
    const locked=stateOf(h,p.lock)==="locked",climate=p.climate&&stateOf(h,p.climate)!=="off",sentry=stateOf(h,p.sentry)==="on";
    const port=openState(stateOf(h,p.port)),frunk=openState(stateOf(h,p.frunk)),trunk=openState(stateOf(h,p.trunk)),windows=openState(stateOf(h,p.windows));
    const active=/charging|starting/i.test(charging)&&!/complete|stopped|disconnected/i.test(charging),width=soc==null?0:Math.max(0,Math.min(100,soc));
    const t=p.tracker,attrs=t?h.states[t.id]?.attributes||{}:{},cc=coords(h,t),address=attrs.address||attrs.location_name||stateOf(h,t)||"Location unavailable";
    const doors=[["doorDriver","Driver",p.doorDriver],["doorPassenger","Passenger",p.doorPassenger],["doorRearLeft","Rear left",p.doorRearLeft],["doorRearRight","Rear right",p.doorRearRight]].filter(x=>x[2]);
    const wins=[["windowDriver","Driver",p.windowDriver],["windowPassenger","Passenger",p.windowPassenger],["windowRear","Rear",p.windowRear]].filter(x=>x[2]);
    const controls=[p.lock&&this._btn(i,"lock",locked?"Locked":"Unlocked","toggle",locked),p.climate&&this._btn(i,"climate",climate?"Climate on":"Climate","toggle",climate),p.sentry&&this._btn(i,"sentry","Sentry","toggle",sentry),p.port&&this._btn(i,"port",port?"Close port":"Charge port","toggle",port),p.frunk&&this._btn(i,"frunk",frunk?"Close frunk":"Frunk","toggle",frunk),p.trunk&&this._btn(i,"trunk",trunk?"Close trunk":"Trunk","toggle",trunk),p.wake&&this._btn(i,"wake","Wake","press"),p.refresh&&this._btn(i,"refresh","Refresh","press"),p.flash&&this._btn(i,"flash","Flash","press"),p.horn&&this._btn(i,"horn","Honk","press"),p.start&&this._btn(i,"start","Start","press")].filter(Boolean).join("");
    const rows='<div><span>Charge port</span><b class="'+(port?"alert":"")+'">'+(port?"OPEN":"Closed")+'</b></div><div><span>Frunk</span><b class="'+(frunk?"alert":"")+'">'+(frunk?"OPEN":"Closed")+'</b></div><div><span>Trunk</span><b class="'+(trunk?"alert":"")+'">'+(trunk?"OPEN":"Closed")+'</b></div><div><span>Windows</span><b class="'+(windows?"alert":"")+'">'+(windows?"OPEN / VENTED":"Closed")+'</b></div>'+doors.map(x=>'<div><span>'+esc(x[1])+' door</span><b class="'+(openState(stateOf(h,x[2]))?"alert":"")+'">'+esc(titleState(stateOf(h,x[2])))+'</b></div>').join("")+wins.map(x=>'<div><span>'+esc(x[1])+' window</span><b class="'+(openState(stateOf(h,x[2]))?"alert":"")+'">'+esc(titleState(stateOf(h,x[2])))+'</b></div>').join("");
    const hist=this._route(car);
    const climateAttrs=p.climate?h.states[p.climate.id]?.attributes||{}:{};
    return '<article class="car"><header><div><b>'+esc(car.name)+'</b><small>'+esc(car.model)+'</small></div><span class="state '+(active?"charge":"")+'">'+(active?"Charging":stateOf(h,p.asleep)==="on"?"Asleep":"Parked")+'</span></header><div class="visual">'+this._stockCar(car,active,windows||port||frunk||trunk)+'</div>'+this._swatches(car,i)+'<div class="battery"><strong>'+(soc==null?"—":soc)+'<small>%</small></strong><span>'+esc(range||"—")+' '+esc(p.range?h.states[p.range.id]?.attributes?.unit_of_measurement||"":"")+'</span></div><div class="bar"><i style="width:'+width+'%"></i></div><div class="meta"><span><b>'+esc(inside||"—")+'</b> cabin</span><span><b>'+esc(outside||"—")+'</b> outside</span><span><b>'+esc(stateOf(h,p.power)||"—")+'</b> power</span></div><section><div class="title"><b>📍 Location</b><small>'+(cc?cc.lat.toFixed(5)+", "+cc.lon.toFixed(5):"GPS unavailable")+'</small></div><strong class="address">'+esc(address)+'</strong></section><section><div class="title"><b>Vehicle</b><small>Live state</small></div><div class="states">'+rows+'</div></section><section><div class="title"><b>Controls</b><small>Tap to command</small></div><div class="controls">'+controls+'</div></section>'+(p.climate?'<div class="climate"><span>Climate <b>'+(climate?"ON":"OFF")+'</b></span><span>Cabin <b>'+esc(inside||"—")+'</b></span><span>Outside <b>'+esc(outside||"—")+'</b></span><span>Mode <b>'+esc(climateAttrs.hvac_action||"—")+'</b></span></div>':"")+'<section><div class="title"><b>Charging</b><small>'+esc(charging||"Unknown")+'</small></div><div class="chargegrid"><span>Limit <b>'+esc(num(h,p.limit)??"—")+'%</b></span><span>Amps <b>'+esc(num(h,p.amps)??"—")+'</b></span><span>Added <b>'+esc(stateOf(h,p.added)||"—")+'</b></span><span>Time <b>'+esc(stateOf(h,p.timeLeft)||"—")+'</b></span></div>'+(p.limit?'<label>Charge limit <b>'+esc(num(h,p.limit)??"—")+'%</b><input data-car="'+i+'" data-key="limit" type="range" min="50" max="100" value="'+(num(h,p.limit)??80)+'"></label>':"")+(p.amps?'<label>Amps <b>'+esc(num(h,p.amps)??"—")+'</b><input data-car="'+i+'" data-key="amps" type="range" min="1" max="48" value="'+(num(h,p.amps)??5)+'"></label>':"")+'</section><section><div class="title"><b>Location history</b><small>'+esc(this._config?.history_days||7)+' days</small></div>'+hist+'</section></article>';
  }
  _render(){
    if(!this.shadowRoot||!this._hass)return;
    const h=this._hass,all=listTesla(h),by=new Map();
    for(const e of all){const k=e.device_id||e.id;if(!by.has(k))by.set(k,[]);by.get(k).push(e)}
    this._cars=[...by].map(([id,es])=>({id,device_id:id,name:deviceName(h,id),model:vehicleModel(h,id,es),picked:pick(es)}));
    const body=this._cars.length?this._cars.map((c,i)=>this._carHtml(c,i,h)).join(""):'<article class="car empty">No Tesla vehicles detected. Add Tesla Custom or Tesla Fleet and reload.</article>';
    this.shadowRoot.innerHTML='<style>:host{display:block}.wrap{background:#000;color:#fff;border-radius:24px;padding:4px;font-family:-apple-system,BlinkMacSystemFont,"Helvetica Neue",Arial,sans-serif;letter-spacing:-.02em}.car{background:#181818;border:1px solid #292929;border-radius:22px;margin:8px;overflow:hidden;box-shadow:0 12px 35px rgba(0,0,0,.3)}header{display:flex;justify-content:space-between;align-items:center;padding:18px 18px 0}header b{font-size:20px;font-weight:600}header small{display:block;color:#888;font-size:11px;margin-top:2px}.state{color:#aaa;font-size:12px}.state.charge{color:#3e6ae1}.visual{height:190px;padding:8px 18px 0;display:flex;align-items:center;justify-content:center;background:radial-gradient(ellipse at center,#292929,#181818 72%)}.car-svg{width:100%;height:180px;filter:drop-shadow(0 18px 15px rgba(0,0,0,.5))}.bolt{opacity:0}.charging .bolt{opacity:1;animation:pulse 1.1s infinite}.charging .charge{animation:pulse 1.1s infinite}@keyframes pulse{50%{opacity:.3}}.colors{display:flex;gap:9px;padding:0 18px 12px}.swatch{width:17px;height:17px;border-radius:50%;border:1px solid #444;padding:0}.swatch.on{outline:2px solid #3e6ae1;outline-offset:2px}.picker{width:20px;height:20px;border:0;background:none}.battery{display:flex;align-items:end;justify-content:space-between;margin:0 18px 7px}.battery strong{font-size:64px;line-height:.85;letter-spacing:-.06em}.battery strong small{font-size:20px;color:#888}.battery span{font-size:13px;color:#aaa}.bar{height:5px;background:#333;border-radius:99px;overflow:hidden;margin:0 18px}.bar i{display:block;height:100%;background:#fff}.meta{display:flex;gap:16px;flex-wrap:wrap;padding:11px 18px 15px;color:#999;font-size:12px}.meta b{color:#fff}section,.climate{border-top:1px solid #292929;padding:14px 18px}.title{display:flex;justify-content:space-between;margin-bottom:9px;font-size:13px}.title small{color:#777;font-size:10px}.address{font-size:14px}.states div{display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid #242424;font-size:12px;color:#999}.states b{color:#ddd}.states b.alert{color:#e82127}.controls{display:grid;grid-template-columns:repeat(4,1fr);gap:7px}.ctrl{min-height:60px;background:#232323;color:#fff;border:0;border-radius:13px;font-size:10px}.ctrl.on{background:#252d3a}.ctrl span{display:block;font-size:17px;margin-bottom:6px}.climate{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;color:#888;font-size:10px}.climate b,.chargegrid b{display:block;color:#fff;font-size:12px;margin-top:4px}.chargegrid{display:grid;grid-template-columns:repeat(2,1fr);gap:8px}.chargegrid span{background:#232323;border-radius:11px;padding:10px;color:#888;font-size:10px}label{display:grid;grid-template-columns:1fr auto;gap:5px;color:#888;font-size:11px;margin-top:12px}label b{color:#fff}label input{grid-column:1/-1;width:100%;accent-color:#e82127}.route{width:100%;height:170px;background:#101010;border-radius:14px}.map-empty{background:#101010;color:#666;border-radius:14px;padding:22px;text-align:center;font-size:11px}.empty{padding:20px;color:#888}</style><div class="wrap">'+body+'</div>';
    const w=this.shadowRoot.querySelector(".wrap");w.onclick=e=>this._onClick(e);w.onchange=e=>this._onChange(e);
  }
}
customElements.define("tesla-share-card", TeslaShareCard);
window.customCards = window.customCards || [];
window.customCards.push({
  type: "tesla-share-card",
  name: "Tesla Share",
  description: "Every Tesla on tesla_custom or tesla_fleet. No entity ids.",
});

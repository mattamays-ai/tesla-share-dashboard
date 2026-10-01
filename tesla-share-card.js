// Tesla Share — one card, every car on tesla_custom or tesla_fleet.
const PLATFORMS = new Set(["tesla_custom", "tesla_fleet"]);

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&" + "amp;")
    .replace(/</g, "&" + "lt;")
    .replace(/>/g, "&" + "gt;")
    .replace(/"/g, "&" + "quot;");
}

async function loadTeslaRegistry(hass) {
  if (!hass?.callWS) return { entities: [], devices: {} };
  const [entityResult, deviceResult] = await Promise.all([
    hass.callWS({ type: "config/entity_registry/list_for_display" }),
    hass.callWS({ type: "config/device_registry/list" }),
  ]);
  const rawEntities = Array.isArray(entityResult)
    ? entityResult
    : (entityResult?.entities || entityResult?.result?.entities || []);
  const rawDevices = Array.isArray(deviceResult)
    ? deviceResult
    : (deviceResult?.devices || deviceResult?.result?.devices || []);
  const entities = rawEntities
    .map((meta) => ({
      id: meta.ei,
      platform: meta.pl,
      device_id: meta.di || null,
      name: meta.en || "",
      state: hass.states?.[meta.ei],
    }))
    .filter((e) => e.id && e.state && PLATFORMS.has(e.platform));
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
  const text = e => (e.id + " " + (e.name || "") + " " + (e.state?.attributes?.friendly_name || "")).toLowerCase();
  const best = (tests, penalties = []) => {
    let winner = null, bestScore = -Infinity;
    for (const e of entities) {
      const t = text(e);
      if (penalties.some(re => re.test(t))) continue;
      let score = 0;
      for (const test of tests) score += test(e, t);
      if (score > bestScore) { bestScore = score; winner = e; }
    }
    return bestScore > 0 ? winner : null;
  };
  const rx = re => (e,t) => re.test(t) ? 5 : 0;
  const suffix = sx => (e) => sx.some(s => e.id.endsWith(s)) ? 7 : 0;
  const dom = d => (e) => e.id.startsWith(d + ".") ? 6 : 0;
  const cls = name => (e) => e.state?.attributes?.device_class === name ? 8 : 0;
  return {
    battery: best([cls("battery"),dom("sensor"),suffix(["_battery","_battery_level"])] , [/powerwall|backup|solar/]),
    range: best([rx(/battery.*range|estimated.*range/),suffix(["_battery_range","_estimated_range"])]),
    charging: best([rx(/charging.*state|charge.*state/),suffix(["_charging_state","_charging"])]),
    online: best([rx(/online|connectivity|vehicle.*status/),cls("connectivity"),suffix(["_online","_status"])]),
    asleep: best([rx(/asleep|sleeping/),suffix(["_asleep"])]),
    inside: best([rx(/inside.*temperature|cabin.*temperature|interior.*temperature/),suffix(["_temperature_inside","_inside_temperature"])]),
    outside: best([rx(/outside.*temperature|exterior.*temperature/),suffix(["_temperature_outside","_outside_temperature"])]),
    lock: best([dom("lock"),rx(/door.*lock|vehicle.*lock|lock/),suffix(["_lock"])]),
    climate: best([dom("climate"),rx(/climate|hvac/)]),
    sentry: best([rx(/sentry/),suffix(["_sentry_mode"])]),
    port: best([dom("cover"),dom("lock"),dom("switch"),rx(/charge.*port|charger.*door/),suffix(["_charger_door","_charge_port_door"])]),
    portOpen: best([rx(/charge.*port.*open|charger.*door.*open/),suffix(["_charge_port_open","_charger_door_open"])]),
    portClose: best([rx(/charge.*port.*close|charger.*door.*close/),suffix(["_charge_port_close","_charger_door_close"])]),
    frunk: best([dom("cover"),rx(/frunk/),suffix(["_frunk"])]),
    trunk: best([dom("cover"),rx(/trunk|boot/),suffix(["_trunk","_boot"])]),
    windows: best([rx(/windows|window.*state/),suffix(["_windows","_vent_windows"])]),
    doorDriver: best([rx(/driver.*door|left.*front.*door|front.*left.*door/)]),
    doorPassenger: best([rx(/passenger.*door|right.*front.*door|front.*right.*door/)]),
    doorRearLeft: best([rx(/rear.*left.*door|left.*rear.*door/)]),
    doorRearRight: best([rx(/rear.*right.*door|right.*rear.*door/)]),
    windowDriver: best([rx(/driver.*window|left.*front.*window/)]),
    windowPassenger: best([rx(/passenger.*window|right.*front.*window/)]),
    windowRear: best([rx(/rear.*window/)]),
    wake: best([rx(/wake/),suffix(["_wake_up","_wake"])]),
    flash: best([rx(/flash.*light|lights.*flash/),suffix(["_flash_lights"])]),
    horn: best([rx(/horn|honk/),suffix(["_horn","_honk_horn"])]),
    start: best([rx(/remote.*start|keyless/),suffix(["_remote_start","_keyless_driving"])]),
    refresh: best([rx(/force.*data.*update|refresh/),suffix(["_force_data_update"])]),
    power: best([rx(/charger.*power|charging.*power/),suffix(["_charger_power"])]),
    added: best([rx(/energy.*added|charge.*energy.*added/),suffix(["_energy_added","_charge_energy_added"])]),
    timeLeft: best([rx(/time.*charge|time.*full|charge.*complete/),suffix(["_time_charge_complete","_time_to_full_charge"])]),
    chargeSwitch: best([dom("switch"),rx(/charger|charge/)]),
    limit: best([rx(/charge.*limit/),dom("number"),suffix(["_charge_limit"])]),
    amps: best([rx(/charging.*amps|charge.*current/),dom("number"),suffix(["_charging_amps","_charge_current"])]),
    tracker: best([dom("device_tracker"),rx(/location|vehicle/)], [/destination|route/]),
  };
}

function haversine(a,b){const R=6371,rad=Math.PI/180,dLat=(b.lat-a.lat)*rad,dLon=(b.lon-a.lon)*rad,q=Math.sin(dLat/2)**2+Math.cos(a.lat*rad)*Math.cos(b.lat*rad)*Math.sin(dLon/2)**2;return R*2*Math.atan2(Math.sqrt(q),Math.sqrt(Math.max(0,1-q)))}
function historyPoints(rows){return (rows||[]).map(x=>{const a=x.attributes||{},lat=Number(a.latitude),lon=Number(a.longitude),t=new Date(x.last_changed||x.last_updated||0).getTime();return Number.isFinite(lat)&&Number.isFinite(lon)&&Number.isFinite(t)?{lat,lon,t,state:x.state,attrs:a}:null}).filter(Boolean).sort((a,b)=>a.t-b.t)}
function detectTrips(rows){const pts=historyPoints(rows),trips=[],MAX_GAP=1800000,MIN_DISTANCE=.35;let current=[],distance=0;const finish=()=>{if(current.length<2){current=[];distance=0;return}if(distance>=MIN_DISTANCE){const first=current[0],last=current[current.length-1];trips.push({points:current.slice(),distance,start:first.t,end:last.t,duration:last.t-first.t})}current=[];distance=0};for(let i=0;i<pts.length;i++){const p=pts[i],prev=pts[i-1];if(!prev||p.t-prev.t>MAX_GAP){finish();current=[p];continue}const d=haversine(prev,p);if(d>.05)distance+=d;current.push(p)}finish();return trips.slice(-20).reverse()}
function fmtDistance(km){if(!Number.isFinite(km))return "—";return km<1?Math.round(km*1000)+" m":(km<10?km.toFixed(1):Math.round(km))+" km"}
function fmtDuration(ms){if(!Number.isFinite(ms)||ms<0)return "—";const min=Math.round(ms/60000),h=Math.floor(min/60),m=min%60;return h?h+"h "+m+"m":m+"m"}
function fmtTime(ts){if(!ts)return "—";return new Date(ts).toLocaleTimeString([], {hour:"numeric",minute:"2-digit"})}
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
      this._render();
      this._historyKey="";
      await this._historyLoad();
    }catch(e){
      this._registry={entities:[],devices:{}};
      this._registryReady=false;
      this._registryRetryAt=Date.now()+10000;
      this._render();
    }finally{
      this._registryLoading=false;
    }
  }
  _syncRegistryStates(){
    if(!this._registry?.entities||!this._hass?.states)return;
    for(const e of this._registry.entities)e.state=this._hass.states[e.id];
  }
  async _service(ent,service,data={}){
    if(!ent||!this._hass)return false;
    const d=ent.id.split(".")[0];
    this._busy=this._busy||new Set();this._busy.add(ent.id);this._render();
    try{
      await this._hass.callService(d,service,{entity_id:ent.id,...data});
      this._notice="Command sent";
      return true;
    }catch(e){
      const msg=String(e?.message||e?.error?.message||e||"Unknown Home Assistant error").replace(/\s+/g," ").slice(0,180);
      this._notice="Command failed: "+msg;
      return false;
    }finally{
      this._busy.delete(ent.id);this._render();clearTimeout(this._noticeTimer);
      this._noticeTimer=setTimeout(()=>{this._notice="";this._render()},5000);
    }
  }
  async _action(ent,kind,key){
    if(!ent)return;
    const d=ent.id.split(".")[0],s=stateOf(this._hass,ent);
    if(kind==="press"||d==="button"){
      await this._service(ent,"press");
      return;
    }
    if(kind==="toggle"){
      let service=null;
      if(key==="lock"&&d==="lock")service=s==="locked"?"unlock":"lock";
      else if(key==="climate"&&d==="climate")service=s==="off"?"turn_on":"turn_off";
      else if(key==="sentry"&&d==="switch")service=s==="on"?"turn_off":"turn_on";
      else if(key==="port"&&d==="switch")service=s==="on"?"turn_off":"turn_on";
      else if((key==="port"||key==="frunk"||key==="trunk"||key==="windows")&&d==="cover")service=openState(s)?"close_cover":"open_cover";
      else if(d==="cover")service=openState(s)?"close_cover":"open_cover";
      if(service)await this._service(ent,service);
      else this._notice="No compatible command for "+key;
      if(!service)this._render();
    }
  }
  async _climateAction(car,action){
    const ent=car.picked?.climate;if(!ent)return;
    const a=this._hass.states?.[ent.id]?.attributes||{};
    if(action==="temp"){
      const value=Number(car.picked._tempDraft??a.temperature);
      if(Number.isFinite(value))await this._service(ent,"set_temperature",{temperature:value});
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
    if(cfg[key])return cfg[key]; if(cfg[car.name])return cfg[car.name];
    try{return localStorage.getItem("tesla-share-color:"+key)||"#f4f4f4"}catch{return "#f4f4f4"}
  }
  _onClick(e){
    const b=e.target.closest("[data-act]");if(!b)return;
    if(b.dataset.act==="confirm"){
      if(this._confirm&&b.dataset.choice==="yes"){const c=this._confirm;this._confirm=null;this._render();this._action(c.ent,c.act,c.key)}
      else{this._confirm=null;this._render()}
      return;
    }
    const car=this._cars?.[+b.dataset.car];if(!car)return;
    if(b.dataset.act==="color"){try{localStorage.setItem("tesla-share-color:"+(car.device_id||car.id||car.name),b.dataset.color||b.value)}catch{}this._render();return}
    const key=b.dataset.key;
    if(key==="port"&&b.dataset.act==="toggle"){
      const open=car.picked?.portOpen,close=car.picked?.portClose,main=car.picked?.port;
      const target=stateOf(this._hass,main)==="open"?close:open;
      if(target){this._action(target,"press","port");return}
    }
    const ent=car.picked?.[key];if(!ent)return;
    const state=stateOf(this._hass,ent),risky=key==="horn"||key==="flash"||key==="start"||key==="frunk"||key==="trunk"||(key==="lock"&&state!=="locked");
    if(risky){this._confirm={car:car.name,key,ent,act:b.dataset.act};this._render();return}
    this._action(ent,b.dataset.act,key);
  }
  _onChange(e){
    const x=e.target,car=this._cars?.[+x.dataset.car];if(!car)return;
    if(x.dataset.act==="color"){try{localStorage.setItem("tesla-share-color:"+(car.device_id||car.id||car.name),x.value)}catch{}this._render();return}
    if(x.dataset.act==="climate-temp"){car.picked._tempDraft=+x.value;this._render();return}
    const ent=car.picked?.[x.dataset.key];if(!ent)return;
    if(x.type==="range")this._service(ent,"set_value",{value:+x.value});
  }
  _stockCar(car,charging,open){
    const paint=this._color(car),m=car.model||"Tesla";
    const cyber=m==="Cybertruck",x=m==="Model X",y=m==="Model Y",s=m==="Model S",road=m==="Roadster";
    const uid=(car.device_id||car.id||"tesla").replace(/[^a-z0-9]/gi,"");
    const bodyId="body-"+uid,glassId="glass-"+uid;
    const body=cyber
      ?"M38 151L104 82L398 66L506 79L579 122L604 150L569 164H69Z"
      :x
      ?"M38 151C58 104 111 72 198 67L405 71C492 74 550 101 605 145L570 164H68Z"
      :y
      ?"M39 151C61 99 120 70 211 67L414 73C493 76 550 104 604 146L569 164H68Z"
      :road
      ?"M41 151C73 108 133 82 231 77L423 83C500 87 548 110 602 146L568 164H70Z"
      :s
      ?"M40 151C72 104 138 78 246 72L416 78C499 81 551 108 603 146L568 164H70Z"
      :"M41 151C72 104 139 78 246 72L414 78C498 81 551 108 603 146L568 164H70Z";
    const glass=cyber
      ?"M106 84L391 69L480 82L531 111H104Z"
      :(x||y)
      ?"M124 84C195 65 335 66 425 76L511 112H112Z"
      :"M141 84C216 65 337 68 423 78L505 112H132Z";
    const lower=cyber
      ?"M72 146L568 146L570 164H69Z"
      :"M70 145C180 153 430 153 570 145L568 164H70Z";
    const wheel=(cx)=>'<circle cx="'+cx+'" cy="158" r="31" fill="#070707" stroke="#343434" stroke-width="5"/><circle cx="'+cx+'" cy="158" r="22" fill="url(#wheel-'+uid+')"/><circle cx="'+cx+'" cy="158" r="7" fill="#8b8b8b"/><path d="M'+(cx-15)+' 158H'+(cx+15)+'M'+cx+' 143V173" stroke="#555" stroke-width="2" opacity=".8"/>';
    const doors=cyber
      ?'<path d="M276 87L276 147M398 91L405 148" class="seam"/>'
      :'<path d="M286 80L286 147M383 82L383 148" class="seam"/>';
    return '<svg viewBox="0 0 640 220" class="car-svg '+(charging?"charging ":"")+(open?"open ":"")+(cyber?"cyber":"")+'" role="img" aria-label="'+esc(m)+'">'+
      '<defs>'+
      '<linearGradient id="'+bodyId+'" x1="0" y1="0" x2="0.8" y2="1"><stop offset="0" stop-color="'+paint+'" stop-opacity=".98"/><stop offset=".48" stop-color="'+paint+'"/><stop offset="1" stop-color="#050505" stop-opacity=".78"/></linearGradient>'+
      '<linearGradient id="'+glassId+'" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#24303d"/><stop offset=".45" stop-color="#0c1118"/><stop offset="1" stop-color="#05070a"/></linearGradient>'+
      '<radialGradient id="wheel-'+uid+'"><stop offset="0" stop-color="#777"/><stop offset=".35" stop-color="#252525"/><stop offset="1" stop-color="#080808"/></radialGradient>'+
      '</defs>'+
      '<ellipse cx="320" cy="174" rx="268" ry="13" fill="#000" opacity=".62"/>'+
      '<path class="body" d="'+body+'" fill="url(#'+bodyId+')" stroke="#fff" stroke-opacity=".18" stroke-width="2"/>'+
      '<path d="'+lower+'" fill="#080808" opacity=".48"/>'+
      '<path class="glass" d="'+glass+'" fill="url(#'+glassId+')" stroke="#020304" stroke-width="4"/>'+
      '<path d="M'+(cyber?120:151)+' 88L'+(cyber?475:468)+' 108" stroke="#fff" stroke-opacity=".13" stroke-width="2"/>'+
      '<path d="M'+(cyber?108:135)+' 117C250 105 395 107 512 117" stroke="#fff" stroke-opacity=".12" stroke-width="2"/>'+
      doors+
      '<path d="M110 127L143 118M501 118L533 128" stroke="'+paint+'" stroke-width="7" stroke-linecap="round" opacity=".9"/>'+
      '<path d="M100 135L125 128" stroke="#fff" stroke-width="4" stroke-linecap="round" opacity=".9"/>'+
      '<path d="M529 128L552 134" stroke="#e82127" stroke-width="5" stroke-linecap="round"/>'+
      wheel(171)+wheel(469)+
      '<circle class="charge" cx="112" cy="134" r="7" fill="#3e6ae1"/>'+
      '<circle cx="112" cy="134" r="12" fill="none" stroke="#fff" stroke-opacity=".14"/>'+
      '<path class="bolt" d="M251 128h31l-9 17h22l-38 42 9-25h-25z" fill="#fff"/>'+
      (open?'<path class="door-open" d="M190 112L173 64M360 112L374 69" stroke="'+paint+'" stroke-width="5" stroke-linecap="round"/>':"")+
      '</svg>';
  }
  _swatches(car,i){
    const cs=["#f4f4f4","#171a20","#e82127","#3e6ae1","#9a9a9e","#c4a574"],cur=this._color(car);
    return '<div class="colors">'+cs.map(x=>'<button class="swatch '+(x.toLowerCase()===cur.toLowerCase()?"on":"")+'" data-car="'+i+'" data-act="color" data-color="'+x+'" style="background:'+x+'"></button>').join("")+'<input class="picker" data-car="'+i+'" data-act="color" type="color" value="'+(/^#[0-9a-f]{6}$/i.test(cur)?cur:"#f4f4f4")+'"></div>';
  }
  _btn(i,key,label,act="toggle",on=false){return '<button class="ctrl '+(on?"on":"")+'" data-car="'+i+'" data-key="'+key+'" data-act="'+act+'"><span>'+esc({lock:"🔒",climate:"◌",sentry:"◉",port:"ϟ",frunk:"▱",trunk:"▱",windows:"▥",wake:"↻",refresh:"↻",flash:"✦",horn:"♬",start:"▶"}[key]||"•")+'</span><small>'+esc(label)+'</small></button>'}
  async _historyLoad(){
    if(this._historyLoading||!this._hass?.callWS||!this._cars?.length)return;
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
      this._render();
    }catch(e){
      this._historyKey="";
    }finally{this._historyLoading=false}
  }
  _route(car,points){
    const pts=points||historyPoints(this._history?.[car.picked.tracker?.id]||[]);
    if(pts.length<2)return '<div class="map-empty">GPS route appears when Recorder retains latitude/longitude.</div>';
    const la=pts.map(p=>p.lat),lo=pts.map(p=>p.lon),a=Math.min(...la),b=Math.max(...la),c=Math.min(...lo),d=Math.max(...lo),sx=x=>24+(x-c)/Math.max(d-c,.00001)*352,sy=y=>176-(y-a)/Math.max(b-a,.00001)*136;
    const path=pts.map((p,i)=>(i?"L":"M")+sx(p.lon).toFixed(1)+" "+sy(p.lat).toFixed(1)).join(" "),q=pts[pts.length-1];
    return '<svg class="route" viewBox="0 0 400 200"><path d="'+path+'" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"/><circle cx="'+sx(q.lon)+'" cy="'+sy(q.lat)+'" r="6" fill="#e82127"/></svg>';
  }
  _tripHtml(car){
    const trips=detectTrips(this._history?.[car.picked.tracker?.id]||[]);
    if(!trips.length)return '<div class="trip-empty">No completed trips detected in retained GPS history.</div>';
    return '<div class="trips">'+trips.slice(0,5).map((t,i)=>'<article class="trip"><div class="trip-head"><b>'+(i===0?"Latest trip":"Trip "+(i+1))+'</b><span>'+fmtDistance(t.distance)+'</span></div><div class="trip-meta"><span>'+fmtTime(t.start)+' → '+fmtTime(t.end)+'</span><span>'+fmtDuration(t.duration)+'</span></div>'+this._route(car,t.points)+'</article>').join("")+'</div>';
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
    const h=this._hass,all=this._registry?.entities||[],by=new Map();
    for(const e of all){
      const state=h.states?.[e.id];
      if(!state)continue;
      e.state=state;
      const k=e.device_id||e.id;
      if(!by.has(k))by.set(k,[]);
      by.get(k).push(e);
    }
    this._cars=[...by].map(([id,es])=>({
      id,device_id:id,
      name:deviceName(this._registry,id),
      model:vehicleModel(h,this._registry,id,es),
      picked:pick(es)
    }));
    const notice=this._notice?'<div class="notice">'+esc(this._notice)+'</div>':"";
    const confirm=this._confirm?'<div class="confirm"><div class="confirm-box"><b>Confirm '+esc(this._confirm.key)+' command</b><p>Send this command to '+esc(this._confirm.car)+'?</p><div class="confirm-actions"><button class="no" data-act="confirm" data-choice="no">Cancel</button><button class="yes" data-act="confirm" data-choice="yes">Confirm</button></div></div></div>':"";
    const body=this._registry
      ? (this._cars.length?this._cars.map((c,i)=>this._carHtml(c,i,h)).join(""):'<article class="car empty">No Tesla vehicles detected. Add Tesla Custom or Tesla Fleet and reload.</article>')
      : '<article class="car empty">Loading Tesla vehicles…</article>';
    this.shadowRoot.innerHTML='<style>:host{display:block}.trips{display:grid;gap:9px}.trip{background:#101010;border-radius:14px;padding:10px}.trip-head,.trip-meta{display:flex;justify-content:space-between;gap:8px;font-size:11px}.trip-meta{color:#777;margin:5px 0 8px}.trip .route{height:120px}.trip-empty{background:#101010;color:#666;border-radius:14px;padding:18px;font-size:11px}.notice{position:sticky;top:8px;z-index:5;margin:8px;padding:10px 13px;border-radius:12px;background:#242424;color:#fff;font-size:12px}.confirm{position:fixed;inset:0;background:rgba(0,0,0,.68);z-index:20;display:flex;align-items:center;justify-content:center;padding:24px}.confirm-box{max-width:360px;width:100%;background:#1d1d1d;border:1px solid #444;border-radius:18px;padding:20px;box-shadow:0 20px 60px #000}.confirm-box p{color:#aaa;font-size:12px;line-height:1.5}.confirm-actions{display:flex;gap:8px}.confirm-actions button{flex:1;padding:12px;border:0;border-radius:11px}.confirm-actions .yes{background:#e82127;color:#fff}.confirm-actions .no{background:#333;color:#fff}.climate-controls{grid-column:1/-1;display:flex;gap:7px;align-items:center;flex-wrap:wrap;margin-top:5px}.climate-controls button{background:#292929;color:#fff;border:0;border-radius:9px;padding:7px 10px;font-size:10px}.climate-controls input{flex:1;min-width:100px;accent-color:#e82127}.wrap{background:#000;color:#fff;border-radius:24px;padding:4px;font-family:-apple-system,BlinkMacSystemFont,"Helvetica Neue",Arial,sans-serif;letter-spacing:-.02em}.car{background:#181818;border:1px solid #292929;border-radius:22px;margin:8px;overflow:hidden;box-shadow:0 12px 35px rgba(0,0,0,.3)}header{display:flex;justify-content:space-between;align-items:center;padding:18px 18px 0}header b{font-size:20px;font-weight:600}header small{display:block;color:#888;font-size:11px;margin-top:2px}.state{color:#aaa;font-size:12px}.state.charge{color:#3e6ae1}.visual{height:190px;padding:8px 18px 0;display:flex;align-items:center;justify-content:center;background:radial-gradient(ellipse at center,#292929,#181818 72%)}.car-svg{width:100%;height:180px;filter:drop-shadow(0 18px 15px rgba(0,0,0,.5));transition:transform .35s ease,filter .35s ease}.car-svg .body{transition:filter .35s ease}.car-svg.open{transform:translateY(-3px) scale(1.015)}.car-svg.cyber .body{stroke-opacity:.35}.bolt{opacity:0}.charging .bolt{opacity:1;animation:pulse 1.1s infinite}.charging .charge{animation:pulse 1.1s infinite}.charging .body{filter:drop-shadow(0 0 8px rgba(62,106,225,.35))}.door-open{stroke-dasharray:8 6;animation:door 1.4s linear infinite}@keyframes door{to{stroke-dashoffset:-28}}@keyframes pulse{50%{opacity:.3}}.colors{display:flex;gap:9px;padding:0 18px 12px}.swatch{width:17px;height:17px;border-radius:50%;border:1px solid #444;padding:0}.swatch.on{outline:2px solid #3e6ae1;outline-offset:2px}.picker{width:20px;height:20px;border:0;background:none}.battery{display:flex;align-items:end;justify-content:space-between;margin:0 18px 7px}.battery strong{font-size:64px;line-height:.85;letter-spacing:-.06em}.battery strong small{font-size:20px;color:#888}.battery span{font-size:13px;color:#aaa}.bar{height:5px;background:#333;border-radius:99px;overflow:hidden;margin:0 18px}.bar i{display:block;height:100%;background:#fff}.meta{display:flex;gap:16px;flex-wrap:wrap;padding:11px 18px 15px;color:#999;font-size:12px}.meta b{color:#fff}section,.climate{border-top:1px solid #292929;padding:14px 18px}.title{display:flex;justify-content:space-between;margin-bottom:9px;font-size:13px}.title small{color:#777;font-size:10px}.address{font-size:14px}.states div{display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid #242424;font-size:12px;color:#999}.states b{color:#ddd}.states b.alert{color:#e82127}.controls{display:grid;grid-template-columns:repeat(4,1fr);gap:7px}.ctrl{min-height:60px;background:#232323;color:#fff;border:0;border-radius:13px;font-size:10px}.ctrl.on{background:#252d3a}.ctrl span{display:block;font-size:17px;margin-bottom:6px}.climate{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;color:#888;font-size:10px}.climate b,.chargegrid b{display:block;color:#fff;font-size:12px;margin-top:4px}.chargegrid{display:grid;grid-template-columns:repeat(2,1fr);gap:8px}.chargegrid span{background:#232323;border-radius:11px;padding:10px;color:#888;font-size:10px}label{display:grid;grid-template-columns:1fr auto;gap:5px;color:#888;font-size:11px;margin-top:12px}label b{color:#fff}label input{grid-column:1/-1;width:100%;accent-color:#e82127}.route{width:100%;height:170px;background:#101010;border-radius:14px}.map-empty{background:#101010;color:#666;border-radius:14px;padding:22px;text-align:center;font-size:11px}.empty{padding:20px;color:#888}</style><div class="wrap">'+body+'</div>';
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

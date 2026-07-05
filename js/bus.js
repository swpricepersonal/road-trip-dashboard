/* Tiny pub/sub event bus — all modules communicate through this.
   Events used across the app:
     'fix'        {t, lat, lon, altM, speedMps, heading, accM}  each GPS/sim update
     'gps-status' {state: 'off'|'poor'|'good', accM}
     'trip'       {trip}                                        trip state/stats changed
     'trip-life'  {type: 'start'|'end'|'resume', trip}
     'event'      {msg, kind}                                   milestone/notable event
     'weather'    {now, next}
     'screen'     {name}                                        active tab changed
     'settings'   {}                                            settings saved
     'region-change' {state}                                    new state entered (milestones.js)
*/

const bus = new EventTarget();

export function emit(name, detail = {}) {
  bus.dispatchEvent(new CustomEvent(name, { detail }));
}

export function on(name, fn) {
  bus.addEventListener(name, (e) => fn(e.detail));
}

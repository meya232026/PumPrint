// Where the data comes from.
//   server  this site's own server answers (/api/site): live Moth stream, Kolibri lookups
//   static  no server (static hosting): Moth reads pump.fun from the browser, Kolibri shows samples
//   demo    made-up data everywhere (forced by config, or when nothing live is reachable)

const CFG = window.PUMPRINT_CONFIG || {};

let envPromise = null;

export function getEnv() {
  if (!envPromise) envPromise = detect();
  return envPromise;
}

async function detect() {
  if (CFG.dataMode === 'demo') return { mode: 'demo' };
  if (location.protocol === 'file:') return { mode: 'static' };
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3500);
    const res = await fetch('/api/site', { cache: 'no-store', signal: ctrl.signal });
    clearTimeout(timer);
    if (res.ok) {
      const site = await res.json();
      if (site && site.mode === 'server') return { mode: 'server', site };
    }
  } catch {
    /* no server */
  }
  return { mode: 'static' };
}

export function serverBase(path) {
  return new URL(path, location.origin).href;
}

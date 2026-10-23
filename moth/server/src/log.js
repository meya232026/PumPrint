const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 99 };

export function createLogger(level = 'info') {
  const min = LEVELS[level] ?? LEVELS.info;
  const make = (name) => (msg, extra) => {
    if (LEVELS[name] < min) return;
    const line = `${new Date().toISOString()} ${name.toUpperCase().padEnd(5)} ${msg}${extra ? ` ${JSON.stringify(extra)}` : ''}`;
    if (LEVELS[name] >= LEVELS.warn) console.error(line);
    else console.log(line);
  };
  return { debug: make('debug'), info: make('info'), warn: make('warn'), error: make('error') };
}

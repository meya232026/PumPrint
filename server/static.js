// Serves the site's files from public/ with ETags and gzip for text.

import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { gzipSync } from 'node:zlib';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.zip': 'application/zip',
};
const COMPRESS = new Set(['.html', '.css', '.js', '.mjs', '.json', '.svg', '.txt', '.webmanifest']);

export function createStatic(root, { cacheFiles = true } = {}) {
  const base = normalize(root + sep);
  const cache = new Map();

  async function load(file) {
    const st = await stat(file);
    if (!st.isFile()) return null;
    const hit = cache.get(file);
    if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit;
    const body = await readFile(file);
    const ext = extname(file).toLowerCase();
    const entry = {
      body,
      gz: COMPRESS.has(ext) && body.length > 1024 ? gzipSync(body, { level: 8 }) : null,
      type: TYPES[ext] || 'application/octet-stream',
      etag: `"${st.size.toString(36)}-${Math.floor(st.mtimeMs).toString(36)}"`,
      mtimeMs: st.mtimeMs,
      size: st.size,
      ext,
    };
    if (cacheFiles) cache.set(file, entry);
    return entry;
  }

  return async function serve(req, res, pathname) {
    let rel;
    try {
      rel = decodeURIComponent(pathname);
    } catch {
      rel = '/';
    }
    if (rel.endsWith('/')) rel += 'index.html';
    const file = normalize(join(base, rel));
    if (!file.startsWith(base) || rel.includes('\0')) return false;
    let entry;
    try {
      entry = await load(file);
    } catch {
      return false;
    }
    if (!entry) return false;

    const headers = {
      'content-type': entry.type,
      etag: entry.etag,
      'cache-control': entry.ext === '.zip' ? 'public, max-age=3600' : 'no-cache',
      'x-content-type-options': 'nosniff',
      vary: 'accept-encoding',
    };
    if (entry.ext === '.html') {
      headers['referrer-policy'] = 'strict-origin-when-cross-origin';
      headers['x-frame-options'] = 'SAMEORIGIN';
    }
    if (entry.ext === '.zip') headers['content-disposition'] = `attachment; filename="${rel.split('/').pop()}"`;
    if (req.headers['if-none-match'] === entry.etag) {
      res.writeHead(304, headers);
      res.end();
      return true;
    }
    const gzip = entry.gz && /\bgzip\b/.test(String(req.headers['accept-encoding'] || ''));
    if (gzip) headers['content-encoding'] = 'gzip';
    const body = gzip ? entry.gz : entry.body;
    headers['content-length'] = body.length;
    res.writeHead(200, headers);
    res.end(req.method === 'HEAD' ? undefined : body);
    return true;
  };
}

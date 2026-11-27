#!/usr/bin/env node
/**
 * Minimal zero-dependency static file server for local development.
 * ES modules cannot load from file:// URLs, so the game must be served over HTTP.
 *
 * Usage: node tools/serve.mjs [port]   (default 8080, or $PORT)
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PORT = Number(process.argv[2] || process.env.PORT || 8080);

export const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

/** Resolve a URL path to a file inside ROOT, or null if it escapes ROOT. */
export function resolveRequestPath(root, urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  const relative = normalize(decoded).replace(/^([/\\])+/, '');
  const full = resolve(join(root, relative));
  if (full !== root && !full.startsWith(root + sep)) return null;
  return full;
}

async function handle(req, res) {
  let filePath;
  try {
    filePath = resolveRequestPath(ROOT, req.url || '/');
  } catch {
    filePath = null;
  }
  if (!filePath) {
    res.writeHead(400).end('Bad request');
    return;
  }

  try {
    let info = await stat(filePath);
    if (info.isDirectory()) {
      filePath = join(filePath, 'index.html');
      info = await stat(filePath);
    }
    const body = await readFile(filePath);
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(body);
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'ENOTDIR') {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
    } else {
      console.error(err);
      res.writeHead(500, { 'Content-Type': 'text/plain' }).end('Server error');
    }
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  createServer(handle).listen(PORT, () => {
    console.log(`Everwake dev server: http://localhost:${PORT}/`);
  });
}

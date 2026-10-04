'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function createServer() {
  return http.createServer((request, response) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD' });
      response.end();
      return;
    }
    let filename;
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      filename = path.resolve(ROOT, `.${pathname === '/' ? '/index.html' : pathname}`);
      const relative = path.relative(ROOT, filename);
      if (relative.startsWith('..') || path.isAbsolute(relative) || relative.split(path.sep).some((part) => part.startsWith('.') || part === 'node_modules')) {
        response.writeHead(403);
        response.end('Acesso negado.');
        return;
      }
    } catch {
      response.writeHead(400);
      response.end('Endereço inválido.');
      return;
    }
    fs.stat(filename, (error, stat) => {
      if (error || !stat.isFile()) {
        response.writeHead(404);
        response.end('Arquivo não encontrado.');
        return;
      }
      response.writeHead(200, {
        'Content-Type': MIME[path.extname(filename)] || 'application/octet-stream',
        'Content-Length': stat.size,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      if (request.method === 'HEAD') response.end();
      else fs.createReadStream(filename).pipe(response);
    });
  });
}

if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || '127.0.0.1';
  const server = createServer();
  server.listen(port, host, () => console.log(`Frostbite: http://${host}:${server.address().port}`));
  server.on('error', (error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { createServer };

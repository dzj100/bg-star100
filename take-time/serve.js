const h = require('http');
const fs = require('fs');
const p = require('path');
const root = 'E:/www_self/bg-star100';
h.createServer((req, res) => {
  let f = p.join(root, decodeURIComponent(req.url.split('?')[0]));
  if (f.endsWith('/') || f.endsWith('\\')) f += 'index.html';
  try {
    const d = fs.readFileSync(f);
    const ext = p.extname(f);
    const type = ext === '.html' ? 'text/html; charset=utf-8'
      : ext === '.js' ? 'text/javascript; charset=utf-8'
      : ext === '.css' ? 'text/css; charset=utf-8'
      : ext === '.png' ? 'image/png' : 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type });
    res.end(d);
  } catch (e) {
    res.writeHead(404);
    res.end('not found');
  }
}).listen(8123, () => console.log('server on 8123'));

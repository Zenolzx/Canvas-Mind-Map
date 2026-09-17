const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve('tmp/organic-browser');
http.createServer((request, response) => {
    const name = request.url === '/test.js' ? 'test.js' : 'index.html';
    response.setHeader('Content-Type', name.endsWith('.js') ? 'application/javascript' : 'text/html; charset=utf-8');
    response.end(fs.readFileSync(path.join(root, name)));
}).listen(8767, '127.0.0.1', () => console.log('Organic browser verification: http://127.0.0.1:8767'));

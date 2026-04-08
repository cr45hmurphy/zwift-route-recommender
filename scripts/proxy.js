// proxy.js — local CORS proxy for Xert API
// Forwards all requests to xertonline.com and adds CORS headers.
// Run: node proxy.js
// Then point your app at http://localhost:3000 instead of https://www.xertonline.com

import http  from 'http';
import https from 'https';
import url   from 'url';

const PORT        = 3000;
const TARGET_HOST = 'www.xertonline.com';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const server = http.createServer((req, res) => {
  // Preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }

  const parsed  = url.parse(req.url);
  const options = {
    hostname: TARGET_HOST,
    port:     443,
    path:     parsed.path,
    method:   req.method,
    headers:  {
      ...req.headers,
      host: TARGET_HOST,
    },
  };

  const proxy = https.request(options, (proxyRes) => {
    const headers = { ...proxyRes.headers, ...CORS_HEADERS };
    res.writeHead(proxyRes.statusCode, headers);
    proxyRes.pipe(res, { end: true });
  });

  proxy.on('error', (err) => {
    console.error('Proxy error:', err.message);
    res.writeHead(502, CORS_HEADERS);
    res.end(JSON.stringify({ error: 'Proxy error', detail: err.message }));
  });

  req.pipe(proxy, { end: true });
});

server.listen(PORT, () => {
  console.log(`Xert proxy running at http://localhost:${PORT}`);
  console.log(`Forwarding to https://${TARGET_HOST}`);
  console.log('Press Ctrl+C to stop.\n');
});

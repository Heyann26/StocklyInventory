import { handle } from '../lib/server.js';

export default async function handler(req, res) {
  try {
    const orig = req.headers['x-matched-path'] || req.headers['x-rewrite-url'] || req.url;
    if (orig && orig.startsWith('/api')) {
      req.url = orig;
    }
    return await handle(req, res);
  } catch (err) {
    console.error('API HANDLER ERROR:', err);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        error: 'API Execution Error',
        message: err.message,
        stack: err.stack
      }));
    }
  }
}

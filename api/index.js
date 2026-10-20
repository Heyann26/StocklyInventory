import { handle } from '../lib/server.js';

export default async function handler(req, res) {
  try {
    const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const paramPath = urlObj.searchParams.get('path');
    const orig = req.headers['x-matched-path'] || req.headers['x-rewrite-url'] || (paramPath ? `/api/${paramPath}` : req.url);
    if (orig && orig.startsWith('/api')) {
      req.url = orig;
    }
    return await handle(req, res);
  } catch (err) {
    console.error('API HANDLER ERROR:', err);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({
        error: 'API Execution Error',
        message: err.message
      }));
    }
  }
}

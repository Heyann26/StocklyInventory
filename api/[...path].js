import { handle } from './_server.js';

export default async function handler(req, res) {
  const orig = req.headers['x-matched-path'] || req.headers['x-rewrite-url'];
  if (orig && orig.startsWith('/api')) {
    req.url = orig;
  }
  return handle(req, res);
}

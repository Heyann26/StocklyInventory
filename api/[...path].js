import { handle } from '../server.js';

export default async function handler(req, res) {
  const orig = req.headers['x-matched-path'] || req.headers['x-rewrite-url'] || req.url;
  if (orig && !orig.includes('[...path].js')) {
    req.url = orig;
  }
  return handle(req, res);
}

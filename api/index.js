import { handle } from '../server.js';

export default async function handler(req, res) {
  // Ensure the original requested URL is preserved across Vercel rewrites
  const orig = req.headers['x-matched-path'] || req.headers['x-rewrite-url'] || req.url;
  if (orig && !orig.includes('index.js')) {
    req.url = orig;
  }
  return handle(req, res);
}

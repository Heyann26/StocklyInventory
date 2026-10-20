import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handle, database } from './lib/server.js';

const isMainModule = Boolean(
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]) &&
  !process.env.VERCEL &&
  !process.env.AWS_LAMBDA_FUNCTION_NAME
);

if (isMainModule) {
  const initial = await database().catch(() => ({ users: [] }));
  if (initial && !initial.users.some(user => user.role === 'admin')) {
    console.log(`Kode setup admin Stockly (gunakan di halaman Buat Admin): ${initial.setupToken}`);
  }
  const port = Number(process.env.PORT || 3000);
  const server = http.createServer(handle);
  server.listen(port, '0.0.0.0', () => console.log(`Stockly berjalan di http://localhost:${port}`));
}

export default handle;

import http from 'node:http';
import { handle, database } from './api/_server.js';

const port = Number(process.env.PORT || 3000);

const initial = await database().catch(() => ({ users: [] }));
if (initial && !initial.users.some(user => user.role === 'admin')) {
  console.log(`Kode setup admin Stockly (gunakan di halaman Buat Admin): ${initial.setupToken}`);
}

const server = http.createServer(handle);
server.listen(port, '0.0.0.0', () => {
  console.log(`Stockly dev server berjalan di http://localhost:${port}`);
});

# Stockly — Stock Opname

Aplikasi inventaris berbahasa Indonesia dengan dashboard stok, stok minimum per produk, mutasi masuk/keluar, stock opname yang bisa disimpan dan dilanjutkan, laporan CSV, akun pengguna/admin, kritik dan saran, pemantauan error browser/server, serta notifikasi web push untuk HP.

## Jalankan di komputer

1. Pasang Node.js 20 atau lebih baru.
2. Buka PowerShell di folder proyek, lalu jalankan:

   ```powershell
   $env:PORT=3001; npm.cmd start
   ```

   `npm.cmd` dipakai agar PowerShell tidak memblokir skrip `npm.ps1`. Terminal menampilkan kode setup satu kali untuk admin awal. Simpan kode tersebut.
3. Buka `http://localhost:3001`, pilih **Buat akun admin**, dan masukkan kode dari Terminal beserta nama, email, dan kata sandi admin (minimal 10 karakter).
4. Setelah admin dibuat, pengguna lain dapat memilih **Daftar akun**. Admin masuk dari formulir **Masuk** yang sama dan memiliki menu **Admin & Monitoring**.

Biarkan Terminal tetap terbuka selama aplikasi digunakan. Data inventaris dan akun tersimpan di `data/db.json`.

## Akses lewat HP dan notifikasi

Notifikasi push membutuhkan situs HTTPS, browser yang mendukung service worker, serta izin notifikasi dari pengguna. Publikasikan aplikasi terlebih dahulu, buka alamat HTTPS dari HP, masuk ke akun, lalu pilih **Pengaturan → Aktifkan Notifikasi**. Di iPhone, tambahkan situs ke layar utama sebelum mengaktifkan notifikasi. Setelah itu, Stockly dapat mengirim peringatan saat stok melewati batas minimum, saat ada kritik/saran baru, dan saat browser melaporkan error.

Tata letak aplikasi responsif untuk ponsel. Manifest dan service worker membuatnya dapat dipasang ke layar utama sebagai aplikasi web.

## Publikasikan di Render

1. Push proyek ke repository GitHub dan hubungkan dengan Render.
2. Pilih **New → Blueprint**. Render menggunakan `render.yaml` untuk membuat layanan web dengan disk persisten 1 GB.
3. Isi `ADMIN_EMAIL` dan `ADMIN_PASSWORD` pada pengaturan environment Render. Kata sandi admin minimal 10 karakter. Aplikasi membuat akun admin saat pertama kali dijalankan. Jika tidak diisi, kode setup admin akan tampil pada log deployment.
4. Buka URL HTTPS yang diberikan Render, lalu daftar akun pengguna lain sesuai kebutuhan.

Notifikasi HP tidak dapat bekerja pada alamat `http://localhost` dari perangkat lain. Situs harus tersedia di internet melalui HTTPS. Disk persisten Render memerlukan layanan berbayar. Simpan backup data dan jangan menghapus disk.

## Publikasikan gratis di Vercel + Supabase

Vercel menjalankan API melalui `api/[...path].js`, sedangkan Supabase menyimpan data Stockly secara persisten. Jangan mengandalkan penyimpanan file lokal pada deployment serverless.

1. Buat project Supabase baru pada paket Free.
2. Buka **SQL Editor** di Supabase, jalankan isi `supabase-setup.sql` satu kali.
3. Dari **Project Settings → API**, salin Project URL dan `service_role` key. Simpan key secara rahasia; jangan masukkan ke GitHub atau file frontend.
4. Impor repository ke Vercel. Pada **Environment Variables**, tambahkan `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, dan `ADMIN_NAME`. Isi key rahasia hanya di Vercel. Kata sandi admin minimal 10 karakter.
5. Deploy. Vercel menyediakan alamat publik `.vercel.app`. Uji pendaftaran, login, dan penyimpanan produk sebelum memakai data stok sungguhan.

Backend tetap memakai file lokal saat dijalankan di komputer atau Docker. Untuk hosting Vercel, kedua variabel Supabase wajib diisi. Penyimpanan satu dokumen JSON ini ditujukan untuk demo dan pemakaian ringan; perubahan serentak dari banyak pengguna dapat saling menimpa.

## Fitur admin

- Ringkasan jumlah akun, masukan baru, error, dan sesi opname aktif.
- Daftar pengguna terdaftar tanpa menampilkan kata sandi.
- Tinjau dan selesaikan kritik/saran.
- Catatan error JavaScript dari browser dan error API dari server; admin dapat menandai error sudah ditinjau.
- Peringatan push untuk masukan baru, error browser, dan stok yang baru melewati batas minimum.

Kata sandi disimpan sebagai hash scrypt; sesi login memakai cookie HttpOnly dan berlaku 7 hari. Pendaftaran membuat akun pengguna biasa; hak admin hanya diberikan saat setup awal atau lewat konfigurasi deployment.

## Endpoint utama

- `GET /api/health`, `GET /api/auth/status`
- `POST /api/auth/setup`, `/api/auth/register`, `/api/auth/login`, `/api/auth/logout`
- `GET /api/dashboard`, `GET, POST /api/products`, `PUT, DELETE /api/products/:id`
- `POST /api/products/:id/adjust`, `GET, POST /api/sessions`
- `POST /api/sessions/:id/item`, `/api/sessions/:id/complete`
- `GET, POST /api/feedback`
- `GET /api/admin/overview`, `PUT /api/admin/feedback/:id`, `PUT /api/admin/errors/:id`
- `POST, DELETE /api/push/subscribe`, `POST /api/push/test`

Penyimpanan JSON cocok untuk prototipe dan satu layanan kecil. Untuk penggunaan ramai, banyak admin, atau data usaha kritis, pindahkan data ke PostgreSQL dan tambahkan backup terjadwal.

# ORKUT PPOB - Node.js 20-24 (JSON Storage)

Versi ini tidak membutuhkan MySQL. Data disimpan di `data/*.json`.

## Perbaikan OkeConnect
- Konfigurasi Member ID, PIN, dan Password disimpan permanen di `data/settings.json`.
- Bug sebelumnya yang membuat Password OkeConnect hilang setelah disimpan sudah diperbaiki.
- Tombol **Tes Koneksi OkeConnect** memvalidasi kredensial ke endpoint saldo.
- Jika koneksi berhasil, status menjadi **TERHUBUNG**.
- Setelah koneksi berhasil, sistem otomatis melakukan sinkronisasi produk OkeConnect.
- Menu **Produk OkeConnect** menampilkan produk yang berhasil disinkronkan.
- Produk tidak ditampilkan sebagai produk OkeConnect sebelum koneksi/sinkronisasi berhasil.
- Tombol **Sync OkeConnect** dapat digunakan untuk memperbarui harga/status produk.

## Menjalankan

```bash
npm install
npm start
```

Node.js yang didukung: `>=20 <25` (Node 20, 21, 22, 23, 24).

## Login default

- URL: `/admin`
- Username: `admin`
- Password: `admin123`

Segera ubah password admin setelah login.

## Konfigurasi OkeConnect

Masuk ke **Konfigurasi**, isi:

- OkeConnect Member ID
- PIN
- Password Provider
- Margin Global

Klik **Simpan Konfigurasi**. Panel akan langsung mencoba koneksi dan jika berhasil melakukan sync produk.


## Integrasi Frontend PPOB

Semua halaman HTML di `public/front/` sekarang menggunakan endpoint internal Node.js `/api/client` untuk mengambil produk dan membuat transaksi. API OkeConnect tetap dipanggil dari server sehingga credential OkeConnect tidak ditaruh di HTML.

Domain produksi yang disiapkan: `https://hawiyadev.rbhost.my.id` (atur `PUBLIC_URL` di `.env` bila diperlukan).

Alur: Konfigurasi OkeConnect -> Tes Koneksi -> Sync Produk -> produk tampil di halaman frontend -> transaksi dikirim melalui Node.js -> Node.js meneruskan ke OkeConnect.

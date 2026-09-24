# Product OkeConnect -> HTML

Halaman HTML di `public/front/*.html` sekarang mengambil produk dari:

`GET /api/client?action=products&category=...&membership=...&source=OkeConnect`

Backend membaca `data/products.json`. Jika data produk kosong tetapi konfigurasi OkeConnect lengkap, endpoint akan mencoba sinkronisasi sekali secara otomatis.

Setelah konfigurasi OkeConnect berhasil disimpan, produk disimpan ke JSON dan langsung dapat dibaca halaman HTML.

Untuk debug, buka browser DevTools > Network lalu cek request `api/client?action=products`.

# Closed API

Versi ini tetap tanpa MySQL. Data disimpan di `data/*.json`.

## Konsep
API tertutup menggunakan satu API key yang hanya disimpan di server pada `.env`. Jangan taruh `CLOSED_API_KEY` di JavaScript frontend.

Set `.env`:

```env
CLOSED_API_KEY=isi-api-key-rahasia-yang-panjang
```

Header request:

```http
X-API-Key: isi-api-key-rahasia-yang-panjang
```

Endpoint:

- `GET /api/v1/products`
- `POST /api/v1/transaction`
- `GET /api/v1/history?id_user=...`
- `GET /api/v1/trx?ref_id=...`
- `POST /api/v1/member`

Contoh:

```bash
curl -H "X-API-Key: $CLOSED_API_KEY" http://127.0.0.1:3000/api/v1/products
```

Jika API key tidak diisi, endpoint closed API sengaja mengembalikan HTTP 503. Jika key salah, HTTP 401.

Kredensial OkeConnect tetap berada di konfigurasi server dan tidak dikirim ke browser.

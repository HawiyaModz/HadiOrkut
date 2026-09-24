# ORKUT PPOB — Vercel Full Edition

## GitHub → Vercel
1. Upload this folder to a GitHub repository.
2. Import the repository in Vercel.
3. Vercel will detect `vercel.json` and `api/index.js`.
4. Add Environment Variables in Vercel:
   - `SESSION_SECRET`
   - `OKECONNECT_MEMBER_ID`
   - `OKECONNECT_PIN`
   - `OKECONNECT_PASSWORD`
   - `PPOB_SECRET`
   - `GLOBAL_MARGIN` (optional)
   - `CLOSED_API_KEY` (optional)
5. Deploy.

## URLs
- `/`
- `/front/game.html`
- `/front/ewallet.html`
- `/front/pulsa.html`
- `/front/data.html`
- `/front/pln.html`
- `/admin`
- `/health`

## Important Vercel limitation
This project still uses the existing JSON store for compatibility. Vercel serverless filesystem is ephemeral, so JSON changes made by Admin (members, transactions, settings) are NOT guaranteed to persist across cold starts/redeploys.

For production persistence, connect a persistent store (Vercel Postgres/Blob/KV or another database). OkeConnect credentials should preferably be supplied as Vercel Environment Variables so product sync does not depend on JSON persistence.

The browser never receives the OkeConnect credentials.

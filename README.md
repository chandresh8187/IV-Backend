# IV APP API

Node.js/Express and MySQL backend for IV Square Structure production management.

## Setup

1. Copy `.env.example` to `.env` and fill in database, JWT, CORS, and Firebase settings.
2. Keep the Firebase service-account JSON outside the project and point `FIREBASE_SERVICE_ACCOUNT_PATH` to it.
3. Run the SQL files in `migrations/` against the target database, in date/name order.
4. Run `npm ci` and then `npm start`.

Use a random `JWT_SECRET` of at least 32 characters. `ALLOWED_ORIGINS` accepts a comma-separated list, for example `https://iv.example.com,https://admin.iv.example.com`.

## Health check

`GET /health` verifies that the API process and MySQL connection are available.

## Deployment notes

- Do not upload `.env`, `.git`, `node_modules`, or Firebase credential files.
- Terminate HTTPS at the hosting proxy and set `TRUST_PROXY_HOPS` correctly.
- Install with `npm ci --omit=dev` in production.

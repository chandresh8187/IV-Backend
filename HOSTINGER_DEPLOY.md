# Hostinger deployment

This archive contains the Node.js backend and the compiled IV web application
in one application root.

## Required layout after extraction

```text
application-root/
  server.js
  package.json
  public/
    index.html
    assets/
```

## Deploy

1. Keep the existing production `.env` and `firebase-ser.json` files on the
   server. They are intentionally not included in this archive.
2. Extract this ZIP directly into the Node.js application root. Do not leave
   the files inside an additional nested folder.
3. Set the startup file to `server.js` and use Node.js 20 or newer.
4. Install dependencies with `npm install --omit=dev`.
5. Run `npm run migrate:status`, `npm run migrate:dry-run`, and then `npm run migrate`.
6. Restart the Node.js application from hPanel only after migrations succeed.

The startup log must contain both:

```text
Web build loaded: .../public/index.html
IV API and web application listening on port ...
```

Then verify `/`, `/login`, `/api`, and `/health`.

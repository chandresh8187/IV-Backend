# Fix summary

- Mounted the missing supervisor routes and added the missing user update and activation/deactivation endpoints.
- Added secure extra-Superadmin creation with current-password verification and protected Superadmin account management.
- Added JWT expiry, issuer/audience checks, active-account enforcement, login rate limiting, global API limiting, security headers, restricted CORS, request-size limits, and safe error responses.
- Removed password-hash logging and prevented database/internal error details from being returned to clients.
- Corrected Firebase credential loading so service-account files remain outside the source archive.
- Added Socket.IO user authentication/rooms, health and 404 routes, upload errors, graceful shutdown, and database pool tuning.
- Added settings caching, parallelized dashboard aggregates, removed the history N+1 query, made PDF file operations asynchronous, and made zinc notifications non-blocking after committed saves.
- Added missing notification-token ownership handling, manual-shift role/assignment checks, and transaction cleanup for production deletion.
- Added support-table migration and deployment documentation.
- Verified JavaScript syntax, API startup/CORS/404 behavior, and production dependency security audit.

Run all files in `migrations/` that have not already been applied, then configure values from `.env.example` in your hosting environment.

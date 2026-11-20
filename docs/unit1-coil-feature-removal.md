# Coil stock and QR management retired

Unit 1 app and web no longer expose coil stock, stock cards, inwards/invoices, adjustment, deletion, or QR generation/printing screens. Their frontend forms, printing helpers and API mutations were removed. The backend coil router exposes only read-only production details, existing scan/lookups, and historical usage. Old stock/generator routes are not registered; no old client can create or change stock through them.

Production Assign coil / Scan coil remains at the user's explicit request, including selection of an existing inward/rate, stock availability validation, and existing production weight/cost calculations. Existing coil identities and data, production references, invoice history, role-based scan field settings, and schema migrations are retained to support that flow and historical reports. No records are cleared or measurements fabricated. A future replacement is intentionally not implemented until specified.

Restart the backend and rebuild/reload clients to apply removal.

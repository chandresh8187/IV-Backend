# Shared material QR and coil traceability

The existing JSON QR stays unchanged: type unit1-material-stock, version 1 and the party/material stock key. It is shared by all bundles of that material and does not encode a frozen quantity or a physical bundle identity. App and web now have Scan material QR, and View material & source coils from the QR preview.

Authenticated GET /api/unit1/material-register/trace/:key requires material-stock view permission. It returns the current produced/dispatched/available quantities and all producing coil positions, with original QR references, good-production quantities, recorded full coil-used kg, recorded hole-scrap kg and production dates. Missing weight calculations remain unknown. Only matching party/material specifications are included.

Invoice/vendor/rate and other coil details are filtered server-side using the existing role-based QR scan field settings. The QR carries no invoice/rate values. Stock and trace queries refresh after production, dispatch and template/coil corrections. Shared stock QR cannot identify which source is inside one specific physical bundle; individual bundle tracking has not been fabricated.

Existing shared QR labels remain compatible. No new measurement, production or stock record is created by scanning. No database schema migration is needed for this feature; restart the backend and update clients.

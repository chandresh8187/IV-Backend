# Party material stock register

Production > Material stock is a read-only ERP table in app and web. Rows are grouped by party, Structure Type, section, cut length, material, grade and thickness. It reads good production bundles directly using their effective historical metadata. Rejected inspection quantities are not added. Existing dispatch allocations are subtracted once via the source production bundle, so retired stock capture does not prevent recent production from appearing. No old material-stock backfill or dispatch endpoints are re-enabled.

GET /api/unit1/material-register requires unit1.material-stock.view. Clients search locally by party/material and refresh every ten seconds. The new query key is included in production/template/coil correction invalidations. Dispatch appears in the top right but remains disabled at the user's explicit request until its replacement flow is specified. No party QR, bundle packing, opening stock or dispatch editing is restored.

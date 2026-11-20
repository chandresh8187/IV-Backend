# Unit 1 coil stock register

Production > Coil stock is available in app and web. It lists exact material/grade/width/thickness groups as a stock register, using existing inward weights, recorded adjustments, and full good/rejected production usage. Historical unknown weights stay pending. Source inwards/rates and historical quantities are unchanged.

Add stock records one size with material, configured grade (GP GSM 80–140), width, thickness, actual total inward kg, coil count, rate/kg, vendor, invoice and optional TC. It reuses the transactional invoice service and stable request ID, preserving full inward kg without division by coil count. Internal identity reservations support existing production history; no QR generation or printing feature is exposed.

API: GET /unit1/coils/stock-summary; POST /unit1/coils/stock-receipts. Permissions: unit1.coils.view and unit1.coils.create. Stock edits/deletes, old invoice management routes and QR generation remain retired. App/web invalidate existing coil and dependent production/material queries after receipt and refresh the stock register every 10 seconds. Backend restart is required after deployment.

## ERP invoice entry

Invoice/vendor/optional TC fields appear first. Coil items use a searchable saved size list including material and grade. Add new size persists only its specification/creator/time in the existing catalog; it does not create inward stock. Select a size, enter coil count, full line kg and rate, then add it with Plus. Lines can be edited or removed before submission; unfinished item entry blocks invoice saving and can be cleared. Saving records all lines atomically with one request ID and an exact gram-summed invoice weight. Every line requires its actual total weight; there is no automatic weight allocation between sizes or coils. Existing inwards/production histories retain their original values.

## Invoice QR printing

Each invoice inward line now has a stable QR in unit1_stock_qrs.inward_id (unique). The Print QR action opens a quantity form; each label copy contains the same code and invoice/specification, and reprinting retains that identity. It never adds stock or changes coil count. Production scan immediately resolves that inward/rate, checks availability and job dimensions, and validates the same source again atomically at assignment. Codes keep the existing CQ format and are saved on runs via stock_qr_id, so production/inspection/history source labels remain consistent. Legacy shared-size QRs retain their inward selector. Printing archived inwards is blocked. Apply the startup migration to add inward_id before using the endpoint.

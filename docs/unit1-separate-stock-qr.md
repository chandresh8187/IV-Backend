# Separate coil stock and reusable QR flow

Coil inwards remain the source of received kg, coil count, vendor, invoice and rate. New invoice inwards reserve internal physical identifiers for assignment/history compatibility but do not generate printable coil QRs.

`unit1_stock_qrs` stores one immutable identity for material type, grade, width and thickness. Its CQ######## code contains no inward weight, rate or physical quantity. Repeated generation of the same specification returns the same saved QR. Print copies repeat the same code.

Assignment scans this identity, checks the planning/job allowed width and thickness, then lists only matching material/grade/size inwards with available physical positions and stock. The user must select an inward/rate. Verification and assignment both validate that selection; assignment rechecks under locks. The physical position is internal and is not offered as an allowed-coil-number list.

New production runs retain the selected inward in `coil_id` and the shared identity in `stock_qr_id`. Existing rate/cost reports continue to derive their rate from the selected inward. Production and rejection usage therefore debit that inward; shared-QR runs are capped by its available balance rather than silently spending another rate's inward. Hole scrap remains included in full used kg and is not debited twice.

New and old QR references coexist. Reports, inspection snapshots and dispatch source links show the shared QR for new runs and the original physical identity for legacy runs. Scan-only responses obey existing role field settings and disclose only fields actually present in the shared QR identity. Existing inward/production measurements are not rewritten by this feature.

Schema migration: scripts/migrateUnit1StockQr.js (called by migrateUnit1Coils.js).

Validation: tests/unit1StockQr.test.js, native assignCoil/webWorkflowParity tests. The database integration test runs only with UNIT1_PHYSICAL_COIL_DB_TEST=1 on localhost and rolls all fixtures back.

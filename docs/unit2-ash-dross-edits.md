Ash and dross corrections
=========================
PUT /zinc-stock/byproducts/:id requires zinc_byproduct.manage.
Clients send the full date/ash/dross/note form, edit_version from the list, and a stable request_id for retries.
The edit retains the original zinc_rate_snapshot, purchase link, recording timestamp and original actor. It recalculates all monetary fields and recovered kg using the existing calculation service.
The stock-row lock serializes edits against linked zinc purchase corrections. A content version detects intervening edits and purchase-rate recalculations. Conflicting edits return 409.
Original and corrected rows are saved in zinc_byproduct_audit inside the same transaction. An audit failure rolls back the correction. Repeated identical requests do not create another correction.
Monthly and expense totals and PDFs read the corrected source row by transaction_date, so moving an entry transfers recovery between months. Physical stock and production measurements are not modified.
The app invalidates byproduct, monthly, expense and dashboard caches; web views listen to update events emitted after commit.
Migration: 20261102000600_create_zinc_byproduct_audit.sql.
Verification: ZINC_BYPRODUCT_DB_TEST=1 node --test tests/zincByproductEdit.integration.test.js (localhost disposable database only).

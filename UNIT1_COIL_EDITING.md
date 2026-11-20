# Coil inward corrections

Users with `unit1.coils.edit` see one **Edit inward** button per invoice in Coil Stock and invoice details, in Android and the merged web project (`IV-WEB`). The form contains every size in that inward. Invoice number/date, vendor and TC number are entered once; material, grade, width, thickness, quantity, rate and weight remain editable for each size. New sizes can be added in the same form.

Physical six-digit coil IDs, internal references, supplier coil references and existing QR references stay unchanged for existing coils. Quantity increases and additional sizes allocate new physical IDs as needed.

`PUT /unit1/coils/inwards/:anchorId` saves the entire inward in one transaction. It checks the invoice/date/vendor grouping against every submitted original batch ID; missing or concurrently changed membership requires a refresh. Every existing size must be included. Shared receipt fields apply to all sizes. All base coil changes are written before dependent recalculation, so a later invalid line rolls back the entire inward. The original single-batch endpoint remains available for older clients.

Original coil and production values are retained in `unit1_coil_revisions`, and dependent job/inspection/stock inputs in `unit1_job_card_revisions`. Material and geometry corrections update linked job plans, recalculate recorded coil use and hole scrap, reconcile production stock by its existing bundle ID, and refresh inspection report metadata. Actual production quantities and entered hole readings stay unchanged. Corrections that would leave already-consumed source stock negative are rejected. App and web invalidate dependent stock, production, history, inspection, physical-coil and invoice queries after one successful save.

Material, grade, width or thickness changes reset active affected runs to setup and require a new first-piece check. Rate, invoice and weight-only edits retain approval. The API rejects removing a numbered coil with production history, reducing weight below recorded numbered-coil consumption, or invalidating another active coil on a linked job. Omitted rates are retained; an explicitly empty rate clears the value.

Deploy the backend together with the app/web changes. Normal backend startup runs `scripts/migrateUnit1Coils.js`, which creates the audit table. The clean-install SQL also contains it; do not import the clean-install file into an existing production database.

Validation:

```powershell
node --test tests/unit1EditCoil.test.js tests/unit1JobCorrection.test.js tests/unit1EditJobCard.test.js
node --test tests/unit1EditInward.test.js
$env:UNIT1_EDIT_COIL_DB_TEST='1'
node --test tests/unit1EditCoil.integration.test.js
$env:UNIT1_EDIT_INWARD_DB_TEST='1'
node --test tests/unit1EditInward.integration.test.js
```

The integration test requires the migrated local Unit 1 database and a seed user/machine. It creates its own coil, job and production fixtures inside a transaction and rolls everything back. It refuses remote database hosts.

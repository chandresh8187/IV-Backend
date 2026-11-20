# Full job card editing

App and web allow editing order details, structure/member, section, shift, planned machine, cut length, material, coil width/thickness, punch sizes, profiles and every target position, including cards with previous production.

Changing production specifications resets active runs to setup and clears first-piece approval. The supervisor must check the revised dimensions before labour can record further production. Order-only changes retain approval. A machine change or a coil specification incompatible with the physical active coil requires returning that coil first; the edited planned machine clears the previous assignment. Target quantity cannot fall below the pieces already produced.

Edits correct existing dependent records as well as future operations. Bundle descriptions, customer/project and cut length are updated. Gross use and hole scrap are recalculated using the corrected length/punches and the recorded physical coil dimensions and density. Existing stock movements move to the corrected material identity while keeping their IDs, timestamps and actual NOS; opening stock is unaffected. Coil balances, history and regenerated PDFs reflect the correction. Corrections exceeding the available coil material or making already-consumed/transferred stock negative roll back.

Entered inspection measurements, actual production quantities, physical machine/coil identities, and event dates remain actual recorded facts. Inspection metadata and unambiguous revised targets are corrected. Ambiguous target matches are marked unmatched, with no invented readings. Prior values and affected record references are saved in `unit1_job_card_revisions`; referenced hole definitions remain as inactive rows for traceability.

Deploy the backend together with app/web changes. Normal backend startup runs the additive migration adding `unit1_job_card_holes.is_active`, `unit1_production_bundles.job_snapshot` and `unit1_job_card_revisions`; alternatively run `npm run unit1:migrate` before serving requests. Clean-install SQL includes these additions. Local migration was verified repeatedly, and the database integration test rolls back its fixtures.

Checks:

```text
node --test tests/unit1EditJobCard.test.js
```

The optional integration test requires a local seeded database and `UNIT1_EDIT_DB_TEST=1`; remote hosts are rejected.

# Unit 1 material Job Cards and Production Planning

## Screens and workflow

Job Cards are reusable material templates containing product, part/member, section, cut length, coil material/reference size and punch positions in mm. They contain no party, project or production quantity. Their PDF prints technical details only.

Production Planning contains a party, optional project/capacity, planning date and shift, plus up to 50 material lines. Each line selects a Job Card template, target quantity, machine and allowed physical coils. The list shows target, actual produced and remaining quantities per line. Actual production is never created by saving a plan.

The supervisor selects a machine and a planning/material line when assigning its coil. Only planning for that machine is offered. Allowed coil IDs remain hidden on assignment: the operator must scan or enter the physical coil's ID and the backend validates it. First-piece inspection remains required before output. Add Production and Add Inspections both require machine, then planning/material selection; actual measured dimensions remain blank until entered. Only an active assigned coil/run can receive production or inspection data.

## Linked corrections and retained records

Editing a template updates all non-archived linked planning materials through the existing audited correction service in one transaction. Original inputs, readings and actual quantities are preserved. Derived theoretical coil use, hole scrap, production history, inspection targets and stock metadata are recalculated; active affected runs return to setup for fresh inspection. An unsafe correction, such as exceeding a coil's capacity or making downstream stock negative, rolls back the entire update. Return incompatible active coils before changing material. Earlier selected coils of another material are removed with a revision so the manager can select appropriate replacements on the planning.

Planning corrections update all its material lines atomically. Target quantity cannot fall below already produced quantity. Existing material-line IDs remain stable; existing lines cannot switch template or disappear from the plan editor. Add another line for an additional material. Original header/line inputs and before/after revisions remain stored. Machine and quantity are selected per line, so one party can have materials on different machines.

Production and inspection reports use planning identity and preserve the technical template identity. Stock, party QR/bundles, dispatch records and source coils keep the original production/run/material-line references. App and web queries invalidate through existing realtime events and shared query keys.

## Delete and icon controls

Edit, print and delete row controls use icons with accessible labels; web icons also have tooltips. Add, Save and Cancel retain descriptive text. Delete asks for confirmation and archives records rather than deleting source data. Only users with the existing Job Card management permission can delete.

Archiving a template removes it from new selections. Existing linked planning can still be edited and produced using its retained specification. Archiving planning is blocked while any material has a setup, running or paused coil. Remove setup coils or return/complete active coils first. Once archived, planning and its material lines disappear from current lists while their production, inspection, stock and dispatch history stays intact. Repeated deletes are idempotent, and version checks prevent deleting a record changed since loading it. Re-running migrations does not restore archived items.

## Database and deployment

Deploy backend, web build and updated Unit 1 app together. Run `npm run unit1:migrate` before serving the updated clients; normal `npm start` already invokes it. Do not import clean-install SQL into an existing database.

The additive `database/unit1_production_planning.sql` creates templates, planning headers, material links, revisions and a write lock. `scripts/migrateUnit1Planning.js` is invoked at the end of the Unit 1 migrator. Every earlier job card is linked to one template and one planning, retaining its original party, project, date, quantity, holes, coil selections and source IDs. Existing independent orders are not silently merged by party. All rows are migrated, including retained archived rows. Repeated runs do not create duplicates. Legacy create requests also establish their links in the same transaction; edits to mapped material records must use planning or template management.

Local checks: app renderer tests cover material-only fields, machine/planning selectors, actual inspection entry, accessible icons, permissions and delete refresh. Localhost-only MySQL tests create/drop disposable schemas on port 3317 and cover multi-material creation, retry idempotency, stock capture, template corrections, original readings/quantities, planning rollback, legacy migration, safe archives and retained reports. PDF tests confirm no party/project/quantity on material-template exports. Web build and Android export succeed.

The complete backend suite retains four pre-existing unrelated fixture failures: schema-drift mock count, Unit 2 migration manifest, contractor permission mock and an outdated three-product expectation. These are separate from the passing planning/correction/archive checks. No production database or live deployment was changed during verification.

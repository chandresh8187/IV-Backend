# Unit 1 production counting and tracking

## Screens

Production contains Live production, Live inspections, Coil stock and Job cards. Existing Material stock, Production history and 3D tools remain available.

## Workflow

1. A production manager, plant manager or superadmin creates the job card, choosing one or more individual physical coils, without selecting a machine. Coils may come from different inward invoices. Selected coils must match the job material, but widths, thicknesses and grades may differ (for example, 258 × 3 mm and 256 × 2.8 mm). The job size is a reference; production weights and scrap use the assigned physical coil’s actual dimensions. Coil search accepts IDs, invoices and size formats such as 258x3mm or 258 × 3 mm.
2. Save persists the unassigned job card and its allowed physical-coil list. No machine or coil is attached and no setup run is inserted at this point.
3. Live production shows every active machine, including idle ones. Managers choose Assign job & coil on its row, select an open unassigned job card, then scan a QR label or enter the six-digit coil number. Machine, job and coil are committed atomically. Supervisors may attach a selected coil only to an already assigned job. Active assignments must be released before replacement. Verification rejects any physical coil absent from the selected list, even another coil from the same inward or a coil with the same size. The final assignment checks again within the transaction.
4. Assignment creates a fresh setup run. A supervisor uses Add inspections, selects the machine and records the actual hole measurements, cut length and section size. Inspection inputs start blank. Saving appears in Live inspections and approves this setup.
5. Add production always opens its machine selector. An unapproved or paused machine shows a warning without a save button. An approved running machine accepts whole-number Produced Qty (NOS), bounded by remaining job quantity and available coil material.
6. Saved production appears in the combined live table, with actual assigned coil, job material and entering user. Inspection and production updates refresh other signed-in devices through realtime events plus polling.
7. Repeated inspections remain available after first-piece approval. A new coil/setup or specification correction requires fresh approval. Managers can release/return or complete the current coil from Assign coil before changing it. Supervisor coil assignment does not grant unrelated management controls.

Superadmin has every supervisor action. Labour remains read-only for their assigned machine.

## Editing and persistence

`unit1_job_card_coils` stores each (job card, inward ID, physical coil number) selection. `unit1_job_coil_revisions` preserves original selection inputs and before/after lists with the actor and timestamp. Editing the list updates current and future assignment checks atomically with the job edit; it never rewrites the actual coil used in old production or invents inspection measurements. An active coil cannot be removed from the allowed list until it is released.

Coil inward corrections include planned jobs as dependencies. They cannot remove a selected physical coil number or create incompatible specifications across selected coils; the error explains which plan must be revised, or the linked coils must be corrected together. Existing job/coil correction audit, stock and weight recalculation remain in place.

## Deployment

Deploy and restart the backend before the app/web updates. The existing startup migration now calls `scripts/migrateUnit1JobCoils.js`, which creates the selection and selection-audit tables. It seeds older jobs only from their already-recorded coil runs; it does not change existing runs, quantities or approvals. No migration was executed against live factory data during verification.

## API

- Job create/edit accepts `selectedCoils: [{coilId, coilNumber}, ...]`; create requires at least one selection. `plannedMachineId` is assigned when the card is created. Existing single-coil fields no longer attach a coil automatically.
- Job list/detail/PDF include the selected physical coil IDs.
- `POST /api/unit1/production/verify-coil` and `POST /api/unit1/production/runs` enforce list membership, compatibility, stock availability and occupancy. The second endpoint is the final atomic assignment.
- `GET /api/unit1/production/entries` supplies the current-shift live production table.
- `GET /api/unit1/production/live-inspections` supplies current-shift inspection rows, including the complete overnight shift. Its machine filter and pagination are server-side. Stored snapshots retain recorded actual dimensions.

## Validation limits

Database fixtures, UI tests and builds verify the flow without changing factory records. Camera scanning requires a physical-device check; web camera access requires HTTPS or localhost and a browser supporting BarcodeDetector. Manual six-digit entry remains available when camera scanning is unavailable.

## Production history

Choose a production operating date, shift and machine, then switch between Production entries, Inspections and Job cards. Saved inspection shiftDate/shift values drive history filtering, including checks made after midnight in the preceding operating night shift. Older inspections without a saved shiftDate fall back to their recorded calendar date; their actual readings are never inferred or rewritten. Inspection-only dates appear in the archive. Job cards with inspections but no production are included with zero recorded production and an inspection count. Both inspection tables and their PDF export use the same filters. Existing machine-specific calendar-date reports retain their original behaviour.

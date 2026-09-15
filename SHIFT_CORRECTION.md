# Previous shift corrections

In Live Production or Shift Status, a superadmin or plant manager selects
**Correct previous shift**, chooses a production date and an ended shift, and saves.
All connected devices switch Live Production to that shift. The selection is stored
in MySQL and stays selected across API restarts and normal automatic shift changes.

Users with production-save access can add missed entries and edit existing rows
in the selected shift until a manager chooses **Resume current shift**. Normal
row-edit grants apply again after resuming. The automatic shift schedule continues
independently; resuming returns to whichever shift is running then.

New correction entries require a planning-item selection. Existing entries keep
their planning link. Planned-quantity limits, production calculations, planning
progress recalculation and history refresh still apply. Corrections record the
original shift/date and the editing user's ID. Correcting historical records is
allowed even if the plant is currently stopped.

Each updated app form sends its shift ID and context revision. Saves and manager
changes share a transaction lock, so an open form cannot silently write to a
different shift. A stale form is rejected and must be reopened. Older apps without
shift context cannot save while correction mode is enabled.

## Deployment

Deploy both the backend and updated app. Include these additive migration files:

- `20260912000100_create_production_shift_context.sql`
- `20260912000200_seed_production_shift_context.sql`

Run `npm run migrate` before serving the new API; the existing startup flow also
runs migrations. These files create and seed a new settings table; they do not
delete or truncate production, planning or shift records.

Verification: `node --test tests/shiftCorrection.test.js`. The tests use isolated
fixtures and never connect to the configured database or send notifications.

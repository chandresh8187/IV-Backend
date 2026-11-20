# Unit 2 gas bottle returns

In app or web: open **Gas Stock**, tap a **Ready to start** (or paused/ready to resume) **GAS-1–GAS-4** card, enter the actual **Return time** and a reason, then choose **Return to stock and empty slot**. Available to users with existing `gas.manage` permission.

- Only positions whose bottle status is `ready` can be returned. Running positions have no return/remove control, and the backend rejects return requests for running bottles, including requests from older clients or a screen that became stale after supply started. Never-started bottles return as unused. Previously paused bottles that are ready to resume remain partly used and retain their original weights, runs and pending consumption measurements.
- Returning does not invent an empty weight or reset gas remaining to nominal capacity. Actual gas use/cost remains pending until final empty weight is recorded through the existing workflow.
- Reopen any empty slot, select a stock bottle (unused or partly used), and place it or start/resume supply. Partly used bottles retain the original filled weight so final gas calculations cover all running periods, including runs at different positions.
- Gas Change Movements and the stock PDF include date/time, source slot, permanent bottle code, stock condition, reason and actor. Latest 100 returns are shown, consistent with the existing latest-100 movements report; older records remain persisted.
- Stock totals and movement screens refresh through the existing `gas_management_updated` event, app cache invalidation and web reload-after-save. Audits persist before/after data plus original inputs. Returns are transactional, check the bottle identity, serialize with placement/switch operations and use request keys for duplicate-submit protection.

Deploy backend plus the new versioned migration `20261028000100_create_gas_bottle_returns.sql` through the normal `npm run migrate`/server startup, then deploy web and app updates. No new native dependencies. Clean-install SQL includes the table and migration manifest entry; do not import it over existing data.

Validation: gas controller regression tests, localhost-only disposable MySQL return/reuse/final-weighing integration test, PDF text and rendered layout checks, four app UI regression tests (including running positions and a ready bottle starting while its details are open), targeted lint, web production build, 32 web Node tests and Android Expo export. Browser checks use isolated sample data, including desktop/390px return forms, slot clearing, stock counts, reuse selection and return history. No live bottle was returned by these tests.

The full Unit 2 app test run has 157 passing tests and 9 failures in the existing ProductionEntryEditing suite; those tests and production-entry sources were not changed by this feature. No physical-device APK install was tested.

Ready-only restriction follow-up: running-position returns are rejected without changing stock or gas runs. Eight backend checks and four app return tests passed. Web syntax and live-dialog transition checks passed. The initial ready-only web build passed, but the final full web build/lint rerun stalled in this environment after the live-dialog refresh improvement; do not treat that final rerun as completed. No additional migration is required.

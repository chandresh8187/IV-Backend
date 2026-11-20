# Unit 1 machine maintenance

## Start → work → Done

In the Unit 1 app or web, open **Production > Maintenance**.

1. The screen opens on **Running maintenance**. Tap **Add Maintenance** at the top right. In the centered modal, select a machine and enter its **Maintenance reason**. There is no starting-note input. Machines already under maintenance are excluded from the dropdown.
2. Confirm the start. The backend records the breakdown date/time and the machine shows **Under maintenance**. Its running table row shows the reason, start time, elapsed breakdown time and who started it. Sessions persist after refresh or another user's login.
3. Tap **Complete maintenance** in the running row. The centered modal asks for **Replace part name**, **Approx cost (INR)**, **Action which was taken to complete** and **Remark**. Cost and action are required; part and remark are optional. Enter 0 only if there was no cost.
4. Tap **Save Done**. One transaction records the finish time, calculates the exact duration, creates the completed record and clears the machine badge. The UI switches to **Completed maintenance**, clearing filters so the new row is visible.
5. Both tabs use bordered tables with horizontal scrolling. The completed table includes reason, date, automatic breakdown start/end/duration, part, cost basis, action, remark and recorded-by details. Dates display as DD/MM/YYYY and times use 12-hour AM/PM in IST. Export the completed report with **Maintenance report PDF**.

Pause running production before starting maintenance. While a session is active, the backend blocks first-piece approval that starts production and blocks resuming a paused production run. Production is not automatically resumed on Done; use its normal controls. Existing production quantities/timers are not fabricated or rewritten.

Elapsed duration is the wall-clock interval between the recorded Start and Done actions. This is the recorded maintenance interval, not a sensor measurement or an automatic fault detector. The UI clock is indicative; the persisted duration uses the database clock. New costs are user-entered approximate amounts, explicitly marked as approximate in history and PDFs. Earlier amounts stay labelled recorded. Cost is never calculated from elapsed time.

## Optional schedules and earlier records

Existing schedules and their reminder data remain stored; the main screen now has exactly Running maintenance and Completed maintenance tabs. New starts are unscheduled and do not guess which schedule was fulfilled. Existing linked sessions still complete their linked schedule normally.

Reason is stored in the existing session original_input JSON; approximate cost basis is stored in completed_input. Both are included in audit revisions and returned to app/web and PDFs. No schema migration is needed for these fields. Earlier starting notes remain visible as Earlier note rather than being rewritten into a fabricated maintenance reason. Historic records without exact times remain Not recorded; recorded downtime and all original inputs are retained.

Managers/admins can correct cost, work, parts, notes and schedule linkage with an audit reason. Automatically recorded session machine, completion date and duration cannot be manually overwritten. Voided completed services stay in the audit/history; they are excluded from totals and recurrence and do not reopen the machine. Original start/completion inputs and before/after revisions remain stored.

## Reminders and refresh

Dashboard, maintenance views, machine lists and production badges refresh through the existing realtime events and query invalidation. Overview views also poll every minute. Inactive machines retain history and can finish an already started session.

Daily Unit 1 push reminders are checked after 09:00 IST, using the existing Firebase sender, registered app devices and maintenance-view permission. Backend must be running; browser background push is not added. Linked schedules already under maintenance are not treated as due/overdue reminders. Persistent daily claims/retries remain unchanged.

## Deployment and checks

Deploy backend and run the normal `npm run unit1:migrate` (also run at normal startup). The additive `unit1_maintenance_sessions` table is created without changing existing service records. Deploy the updated app JavaScript and web build. No new native dependency is required. Do not import clean-install SQL over a live database.

Integration tests create/drop uniquely named localhost-only schemas. The new workflow is checked for duplicate starts, running-production rejection, concurrent starts, repeated Done saves, server-only times, exact durations, immutable timing, audited cost corrections, recurrence and retained historical records. Tests use an isolated temporary MySQL instance on port 3317; no production database or real notification sender is used.

Existing unrelated backend schema/contractor/product fixture failures are reported separately from the maintenance checks. A native APK install and production deployment are not performed by local export/build checks.

## Completed-maintenance PDF table

Completed reports mirror the app/web Completed maintenance table: ID, machine, maintenance reason, date, breakdown start/end (IST), total breakdown time, replaced part, cost/basis, action taken, remark, recorded by and status. The PDF uses A3 landscape pages, violet table headers, full cell borders and wrapped text. Repeated column headers and record identity keep continued rows understandable. Earlier notes, audit versions, missing measurements and approximate-cost labels are retained. Download reports again after deploying the backend to get the revised table layout.

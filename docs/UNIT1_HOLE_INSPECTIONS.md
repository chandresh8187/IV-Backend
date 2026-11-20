# Unit 1 hole inspection flow

First-piece checks and rechecks use a modal wizard in mobile and web. Each job-card hole is measured individually, including its punch letter/size, profile and target position. Previous preserves values. Review shows all readings; saving the first piece enables bundle entry. A bundle continues to reference the latest saved inspection.

The machine's Entries and Hole checks buttons open separate screens. Inspection history is filtered by calendar date in Asia/Kolkata, paginated at 20 checks. PDF export includes all checks on that date, up to 200; a larger report returns an explicit error instead of silently omitting data.

New inspections retain an immutable JSON snapshot of job, coil, inspector, shift and readings, plus optional remarks. A client request key prevents duplicate records on retries; reusing it for different readings returns 409. Existing inspections remain visible using their existing job definitions and are marked as legacy. Legacy values cannot reconstruct changes that occurred before snapshots existed.

Target and measured values are positions in mm. Deviation is measured minus target. No tolerance limits or automatic pass/fail verdict have been assumed. Inspector identity comes from the signed-in account; the PDF has a blank physical signature line.

## Deployment

1. Deploy the backend and run `npm run unit1:migrate` (also invoked by normal server startup). The additive migration adds `report_snapshot`, `remarks` and a unique nullable `request_key` to `unit1_hole_checks`. Clean-install SQL includes these fields. Existing records are preserved.
2. Build/deploy the merged `IV-WEB` project. Generate PDF opens a separate preview page with Share and Download. Generating does not trigger either action. The preview reuses the same authenticated PDF bytes without another API request. Unsupported browser sharing directs the user to Download.
3. Run `npm ci` in Unit 1 mobile, then create and install a new Android release APK. `react-native-pdf-renderer` now provides the same in-app preview approach as Unit 2. Share opens the share sheet only when pressed; Download lets the user choose a folder. This native module cannot be sent to the previous APK through OTA alone. Version 1.0.3 / versionCode 4 uses runtime `unit1-1.0.3-expo56`; future compatible JS updates remain on `unit1-production`.

PDFs reuse Unit 2's company identity and logo. Only this report overrides the address with:

Nr. Ghanshyam Paper Mill, At : Padavala , Tal : Kotda Sangani, Dist : Rajkot-360024

## Validation

`node --test tests/unit1HoleReports.test.js tests/unit1HoleCheckSave.test.js tests/unit1MachineAccess.test.js tests/reportBranding.test.js`

Also validate the web production build, mobile Android JS export, and a device walkthrough with the new APK. Native share-sheet behavior requires device testing.
# Production history exports and job card printing

The history toolbar no longer prints the entire screen. Production and Hole Checks each have a Generate PDF action that opens preview first. Job cards have Print Job Card; its preview provides an explicit Print action alongside Share and Download.

- `GET /unit1/production/history/pdf?date=YYYY-MM-DD&shift=all&machineId=` exports all matching production entries, newest first, up to 2000 entries. Larger selections return an error asking for narrower filters, rather than a partial report.
- `GET /unit1/production/history/hole-checks/pdf?date=YYYY-MM-DD` exports that inspection date across all machines and shifts, using the existing 200-inspection limit.
- `GET /unit1/production/job-cards/:id/pdf` exports the selected job card and all punch target positions.

All exports require production-view access; Labour cannot export these reports. PDFs use the shared company name/logo and Unit 1 address. Deploy the backend with the web/app changes; no additional schema migration is needed for these exports.

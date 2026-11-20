# Unit 1 first-piece dimensions

During setup, the inspection wizard collects actual measured cut length and section size before the hole readings and review/approval step. Values start empty. Section dimensions follow the same order as the job card (for example web x flange x lip); x, X, multiplication sign and * separators are accepted. Measurements must be positive and use at most two decimals. A parseable target section requires the same number of measured components.

The existing hole-check endpoint accepts `measuredCutLengthMm` and `measuredSectionSize`. It requires both for a setup run and validates them against the locked job card before inserting any inspection readings or setting the run to running. Readings, inspector, request hash, event and status change commit in the same transaction. Retrying a request is idempotent; changing any length, section or hole reading with the same request key is rejected. Repeat hole checks on running/paused runs keep the existing hole-only workflow. Plain members can complete a first-piece check with an empty hole list when the job has no holes.

Actual dimensions are stored in the inspection's existing JSON report snapshot. No new SQL columns or migration are needed. Target cut length/section remain separate. Job-card correction preserves measured values and original section/cut targets while updating current nominal targets. Inspection history and PDFs show actual dimensions alongside targets, with cut-length deviation. Historical checks without these fields display Not recorded; no actual measurement is reconstructed from a job card.

No automatic tolerance verdict is introduced. Saving is the inspector's explicit approval after reviewing all measurements. Roles and production-stock calculations are unchanged; measured inspection length does not rewrite nominal job dimensions or production quantities.

Deploy the backend and updated app/web clients together. Older clients cannot approve a new first piece until updated because they do not submit the required actual dimensions. The mobile change adds no native dependency.

Verification: backend validation, first-piece transaction/idempotency, report text, correction preservation, isolated MySQL clean-install/full production workflow, native wizard tests, web wizard browser check, and PDF rendering.

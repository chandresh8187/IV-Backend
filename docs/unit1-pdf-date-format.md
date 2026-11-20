# Unit 1 PDF dates

Production, job card, inspection, maintenance schedule and maintenance history PDFs share `services/pdf/unit1ReportDateTime.js`.

- Dates: DD/MM/YYYY (29/10/2026).
- Recorded times: hh:mm:ss AM/PM in Asia/Kolkata (IST).
- SQL timestamps without offsets use the Unit 1 local database timezone. UTC/offset timestamps and JavaScript Date instants convert to IST.
- Date-only values stay date-only. Missing or invalid dates show Not recorded; historical times are never invented.

The native app and web download the same backend-generated PDFs. Deploy the updated backend and download reports again to get the new formatting, including reports for existing records. Previously downloaded PDF files do not change. Stored inputs, API date filters and filenames remain unchanged.

Validation: date conversion tests, text extraction from all five generated report types, pagination tests and visual review of rendered PDF pages.

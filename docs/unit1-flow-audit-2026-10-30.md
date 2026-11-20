# Unit 1 app and web flow audit

Checked on 30 October 2026 (India).

## Result

The core app and web workflows use the same persisted backend rules. The checks below passed after correcting the gaps found in this review. This verifies repository behavior and local database workflows; it is not a claim that a new build has been deployed or tested on factory camera/printer hardware.

| Flow | App / web alignment and verification |
| --- | --- |
| Job Card templates | Reusable material specifications, multiple manually entered coil sizes, W-beam positions measured from zero, edit/delete/print. Template corrections retain original measurements and update linked planning and derived records atomically. |
| Production planning | One party with multiple material lines, quantities and machines. Planning can be created before any physical coil QR exists. |
| Coil QR Generator | Material, grade, width, thickness, quantity and rate; unique saved physical IDs and printable labels. Starting/remaining stock weight is optional for legacy records and absent for new QR-only records. |
| Coil assignment | Select machine/planning, scan or enter the printed coil ID, then validate width and thickness on the server. Material type and grade do not restrict matching. First-piece approval remains required. |
| Inspection / rejection | Actual measurements remain inspector inputs. Each inspection adds only its newly rejected NOS. Rejected estimated material weight, consumed coil weight and punching scrap are saved separately. Rejected quantities never enter good stock. |
| Production | Good NOS remain separate from rejected NOS. Production entries retain calculated used weight and hole scrap. Coil consumption includes both good and rejected material. |
| Material stock / dispatch | Party balance, one shared party QR/10-character ID across bundles, separate physical bundle records and a separate actual weighbridge weight for each dispatched bundle. Transactions preserve dates, destinations and source coils. |
| Corrections | Original inputs are retained in revision records. Template, coil and dispatch-weight corrections refresh dependent records. Tests exercise invalid corrections, concurrent requests and duplicate retries. |
| Maintenance | Current Unit 1 machines, automatic start/end times, running/completed records, breakdown duration, reason/action/parts/cost/remark and report PDFs. |
| History / PDF | Production and inspection histories, shared backend PDFs, Indian dates and 12-hour times. Long inspection measurements have a bounded scroll area. |
| Roles / refresh | Machine responsibilities agree across clients. Common query invalidation and realtime events refresh production, planning, inspection, stock and dispatch views. |

## Gaps fixed

- QR-only and mixed historical coil groups no longer display an unknown weight as zero. Production/history detail dialogs also handle missing weight explicitly.
- Per-run and per-coil summaries now include rejected consumption and rejected punching scrap. Finished-coil residual calculations include rejected consumption exactly once.
- A later density configuration change no longer silently replaces the density recorded on a rejected entry during an unrelated template correction. A correction to the actual coil material uses its applicable density.
- Removing a setup coil now releases the run and adds an event instead of deleting it. This protects real production, inspection and rejected-stock history when a correction has moved an existing run back to setup.
- The web scanned-coil shortcut now opens machine/coil assignment instead of sending unused parameters to the production screen.
- Both web camera scanners have a lazily loaded image decoder fallback when native browser QR detection is absent or fails. Decoder tests read actual coil and party QR pixels. The dependency remains in a separate build chunk.
- The compatible `follow-redirects` security patch was applied. The final web production dependency audit reported zero known vulnerabilities.
- Integration fixtures were brought up to the current schema. Correction tests now use disposable databases rather than existing development records; the planning fixture uses configured localhost credentials rather than a fixed port.

## Validation

- Unit 1 backend suite: 169 passed, 0 failed; 14 optional integration tests skipped in this unit-test run.
- Separate database flow run: 10 checks passed, 0 failed, covering planning, QR-only coils, rejection, corrections, stock, concurrent dispatch/retries, maintenance and monthly allocation.
- Native app: 32 suites / 87 tests passed, including four app/web parity scenarios.
- Web: 39 tests passed; production build passed, with every generated chunk below 500 kB.
- Changed app/web source passed ESLint.

## Intentional differences and remaining deployment checks

- The 3D material viewer stays web-only, as requested. Native OTA updates and Android push diagnostics remain platform-specific.
- New QR-only coils have no starting weight. Actual dispatch weight is saved, but total/other scrap cannot be derived from a missing starting weight and is shown as unavailable rather than zero.
- Physical camera permission/focus, scanning a printed factory label, and printer output require a real-device smoke test after installing the app build and deploying the matching web/backend versions.
- Live Hostinger deployment was not performed by this audit.

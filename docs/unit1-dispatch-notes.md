# Dispatch notes

Save dispatch stores the entered DC number/date and each material's actual quantity/weight, then allocates quantities FIFO to its production source bundles. Header, material snapshots, source allocations and weights commit in one transaction. A shared dispatch lock and locking reads serialize concurrent dispatches and source corrections; stock is re-read at save time, including historical dispatch allocations. No overstock dispatch is accepted. Stable request keys prevent duplicate deductions on retry; changed inputs with the same saved key are rejected.

Material stock reads good production minus old dispatch allocations minus new dispatch-note allocations, exactly once. Dispatch does not deduct coil stock again, does not create invented coil/bundle measurements, and does not finalize coil scrap. Reports keep the dispatched material snapshot, original DC date, actual weight, server saved date/time and user. Quantity/weight are per selected material line; no destination or PDF flow is added at this stage.

GET /api/unit1/material-register/dispatches lists searchable, paginated material transactions. POST at the same path requires unit1.material-stock.dispatch; stock/report reads require unit1.material-stock.view. App and web invalidate stock and report after saving and refresh via production realtime events. Both offer a separate Dispatch report screen.

Startup migration migrateUnit1DispatchNotes creates the notes, lines, allocations and serialization-lock tables. The local schema was applied. Run Unit 1 migrations and restart the backend when deploying. Existing records are retained; integration test fixtures are rolled back.

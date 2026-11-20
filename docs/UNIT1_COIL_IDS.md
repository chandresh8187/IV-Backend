# Six-digit coil IDs

Every physical coil has its own globally unique six-digit ID. An inward containing four coils receives four different physical coil IDs. Entering that ID alone identifies its inward batch and numbered position; manual entry and QR scanning then use the same material/dimension, remaining-weight and assignment checks. A QR does not have to be generated before manual assignment.

The `unit1_coil_identifiers` registry reserves existing numeric inward aliases and assigns separate IDs to physical coils. Its primary key guarantees global uniqueness; `(batch_id,coil_number)` guarantees one stable identity per physical coil. New inward creation and quantity increases allocate missing identities within the inward transaction. Removed unused coil positions retain their reserved identities and cannot be scanned while outside the current quantity. IDs are never recycled. Editing inward details or returning/reassigning a coil preserves its physical ID.

Startup migration backfills physical identities for existing inwards and maps production through the existing batch/number pair. Production links, actual quantities, measurements and weights remain unchanged. Stored inspection metadata uses the physical ID and retains its previous inward reference. Stock details, new QR labels, live machines, production entries, history and PDF exports display the physical ID. Opening a production coil shows that specific ID together with invoice, vendor, TC, material, grade, size and rate.

Deploy/restart the backend before app/web updates. Startup migration creates and backfills the registry; the clean-install SQL also contains it. Migration is repeatable. Existing QR labels still scan through their inward reference and numbered position. Reprint them to put each physical coil's new unique ID on paper; an old shared inward ID alone cannot distinguish four coils.

The app and web use `GET /unit1/coils/lookup/:physicalId` for manual assignment and `GET /unit1/coils/:batchId/physical/:number` for printable labels and inward details. Older numbered QR URLs remain supported.

The local integration tests use `UNIT1_PHYSICAL_COIL_DB_TEST=1` and `UNIT1_COIL_CODE_DB_TEST=1` respectively. Fixtures are rolled back. They verify four distinct physical IDs, stable repeat allocation, inward details, legacy QR mapping, production identity and removed/reactivated positions.

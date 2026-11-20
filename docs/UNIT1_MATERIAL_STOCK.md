# Unit 1 party material stock

Material Stock in app and web shows produced, dispatched and available nos grouped by job-card party/customer. Opening stock stays in the existing ledger and historical reports, but is not counted as production on this screen. Source material descriptions, sizes, production entries and coil IDs are available inside each party.

## Stock status filters

App and web offer All stock (default), Available (available nos > 0), Partially dispatched (dispatched nos > 0 and available nos > 0), and Fully dispatched (dispatched nos > 0 and available nos = 0). Available includes partially dispatched parties with remaining stock. Status filtering happens on the server after party aggregation and search, before pagination. Totals and counts use the same filter, with a visible note identifying filtered totals. Changing search/status resets the page to 1. Current dispatch/stock realtime invalidation refreshes all status queries, so a completed dispatch moves a party out of Available and into Fully dispatched without changing history.

GET /unit1/material-stock/parties accepts status=all|available|partial|dispatched. Invalid statuses return 400. Existing records use their persisted production and dispatch allocations; no migration or recalculation of original quantities is needed for filtering.

## Production -> physical bundles -> shared party QR -> dispatch

1. Record actual production normally. Existing production is read from its original stock movements; migration never invents production, physical bundles or actual measurements.
2. Open the party and choose Bundles / QR. Select the actual production source (material, length, production entry and source coil), then enter the quantity physically packed in one bundle. Repeat for additional bundles.
3. Print the label and place it on that bundle. All bundles of the same party share the SAME QR contents. Each printed label also has its own U1-MB bundle number, material, quantity, job and source coil. The shared QR identifies the party, not a physical bundle; staff must choose the matching printed bundle number at dispatch.
4. Scan the party QR in the app/web, open its web URL, enter its printed 10-character party ID, or select the party from stock. Select one or more physical bundles, enter the outgoing nos and a SEPARATE actual net weighbridge material weight for EACH bundle. Exclude vehicle/tare. Partial bundle dispatch is supported; the label preview distinguishes available and originally packed quantities.
5. Choose To Unit 2 / To Other and record the dispatch. Available nos reduce by the actual outgoing quantities. Dispatch history retains each bundle's measured kg and its exact source movement/coil. Header kg is the sum of bundle kg, stored once for group reconciliation. Sources are never chosen using FIFO when dispatching these labelled bundles.

Creating or reprinting labels does not add production or consume stock. The original packing input, metadata snapshot, actor and date are retained in unit1_material_packed_bundles. Existing production has no assumed physical bundle size: staff enter actual packing quantities. Packing cannot exceed produced material after existing legacy dispatches and already packed quantities. Transactions, a shared reconciliation lock and request keys prevent concurrent over-packing or duplicate dispatch on retries. The legacy single-material dispatch endpoint rejects material with active labelled bundles, preventing it from consuming a labelled bundle's reserved pieces.

## Manual party ID when no camera is available

Each party receives a permanent, unique 10-character uppercase ID containing letters AND numbers. The server generates it with crypto.randomInt, omits O/0 and I/1 for readability, and reserves it in unit1_material_party_codes with unique indexes on both the party key and printed code. Collisions retry; simultaneous requests for one party return the same stored ID. IDs are never reassigned to another party.

Material Stock replaces the copied-QR-link field with 10-character party ID / Open party by ID in app and web. Lowercase entry is normalized. The ID appears on party cards, inside party details and prominently beside the QR on every printed bundle label. All bundles for a party share the same ID and QR; their individual U1-MB bundle numbers still distinguish their physical contents. New QR links contain the short ID. Existing 64-character party-key QR links remain accepted, and lookups always resolve back to the canonical party key before packing/dispatch, so source calculations are unchanged.

Migration backfills IDs for existing produced parties and preserves them on reruns. Future parties get their ID on first stock lookup. Reprint existing labels to include the new human-readable ID. The established party-name-correction rule still applies: a different normalized party identity gets its own ID; old IDs are not silently reassigned, and corrected material requires updated labels.

## Coil weight and scrap

Actual per-bundle weights are linked through source production movements to the physical coil that produced the material. The existing finishing rule remains: partial dispatch does not classify reusable coil balance as scrap. Select the production-finished option only when all production from the source coils is complete, or finish later through Dispatch Report -> Weight / finish.

Connected source coils are reconciled atomically only when all their produced material is captured in stock and dispatched, and every related dispatch has an actual weight. Starting coil kg minus the sum of actual dispatched material kg is total scrap. Zero means no scrap; negative scrap is rejected. Remaining source coil balance becomes zero and runs become completed. This total includes hole scrap; estimated hole scrap must not be added again. Legacy mixed opening-stock weights and unbundled historic production block finalization rather than fabricating source measurements.

## Corrections and history

The transaction table includes date/time (IST), party/material details, outgoing nos, actual weights by physical bundle, source coil IDs, destination, reference, actor and reconciliation status. Group scrap appears once on its closing dispatch; related dispatches reference it.

For new bundle dispatches, Weight / finish lets an authorized dispatcher select and correct a bundle's actual weight. The header total and any existing finished-coil scrap are recalculated in the same transaction. Editing only the total is rejected for these dispatches. Original inputs and calculations remain in unit1_dispatch_weight_revisions. Legacy dispatches retain their original total-weight correction workflow; NULL historic weights remain Not recorded.

Job/coil corrections retain actual production quantities and dispatch measurements. Bundle and transaction views follow their current source classification. Original printed/packing details remain auditable. Corrected bundle metadata shows a reprint notice. A party-name correction changes the party QR identity; print labels with the corrected party before use. An old party QR with no remaining matching production explains that the party may have changed.

To Unit 2 records outgoing Unit 1 dispatch only. It does not invent a receipt in the separate Unit 2 database.

## Deployment

Deploy backend first and run npm run unit1:migrate. Startup also invokes the additive migration before requests. The migration creates unit1_material_party_codes, assigns permanent IDs for existing stock, and creates unit1_material_packed_bundles and unit1_material_dispatch_bundle_weights without rewriting old production or measurements. The clean-install SQL is for new installations only; do not import it over existing data.

Then deploy web dist and the updated Unit 1 app JavaScript/build. No native dependency was added. Existing stock-view permission controls reading/printing; unit1.material-stock.dispatch controls physical packing, dispatch and weight corrections. Existing permission overrides remain effective. Both clients invalidate stock, reports, production and coil queries after changes, with existing material-stock/production realtime events refreshing other clients.

## Verification

- node --test tests/unit1MaterialStock.test.js tests/unit1MaterialDispatch.test.js
- UNIT1_STOCK_DB_TEST=1 node --test tests/unit1MaterialPartyCodes.test.js tests/unit1PartyMaterial.integration.test.js tests/unit1MaterialStock.integration.test.js
- App: npm test -- --runInBand; npm run lint; Expo Android JavaScript export.
- Web: node --test "tests/*.test.js"; npm run lint; npm run build.

Database fixtures create/drop only their own disposable unit1_party_test_* and unit1_stock_test_* databases on localhost. They verify existing-record grouping, shared party QR, real packing quantities, immutable snapshots, request retries, concurrent packing/dispatch, per-bundle weight validation/correction, exact source coils, atomic finish rollback, zero/positive scrap, correction refresh and source reclassification. Browser QA uses a local mocked API with test data only; no live records are changed.

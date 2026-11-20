# Unit 2 zinc purchases

Receipts are maintained in `zinc_purchases`, linked one-to-one to their inventory movement. Existing receipts are copied by additive, versioned migrations. Inventory movements retain the complete plant/kettle history, but receive rows are presented separately from zinc transfers and production usage.

`GET /zinc-stock/purchases` accepts an optional `month=YYYY-MM`; `POST /zinc-stock/purchases` creates a receipt; `PUT /zinc-stock/purchases/:id` corrects one. Viewing uses `zinc_stock.view`, adding/editing uses `zinc_stock.receive`, and purchase PDF export uses `zinc_stock.report`. Older clients receiving zinc through `/movements` create the purchase in the same transaction.

Corrections lock stock first, verify both stock and purchase revisions, and use a unique request ID to prevent duplicate saves. Quantity corrections change plant stock by the difference. A decrease cannot remove stock already transferred from that purchase batch. Kettle quantities and production measurements are not changed. Subsequent plant balance snapshots are corrected in the same transaction so reports and FIFO allocations reconcile.

`zinc_purchase_audit` preserves the original purchase, movement, stock, linked recovery inputs, actor, and correction timestamp. It records the inventory snapshot range and delta, permitting reconstruction of the pre-edit snapshots. Current purchase rates, financial-year averages, dated purchase totals, and related reports refresh after edits. Recovery records linked through `zinc_recovery_purchase_links` are recalculated when the rate they used is corrected; original inputs remain in the audit record. Legacy recovery links are established only where a receipt recorded by that time matches the stored zinc-rate snapshot.

The complete monthly PDF includes a separate purchase appendix. Monthly purchases can be viewed/exported with monthly-report permissions; managing them requires stock permissions.

Validation: `node --test tests/zincPurchase.integration.test.js` checks migration safety. To run the disposable MySQL integration checks, set `ZINC_PURCHASE_DB_TEST=1` with a localhost database account. The test creates and removes its own uniquely named database and does not edit the configured application database.

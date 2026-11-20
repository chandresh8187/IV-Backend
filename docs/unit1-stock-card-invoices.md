# Coil stock cards and invoices

Coil stock cards are keyed by normalized material type, grade, width and thickness. Create a card using POST /unit1/coils/stock-cards. This records only the specification and creator/time, without creating an inward, a QR, a coil quantity, or a weight. Duplicate specifications reuse the same card. GET /stock-cards supplies empty cards alongside existing inward-based groups in app and web.

Open a card to view its invoices and Add invoice. The selected specification is fixed in this form; record vendor code, invoice number, optional TC, coil count, rate and total weight. The existing transactional invoice service saves the complete weight on the inward; it is never divided by coil count. Query invalidation refreshes stock cards, invoices, production and material views. Full production/rejected strip usage continues to reduce stock once and retains the chosen inward rate.

Existing inwards appear in their matching cards without rewriting original weights or production. Empty cards show 0 kg. Pending historical inward weights remain pending. Card deletion archives its specification and inwards atomically with the existing stock-change audit, while retaining production history and active-assignment safeguards. Empty cards can be deleted; adjustment requires an inward.

The startup Unit 1 migration creates unit1_coil_stock_cards. Restart the backend after updating its code. The local schema was applied; no live database was modified.

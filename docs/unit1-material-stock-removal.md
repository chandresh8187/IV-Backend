# Material Stock feature removal

Material Stock, party QR labels, bundle packing, opening stock, rejected stock views, dispatch forms, weighbridge reconciliation forms and dispatch report screens/APIs are no longer exposed in Unit 1 app or web. The backend material-stock router is unmounted and permissions hidden. New production and startup migrations no longer populate Material Stock. Production, rejected-piece inspection records, full coil usage, hole scrap, coil stock and invoice QR assignment/printing remain supported.

Historical database tables and records are retained. Audited job/coil corrections continue to update only existing historical stock links; they cannot create new finished-stock movements. Historical weighbridge settlements remain inputs to existing monthly calculations. No database rows were erased.

The shared coil camera component and invoice QR dialog were retained under neutral names. Restart the backend and update clients to apply removal. A replacement Material Stock flow is intentionally left for future user instructions.

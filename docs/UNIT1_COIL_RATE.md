# Unit 1 coil inward rate

Each inward line records its own rate in INR per kg (`ratePerKg`, database `coils.rate_per_kg`). Rates are positive with up to two decimals, maximum 99999999.99. New app/web inward forms require a rate; existing coils and older clients can retain an unknown rate. Unknown is displayed as “Not recorded”, never zero. Existing unconsumed coils can be edited to add or correct their rate.

Once any production run references the coil, its rate cannot change. This preserves the rate seen by production history, including returned/reinserted coils. Production run/entry responses include `coilRatePerKg`. App and merged web show rates in coil invoice details, production coil details and production entry/history displays. This is the purchase rate; it is not a calculated finished-product cost or tax-inclusive landed cost.

Deploy the database change before the backend and clients. From the backend folder run `npm run unit1:migrate`, or select the existing Unit 1 database in phpMyAdmin and import `database/unit1_add_coil_rate.sql`. Both paths preserve existing stock/history. The clean-install SQL also includes the column for new installations; do not import the clean-install SQL over an existing database.

For Hostinger deployments, confirm `UNIT1_DB_NAME` points to the live Unit 1 database (for example `u436685010_iv1_app`). Import `database/unit1_add_coil_rate.sql` into that selected database, then restart the Node app. Verify with `SHOW COLUMNS FROM coils LIKE 'rate_per_kg';`. Existing coils retain NULL until their rate is recorded. Updated `server.js` also runs the Unit 1 migration before listening, including when hPanel starts the entry file directly instead of running npm start. If migration fails, startup stops and logs the error rather than serving requests against an incomplete schema.

Build the merged web from `E:\IV_APP_PROJECT\IV-WEB` with `npm run build`, and rebuild Unit 1 Android with `android\gradlew.bat assembleRelease` from the Android directory. Older release APKs do not contain the new rate form.

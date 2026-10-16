# Unit 1 accounts

The same Node server serves both units. Unit 2 accounts remain in the database configured by `DB_NAME`. Unit 1 coil, production, and account data live in `UNIT1_DB_NAME` (default `ivs1_production`). Both databases can run on the same XAMPP MySQL server.

After starting XAMPP MySQL, run:

```powershell
npm run unit1:migrate
npm run unit1:user:create -- --email admin@example.com --name "Unit 1 Admin" --role superadmin
```

The second command prompts for a password without echoing it. Further accounts can be provisioned with the same command and one of `superadmin`, `production_manager`, `plant_manager`, `admin`, `supervisor`, or `labour`. A production manager can create job cards and assign them to idle machines; a supervisor scans and inserts coils; labour records production bundles after the first-piece check.

Unit 1 clients sign in through `POST /api/unit1/auth/login`. Unit 2 continues to use `POST /api/auth/login`. Tokens are scoped to their own unit and cannot access the other unit's routes.

## Hostinger deployment

Create a second MySQL database and user for Unit 1 in hPanel. Keep `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, and `DB_NAME` pointing to the existing Unit 2 database. Set `UNIT1_DB_HOST`, `UNIT1_DB_PORT`, `UNIT1_DB_USER`, `UNIT1_DB_PASSWORD`, and `UNIT1_DB_NAME` to the new Unit 1 database credentials in the Node.js app's environment variables. Both units still use one backend deployment.

On a fresh Unit 1 database, `npm run unit1:migrate` creates the Unit 1 tables, including `coils`, `users`, and permission overrides. The backend's `npm start` script runs this migration automatically. A fresh database contains no accounts or production history; create the first Unit 1 superadmin with `npm run unit1:user:create` and migrate any Unit 1 data you want to preserve from the old database before switching production traffic. Back up the current database before moving data.

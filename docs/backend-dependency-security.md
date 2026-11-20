# Backend dependency security update — 28 October 2026

## Result

npm registry audit before remediation: **18 known vulnerabilities (11 high, 7 moderate)**.

After remediation: **0 known vulnerabilities**, both full-tree `npm audit` and production-only `npm audit --omit=dev`. This describes the updated local lockfile; Hostinger's deployed installation and runtime have not been inspected or redeployed.

## Package changes

| Dependency | Installed before | Installed after |
| --- | --- | --- |
| express | 5.2.1 | 5.3.0 |
| body-parser (transitive) | 2.3.0 | 2.4.0 |
| qs (transitive) | 6.16.0 | 6.17.0 |
| express-rate-limit | 8.6.1 | 8.7.1 |
| ip-address (transitive) | 10.7.2 | 10.7.5 |
| multer | 2.4.0 | 2.5.0 |
| firebase-admin | 14.2.0 | 14.5.0 |
| mysql2 | 3.24.4 | 3.24.6 |
| socket.io | 4.8.3 | 4.8.4 |
| nodemon (development) | 1.19.4 | 3.1.14 |

Removed the obsolete nodemon 1.x dependency chain and its unused install-script allowance. Updated the existing protobufjs install-script allowance to the resolved 7.6.6 patch after reviewing its local script. Existing PDF test-only dependency placement and UUID override were preserved. Remaining direct dependencies were audited and retained; no unrelated major upgrades were applied.

Upstream advisories: [Multer upload denial of service](https://github.com/advisories/GHSA-q7qp-rjg7-q26m), [body-parser request denial of service](https://github.com/advisories/GHSA-27r3-jxmh-p828), [ip-address parsing](https://github.com/advisories/GHSA-rxp7-6hxx-x8q5), [qs serialization](https://github.com/advisories/GHSA-6pq8-jhm2-2vcw).

## Verification

- Full and production-only npm audits: zero findings.
- `npm ls`: updated direct and affected transitive dependencies resolve correctly.
- Production installation plan: `npm ci --omit=dev --dry-run --ignore-scripts` succeeds against the updated lockfile.
- Compatibility checks pass for JSON and URL-encoded request parsing, malformed JSON handling, APK extension filtering and upload limits, security/CORS headers, rate limiting and Socket.IO handshakes.
- Firebase Admin imports, MySQL pool API and nodemon version checks pass without contacting databases or sending notifications. Existing authentication and Unit 1 notification regression tests pass.
- Full backend suite: **354 passed, 4 failed, 11 skipped**. Existing failures: schema-drift count fixture, stale clean-install migration manifest, contractor permission mock and product fixture expecting three products instead of four. These predate this package update.

## Hostinger deployment

1. Deploy the updated backend, including **both package.json and package-lock.json**. Keep the existing environment/secrets configuration.
2. Reinstall dependencies from this lockfile in the deployed backend directory with `npm ci --omit=dev`, or use the normal hPanel deployment install step that installs the updated lockfile. Do not upload local Windows node_modules to the Linux host.
3. Restart/redeploy the backend using the normal hPanel workflow and rerun its vulnerability scan.
4. If hPanel still flags packages, compare its reported package versions and deployment directory against this lockfile. A runtime/OS advisory or a different archived deployment requires its own diagnosis; a clean npm audit is not a blanket security guarantee.

No database migration or production data change was required for this dependency update.

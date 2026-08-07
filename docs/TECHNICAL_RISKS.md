# Known technical risks

Ratings reflect operational impact and likelihood as of August 2026.

| Risk | Rating | Why it matters | Current control | Recommended action |
| --- | --- | --- | --- | --- |
| Manual deployments can drift from GitHub | High | PROD may contain code not represented by `main` | Explicit project/scope checks and release records | Require commit-based releases and reconcile every emergency deploy immediately |
| Firestore rules are large and expression-sensitive | High | Rule evaluation limits can deny legitimate saves or a broad rule can expose data | Regression guards and role testing | Maintain emulator-based allow/deny tests for every critical collection |
| Browser performs many direct Firestore writes | High | Security correctness depends heavily on rules and duplicated client validation | Firestore rules, client confirmation, and regression tests | Consider moving high-impact identity, scoring, and season mutations behind reviewed Functions over time |
| Backup failure alerting is not automated | High | A failed daily backup may not be noticed promptly | Native daily backups, PITR, manual exports, status command, and tested restore | Add a keyless scheduled stale-backup check and failure notification |
| No full browser end-to-end test suite | High | Navigation, Auth, caching, and role interactions can regress despite unit tests | Large static regression test and manual DEV/UAT testing | Add Playwright tests against emulators for guest, Captain, EC, and Super Admin workflows |
| Service-worker cache versions are manual | Medium-High | Users can receive mixed old/new modules | Version assertions and build validation | Generate asset hashes/cache manifest during build |
| `index.html` and `app.js` are large | Medium-High | Small changes are difficult to review and increase merge risk | Lazy feature modules | Gradually extract page templates, routing, and shared state without behavior changes |
| Firebase SDK is loaded from CDN at runtime | Medium | CDN/network/version availability affects startup | Fixed SDK version and PWA cache | Evaluate vendoring/bundling SDK assets and add availability monitoring |
| Dormant Cloud Functions source is not production-ready | Medium-High | Accidental deployment could introduce vulnerable or unverified backend behavior | No Functions deployment target; PROD API disabled; unit tests retained | Keep inactive or complete dependency, App Check, configuration, and DEV/UAT review before deployment |
| Hard-coded Super Admin email | High | A personal identifier is embedded in client/rules/Functions and complicates succession | Additional role records | Replace with managed claims/configuration and two-person access review |
| Public projections duplicate private source data | Medium | Refresh failures can create stale or inconsistent guest views | Explicit refresh and restricted fields | Add idempotent server-side publication and freshness monitoring |
| Destructive/admin scripts contain environment assumptions | High | Hard-coded counts or project assumptions can become unsafe/stale | Confirmation flags and project guards | Convert to inventory-first tools with generated manifests and peer approval |
| Legacy modules remain deployable | Medium | Maintainers may edit or load the wrong version; `lineup-management.js` is unused and contains pre-existing invalid syntax | Loader version assertions; active-code lint excludes the identified legacy file | Archive/remove proven-unused modules after dependency analysis and approval |
| Dependency updates are manual | Medium | Security/support fixes may be missed | Lockfiles and monthly review | Enable reviewed Dependabot updates for npm and GitHub Actions |
| Firebase configuration serves repository root | Medium | New top-level files may be hosted unintentionally if ignore rules miss them | Firebase ignore list and static build | Move Hosting public content to a dedicated directory in an approved migration |
| Limited monitoring and alerting | High | Failures may be reported by users before maintainers see them | Manual checks and Firebase logs | Add error reporting, uptime checks, budget/quota alerts, and incident routing |
| Single-owner operational knowledge | High | Absence or device loss can delay recovery | New owner documentation | Train a backup owner and run a witnessed deployment/restore exercise |

## Risk-review rule

Review this list monthly and after every incident. Any accepted High risk must have an owner, next action, and target date in the maintenance record. Risk reduction that changes application behavior requires separate product-owner approval.

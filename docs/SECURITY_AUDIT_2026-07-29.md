# AlphaOpen Production Security Audit

## 1. Executive summary

| Item | Result |
| --- | --- |
| Audit date | July 29, 2026 |
| Environment | Production architecture and repository baseline |
| Baseline commit | `ae83150c7e6b9de35777b3b2033e3043c5674b20` |
| Audit branch | `codex/production-operations-runbook` |
| Overall assessment | **Conditionally acceptable; high-priority privacy rule requires remediation** |
| Critical findings | 0 |
| High findings | 1 |
| Medium findings | 6 |
| Low findings | 2 |

AlphaOpen has several sound controls: DEV and PROD are separated, the Firestore ruleset ends with a default deny, private operations require authenticated roles, public dashboards use sanitized projections, the application prevents a guest from navigating directly to the Admin view, and the repository contains no tracked private exports or service-account credentials.

The most important issue is the rule permitting an unauthenticated read of an entire `players/{playerId}` document when `publicProfileEnabled` is true. The current Player Master schema stores email, phone, T-shirt size, and ranking information in that same document. Firestore Security Rules authorize whole documents, not selected fields. Any production record with that flag enabled can therefore expose the complete record even though the application UI displays only Player ID and Player Name.

Production should remain operational, but Finding `AO-SEC-001` should be verified immediately and corrected through the normal DEV-to-PROD process. The remaining findings should be scheduled before broadening access or automating production deployment.

## 2. Scope

The audit reviewed:

- Firebase project separation and host binding.
- Firebase Hosting configuration and production response headers.
- Google Authentication integration and Operations pre-approval.
- Firestore Security Rules.
- Public versus private data paths.
- Player Master identity and email-transfer controls.
- Guest navigation and public access.
- Service-worker caching behavior.
- Local storage use.
- Repository secrets and private-data artifacts.
- Cloud Functions configuration and dependencies.
- Available automated tests.
- Deployment, rollback, and backup controls.

The audit did not:

- Modify Firebase data, Authentication users, rules, Hosting, or configuration.
- Perform destructive penetration testing.
- Sign in as every production role.
- Inspect Google Cloud IAM assignments.
- Inspect Firebase App Check, API-key restrictions, budgets, or alert settings in the console.
- Prove the exact production value of every `publicProfileEnabled` field.
- Perform a full backup restoration.

## 3. Method

The review used:

1. Static inspection of application code, Firebase configuration, Firestore rules, and data-model documentation.
2. Repository scans for credentials, service-account keys, private exports, and dangerous browser APIs.
3. Production guest smoke testing.
4. A direct guest navigation test to `#admin`.
5. Production HTTP response-header inspection.
6. Firebase CLI Firestore rules compilation through a non-mutating DEV dry run.
7. Repository application tests and Cloud Functions unit/syntax tests.
8. `npm audit` for Cloud Functions production dependencies.
9. Read-only inspection of the latest supplied production export's structure.

## 4. Severity definitions

| Severity | Meaning |
| --- | --- |
| Critical | Active or readily exploitable condition with severe confidentiality, integrity, or availability impact |
| High | Serious exposure or control failure requiring prompt remediation |
| Medium | Material weakness that increases likelihood or impact and should be scheduled |
| Low | Defense-in-depth, maintainability, or operational-hardening issue |
| Informational | Observation or accepted design fact requiring awareness |

## 5. Positive controls verified

### 5.1 Environment separation

- `.firebaserc` defines separate Development and Production projects.
- `firebase-client.js` allows only `alphaopen-development-2026` and `alphaopen-production`.
- The client maps approved Firebase hostnames to the expected project and fails on a mismatch.
- Localhost defaults to a mode in which live data reads and writes are disabled.

### 5.2 Default-deny Firestore posture

- The ruleset ends with `allow read, write: if false` for unmatched paths.
- `playerPrivate`, `playerEmailIndex`, `operationsAccess`, `users`, memberships, lineups, and administrative records have explicit authorization conditions.
- Immutable revision, review, correction, and audit records generally deny update and delete.
- Firestore rules compiled successfully during a DEV dry run.

### 5.3 Restricted Operations sign-in

- Guests do not need accounts.
- Captains, EC members, and Neutral Approvers require an exact pre-approved Player Master email.
- The grant constrains Player ID, roles, season, and team membership.
- Player email changes invoke an access-transfer workflow rather than silently preserving the old login.

### 5.4 Guest boundary

Production guest testing confirmed:

- Only public navigation was visible.
- The active season loaded from the public projection.
- A direct request for `#admin` returned the user to the public Home view.
- Private Operations navigation was not displayed.

UI routing is not a substitute for Firestore rules, but it reduces accidental exposure and behaved as designed.

### 5.5 Hosting and caching

- Production uses HTTPS.
- Production returned `Strict-Transport-Security: max-age=31556926; includeSubDomains; preload`.
- Root HTML is configured as `no-cache`.
- The service worker ignores Firebase reserved `__/` URLs.
- Application code uses network-first refresh behavior before cached fallback.

### 5.6 Repository hygiene

- No tracked database exports, service-account keys, private keys, or `.env` credential files were found.
- The Firebase web API key is present in client configuration. This is normal for a Firebase web application and is not treated as a secret.
- No use of `eval`, `new Function`, or `document.write` was found.

### 5.7 Test results

- `node test-prototype.mjs`: passed.
- Cloud Functions unit tests: 3 passed, 0 failed.
- Cloud Functions JavaScript syntax checks: passed.
- Firestore rules DEV dry run: compiled successfully.

## 6. Findings

### AO-SEC-001 — Player Master document can become guest-readable

**Severity: High**

**Evidence**

`firestore.rules` permits an unauthenticated read of `players/{playerId}` when:

```text
resource.data.status == 'active'
&& resource.data.publicProfileEnabled == true
```

The same canonical Player Master document includes:

- `emailNormalized`
- `phone`
- `tShirtSize`
- `globalRank`
- Other private or administrative fields

`player-admin.js` creates and updates these private values directly in `players/{playerId}`. Firestore cannot reveal only selected fields from a readable document.

**Risk**

If any production Player Master record has `publicProfileEnabled: true`, a guest can potentially read all fields in that document, not just Player ID and Player Name.

**Production-state limitation**

The latest supplied export inspected during this audit contained no Player Master records and could not prove the current flags. The code-level exposure remains regardless of current values.

**Required action**

1. Inspect Production for any `players` record with `publicProfileEnabled == true`.
2. Remove the guest-read clause from `players/{playerId}`.
3. Keep guests on the sanitized `publicConfig/playerMaster` projection.
4. Add Security Rules tests proving guests cannot read any `players` document.
5. Test DEV as guest, approved Operations user, and Super Admin.
6. Deploy the rule change to Production only after approval.

**Target**

Verify production immediately. Remediate within 7 days.

### AO-SEC-002 — No executable Firestore Security Rules authorization suite

**Severity: Medium**

**Evidence**

- The ruleset is 882 lines and contains many role, workflow, and cross-document conditions.
- `test-prototype.mjs` checks that expected rule strings exist, but it does not execute allow/deny requests against the rules.
- No `@firebase/rules-unit-testing` test suite was found.

**Risk**

A syntactically valid change can accidentally expose private data or block an authorized workflow. Compilation does not prove authorization behavior.

**Required action**

Create an Emulator Suite rules matrix covering:

- Guest
- Unapproved authenticated user
- Captain for own team
- Captain for another team
- Neutral Approver
- EC
- Super Admin

At minimum, test Player Master, Operations access, users, memberships, teams, rosters, matchups, lineups, line matches, public projections, audit records, and season reset.

**Target**

Before the next material rules change.

### AO-SEC-003 — Guests read complete operational Line Match documents

**Severity: Medium**

**Evidence**

`lineMatches/{lineMatchId}` is guest-readable when `scheduleStatus` is:

- `toBeScheduled`
- `scheduled`
- `completed`

The operational Line Match schema includes player snapshots, rank information, Firebase UIDs, submitter and confirmer identities, workflow state, correction metadata, and other fields beyond the public display.

**Risk**

The UI renders only intended fields, but guests receive the entire Firestore document. Internal identifiers and workflow metadata are unnecessarily public and can grow over time without an accompanying rules change.

**Current disposition**

This is a previously accepted temporary design while schedules, venues, dates, and scores are updated frequently.

**Required action**

1. Define a sanitized public Line Match schema.
2. Publish public Line Matches with the season dashboard.
3. Move guest queries to that projection.
4. Remove guest reads from operational `lineMatches`.
5. Add field-level publication tests.

**Target**

Before significantly expanding public traffic or adding sensitive operational fields.

### AO-SEC-004 — Temporary email-based Super Admin bootstrap remains active

**Severity: Medium**

**Evidence**

The Super Admin email is hardcoded in:

- Firestore rules
- Client authentication code
- Cloud Functions code

The rules comment identifies this as a temporary bootstrap path to be replaced by a custom claim.

**Risk**

The protected Google account becomes a concentrated privilege boundary. Email-based bootstrap logic is duplicated across components and is harder to revoke, rotate, and audit than a controlled role-claim process.

**Required action**

1. Maintain at least two named emergency administrators with separate accounts.
2. Protect privileged Google accounts with phishing-resistant MFA.
3. Implement a trusted custom-claim provisioning and revocation process.
4. Verify the stored Super Admin user and Player Master link.
5. Remove the hardcoded email bypass from rules, client, and backend after successful claim migration.

**Target**

Before adding another Super Admin or delegating administration.

### AO-SEC-005 — Missing browser security headers

**Severity: Medium**

**Evidence**

Production returned HSTS, but did not return:

- `Content-Security-Policy`
- `X-Content-Type-Options`
- `Referrer-Policy`
- `Permissions-Policy`
- `Cross-Origin-Opener-Policy`

The application renders substantial dynamic HTML and imports Firebase modules from Google's CDN.

**Risk**

The browser has fewer defense-in-depth restrictions against injected scripts, content-type confusion, unnecessary browser capabilities, and referrer leakage.

**Required action**

1. Inventory inline scripts, inline styles, Firebase endpoints, image sources, and frame requirements.
2. Introduce a report-only Content Security Policy in DEV.
3. Review violations and remove unsafe dependencies where practical.
4. Add at least:
   - `X-Content-Type-Options: nosniff`
   - `Referrer-Policy: strict-origin-when-cross-origin`
   - A restrictive `Permissions-Policy`
5. Promote an enforced CSP after DEV testing.

Do not add a guessed CSP directly to Production; an incorrect policy can break sign-in or application modules.

**Target**

Within 30 days.

### AO-SEC-006 — Manual deployment has no independent CI security gate

**Severity: Medium**

**Evidence**

- No `.github/workflows` configuration exists.
- DEV and PROD deployments are manually initiated from a local checkout.
- The workflow relies on the operator to select the correct branch, commit, Firebase project, and deployment scope.

**Risk**

Production can drift from GitHub `main`, rules can be deployed without tests, and an operator can target the wrong Firebase project.

**Required action**

1. Add GitHub checks for:
   - Repository tests
   - Cloud Functions tests and syntax checks
   - Firestore Rules tests
   - Secret scanning
   - Dependency audit
2. Automate DEV deployment after checks pass.
3. Keep Production behind explicit manual approval.
4. Record the exact Git commit in every release.

**Target**

After the Security Rules test suite and before frequent production changes.

### AO-SEC-007 — Cloud Functions deployment status and dependencies are not production-ready

**Severity: Medium**

**Evidence**

- Trusted callable Cloud Functions exist under `functions/`.
- `firebase.json` has no `functions` deployment section.
- Current standard deployment commands therefore do not include these functions.
- The functions set `enforceAppCheck: false`.
- `npm audit --omit=dev` reported 12 transitive vulnerabilities: 5 high and 7 moderate.

**Risk**

It is unclear whether the trusted workflow code is intentionally inactive, separately deployed, or stale. Deploying it without configuration review would introduce vulnerable dependencies and no App Check enforcement.

**Required action**

1. Decide whether Cloud Functions are part of the approved production architecture.
2. If inactive, document and remove or archive obsolete code.
3. If required:
   - Update dependencies safely.
   - Resolve audit findings without accepting an unreviewed breaking downgrade.
   - Add the correct Firebase Functions configuration.
   - Add emulator/integration tests.
   - Enable and validate App Check where appropriate.
   - Deploy and monitor through a controlled release.

**Target**

Resolve before any Functions deployment.

### AO-SEC-008 — Backup is export-based but full restoration is unproven

**Severity: Low**

**Evidence**

- The application exports Firestore documents to an Excel workbook.
- The workbook does not export Firebase Authentication accounts.
- No tested, automated full restore procedure was found.
- Backup location, encryption, retention, recovery time, and recovery point remain owner decisions.

**Risk**

The organization can possess backup files without being able to restore service within an acceptable period.

**Required action**

Complete the backup decisions in the Production Operations Runbook and perform a non-production restore test.

**Target**

Before the active season begins regular match operations.

### AO-SEC-009 — App Check and API-key restriction posture requires console verification

**Severity: Low**

**Evidence**

- The web API key is correctly treated as client configuration rather than a secret.
- No client App Check integration was found.
- Firebase Console API restrictions and quotas were not in repository scope.

**Risk**

Without defense-in-depth controls, automated clients can more easily consume public reads or attempt denied operations, potentially increasing abuse and cost.

**Required action**

1. Review the Production web API key restrictions.
2. Confirm only required Google APIs are enabled.
3. Evaluate Firebase App Check for Firestore and callable functions.
4. Configure billing or quota alerts appropriate to the plan.
5. Monitor denied requests and abnormal read volume.

**Target**

Within 30 days.

## 7. Prioritized remediation plan

### Immediate

1. Verify whether any Production `players` record has `publicProfileEnabled: true`.
2. Create a dedicated fix branch for `AO-SEC-001`.
3. Remove guest access to canonical Player Master documents.
4. Validate guests still receive the sanitized Player Name/Player ID directory.

### Next

1. Build executable Firestore Security Rules tests.
2. Add basic GitHub CI checks without automating Production deployment.
3. Decide the disposition of Cloud Functions.
4. Update or isolate vulnerable Functions dependencies.

### Within 30 days

1. Add browser security headers after DEV compatibility testing.
2. Review App Check, API restrictions, quotas, and alerts.
3. Define and test backup restoration.
4. Plan replacement of the email-based Super Admin bootstrap.

### Planned architectural improvement

Publish sanitized public Line Match documents and remove guest reads from operational Match Line records.

## 8. Acceptance criteria

The audit can be considered remediated when:

- No guest can read any canonical Player Master document.
- Guests can still load the public Player Directory.
- Rules tests prove the public/private matrix for all roles.
- The production ruleset is traceable to an approved Git commit.
- Cloud Functions are either intentionally removed or securely configured and tested.
- High and moderate dependency findings are resolved before Functions deployment.
- Security headers are tested and deployed.
- Super Admin bootstrap replacement has an approved plan.
- A backup restoration is successfully tested outside Production.

## 9. References

- Firebase, **Writing conditions for Cloud Firestore Security Rules**:  
  `https://firebase.google.com/docs/firestore/security/rules-conditions`
- Firebase, **Control access to specific fields**:  
  `https://firebase.google.com/docs/firestore/security/rules-fields`
- Firebase, **Build unit tests for Firebase Security Rules**:  
  `https://firebase.google.com/docs/rules/unit-tests`
- Firebase, **Test Cloud Firestore Security Rules**:  
  `https://firebase.google.com/docs/firestore/security/test-rules-emulator`
- Firebase, **Authenticate Using Google with JavaScript**:  
  `https://firebase.google.com/docs/auth/web/google-signin`
- Firebase, **Manage cache behavior**:  
  `https://firebase.google.com/docs/hosting/manage-cache`
- Firebase, **Local Emulator Suite**:  
  `https://firebase.google.com/docs/emulator-suite`

## 10. Audit decision log

| Date | Decision | Status |
| --- | --- | --- |
| 2026-07-29 | Continue Production operation while promptly validating and correcting `AO-SEC-001` | Open |
| 2026-07-29 | Retain direct public operational Line Match reads temporarily; replace with sanitized projection later | Accepted temporary risk |
| 2026-07-29 | Keep Production deployment manual until CI security gates are established | Accepted temporary control |


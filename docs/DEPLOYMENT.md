# Development and production deployment

## Release policy

CI validates but never deploys. Releases are manual, scoped, and use an explicit Firebase project ID. Normal promotion order is DEV → UAT → PROD. The exact tested source must be committed to GitHub before or immediately after an emergency deployment so `main` remains the production source of truth.

## Environment targets

| Stage | Project ID |
| --- | --- |
| DEV | `alphaopen-development-2026` |
| UAT | `alphaopen-test-system` |
| PROD | `alphaopen-production` |

## Before any deployment

1. Identify the change, approver, branch, and commit.
2. Confirm `git status --short` contains no unrelated release files.
3. Run `npm ci`, `npm ci --prefix functions`, and `npm run check`.
4. Identify scope: Hosting, rules/indexes, or a coordinated release. Cloud Functions are not part of the current deployed baseline.
5. For data-writing/rules changes, complete a verified backup.
6. Record the current Hosting release and last known-good Git commit.

## Deployment commands

Hosting only:

```powershell
firebase.cmd deploy --only hosting --project <PROJECT_ID>
```

Rules and indexes only:

```powershell
firebase.cmd deploy --only firestore:rules,firestore:indexes --project <PROJECT_ID>
```

Functions are not currently deployed in DEV or PROD, and `firebase.json` has no Functions deployment target. Do not use the following command unless a separate approved change first makes Functions production-ready, adds the required Firebase configuration, passes dependency/security review, and completes DEV/UAT callable testing:

```powershell
firebase.cmd deploy --only functions --project <PROJECT_ID>
```

Deploy only the scopes required by the change. Avoid an unscoped `firebase deploy`.

## DEV procedure

1. Deploy the required scope to `alphaopen-development-2026`.
2. Test as guest and every affected role.
3. Include at least one unauthorized-user negative test for permission changes.
4. Record results and defects against the commit.

## UAT procedure

1. Confirm DEV acceptance.
2. Deploy the same source and scope to `alphaopen-test-system`.
3. Have the product owner perform the actual workflow.
4. Record explicit acceptance and any required browser-cache refresh.

## PROD procedure

1. Confirm UAT acceptance and PROD approval.
2. Confirm GitHub `main` identifies the approved source.
3. Confirm the current backup and rollback point.
4. Deploy to `alphaopen-production` with the smallest scope.
5. Record time, command, commit, Firebase release, and operator.
6. Run the smoke test immediately.

## PROD smoke test

- Guest: Home, Active Season, Matches, Previous Seasons, Player History, schedule/rules/AO resources.
- Authentication: approved operator can sign in; a guest cannot see private controls.
- Role: affected Captain/EC/Approver/Super Admin page loads correctly.
- Data: read-only verification of current season, teams, schedule, and standings.
- Changed workflow: perform only a safe representative action and verify the result.
- Browser: check a private window and the browser console.

## Cache-version rule

When a loaded JavaScript module changes:

1. Increment its query-string version wherever referenced.
2. Update `runtime-loader.js` if it loads that module.
3. Increment the `runtime-loader.js` version in `index.html` when the loader changes.
4. Update matching paths in `service-worker.js`.
5. Increment `CACHE_NAME`.
6. Run `npm run check`.

## GitHub Actions

The `Quality checks` workflow runs lint, tests, and build for pushes and pull requests. A green check is required but does not replace DEV/UAT acceptance. The workflow intentionally has read-only permissions and no Firebase credentials.

## Release record template

```text
Change:
Commit:
Scope:
DEV result/time:
UAT approver/result/time:
Backup reference:
Previous PROD release:
PROD operator/time:
Smoke-test result:
Rollback needed: no/yes
```

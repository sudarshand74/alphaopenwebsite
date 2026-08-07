# Rollback instructions

## First response

1. Stop new deployments and data corrections.
2. Record the time, symptoms, affected roles, failing commit, and Firebase release.
3. Decide whether the incident affects Hosting, rules, Functions, data, or more than one layer.
4. Preserve browser console errors and screenshots.

## Hosting rollback

For an urgent outage, use Firebase Console → Hosting → Release history to roll back to the last verified release. Then verify guest and operator access.

Reconcile Git afterward:

```powershell
git switch -c codex/revert-<change> origin/main
git revert <bad-commit>
npm run check
```

Test the revert in DEV/UAT, merge it to `main`, and deploy the reconciled source. Do not rewrite Git history.

## Firestore rules rollback

1. Identify the last known-good rules commit.
2. Revert only the rules change on a branch.
3. Run rule/emulator tests, including guest denial and authorized role access.
4. Deploy only `firestore:rules,firestore:indexes` to DEV/UAT, then PROD with approval.
5. Confirm private data is still denied to guests.

Never use temporary test-mode rules in any shared environment.

## Conditional Functions rollback

Cloud Functions are not part of the current deployed baseline. This procedure applies only after a future explicitly approved Functions deployment:

1. Confirm the incident actually involves a deployed Function and record its release/version.
2. Revert the bad Functions commit.
3. Run `npm --prefix functions test` and `npm --prefix functions run check`.
4. Deploy `--only functions` through DEV/UAT and then PROD.
5. Verify callable workflows and check Cloud Functions logs.

## Data rollback or restoration

Data restoration is not the first choice for a single bad record. Prefer the narrowest audited application correction. For broad loss/corruption:

1. Disable the affected write workflow.
2. Identify the recovery point and export metadata.
3. Restore into a non-production project first.
4. Compare document counts and critical IDs.
5. Obtain explicit restoration approval.
6. Import to PROD and verify before re-enabling writes.

Firestore imports merge/overwrite matching documents; they do not automatically remove extra documents. Plan cleanup separately.

## Rollback verification

- Correct Firebase project and release are active.
- Guest public pages work without private data exposure.
- Affected role can complete the safe part of its workflow.
- Existing season data and identifiers are intact.
- GitHub `main` matches the intended production state.
- Incident and follow-up action are recorded.

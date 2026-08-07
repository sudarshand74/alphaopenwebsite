# Troubleshooting

## Start with these facts

Record the environment URL, signed-in role/email, Season ID, Team ID, Matchup/Line Match ID, exact error, time, browser, and whether the problem also occurs in a private window. Do not edit Firestore directly while diagnosing.

## “Missing or insufficient permissions”

Likely causes: wrong Operations access, inactive season membership, wrong team assignment, stale sign-in token, Firestore rules not deployed, or an attempted field outside the permitted set.

1. Confirm DEV/UAT/PROD URL.
2. Confirm the user’s Player ID, active status, global role, season role, and team IDs.
3. Sign out/in and retry in a private window.
4. Compare deployed rules with Git source.
5. Test the same action with an authorized and unauthorized account.

Do not fix this by widening all writes.

## Schedule or score saves privately but public refresh fails

The private Match Line write and public dashboard refresh have separate permissions. Confirm the user is an authorized Captain/EC, public projection delete/create/update rules are current, and the selected match is still open. Use the Admin public-dashboard refresh only after confirming the private save.

## Player email says it is already in use

- Active Operations access for another Player ID must block reuse.
- Revoked access may be reused and should retain `revokedAssignmentHistory`.
- Confirm the conflicting access record’s status before changing anything.
- Run Identity Reconciliation for ambiguous links.

## New release looks old

1. Confirm the live `index.html` version reference.
2. Hard refresh and test a private window.
3. Close all tabs for the site.
4. Clear site data only for the affected hostname.
5. Confirm `service-worker.js` has the expected `CACHE_NAME` and module versions.

## Wrong Firebase project warning

Stop immediately. Verify the hostname, `.firebaserc`, command `--project`, and Firebase Hosting automatic `/__/firebase/init.json` result. Never bypass `firebase-client.js` project validation.

## Sign-in succeeds but Operations pages are unavailable

Confirm approved Operations access, verified email, Player Master email, registered user status, current season membership, and team/approver assignment. A Player Master record alone does not grant Operations access.

## Public dashboard is stale

Confirm the private source data first. Then refresh the correct Season ID from Admin → Setup Season. Verify the public document status and guest page in a private window.

## CI fails

- Lint: run `npm run lint`; fix the first syntax/JSON error.
- Test: run `npm test`; do not update assertions merely to silence a real regression.
- Build: run `npm run build`; a missing referenced asset or incorrect cache path is common.
- Functions install: use Node 22 and run `npm ci --prefix functions`.

## Firebase CLI fails

Run `firebase.cmd login`, `firebase.cmd projects:list`, and `firebase.cmd --version`. On Windows use `firebase.cmd` when PowerShell blocks `firebase.ps1`. Re-run with an explicit project and narrow `--only` scope.

## Escalation thresholds

Immediately stop and escalate for private data visible to guests, unauthorized writes, widespread data loss, all-operator sign-in failure, or score/lineup corruption. Preserve evidence and use the rollback guide.

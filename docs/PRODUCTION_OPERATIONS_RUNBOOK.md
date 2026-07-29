# AlphaOpen Production Operations Runbook

## 1. Document control

| Item | Value |
| --- | --- |
| System | AlphaOpen Tennis League |
| Document owner | AlphaOpen Super Admin |
| Source repository | `https://github.com/sudarshand74/alphaopenwebsite` |
| Production baseline | Git commit `ae83150c7e6b9de35777b3b2033e3043c5674b20` |
| Production baseline tag | `production-baseline-2026-07-29` |
| Last verified | July 29, 2026 |
| Review frequency | Before each season and after any material operational or security change |

This runbook describes how to operate, change, deploy, verify, back up, and recover the AlphaOpen application. It is the operational companion to:

- `ALPHAOPEN_APP_SPEC.md`
- `FIRESTORE_DATA_MODEL.md`
- `AlphaOpen_Architecture_Review_Board_Detailed_Design.docx`
- The policies in `legal/`

Update this runbook in the same Git branch whenever an application change modifies an operational procedure.

## 2. Environment inventory

| Environment | Firebase project | Primary purpose | Source policy |
| --- | --- | --- | --- |
| Local | Local web server or Firebase Emulator Suite | Visual checks and isolated development | A temporary `codex/*` feature branch |
| Development | `alphaopen-development-2026` | End-to-end testing with development data | An approved feature-branch commit |
| Production | `alphaopen-production` | Live AlphaOpen operations and public dashboards | The approved commit on `main` |

Firebase aliases in `.firebaserc`:

- `default` and `dev`: `alphaopen-development-2026`
- `prod`: `alphaopen-production`

Primary hosted URLs:

- Development: `https://alphaopen-development-2026.web.app`
- Production: `https://alphaopen-production.web.app`

The Firebase project must always be specified explicitly in deployment commands. Do not rely only on the current Firebase CLI alias.

## 3. System overview

AlphaOpen is a static HTML, CSS, and JavaScript application hosted by Firebase Hosting. It uses:

- Cloud Firestore for public and private application records.
- Google Authentication for approved Operations users.
- Firestore Security Rules as the principal data-access control.
- A service worker for application asset caching.
- Public projections for guest dashboards and the global Player Name/Player ID list.

Guests do not sign in. Captains, EC members, Neutral Approvers, and Super Admins use the restricted Operations sign-in flow. An ordinary Player Master record does not grant sign-in access.

There is currently no GitHub-to-Firebase deployment automation. GitHub records the approved source; Firebase CLI deployments are initiated manually from the local repository.

## 4. Roles and access model

| Role | Typical access |
| --- | --- |
| Guest | Public Home, Active Season, Matches, About AO, completed seasons, and Player History |
| Captain | Guest access plus assigned-team lineup, scheduling, and score workflows |
| Neutral Approver | Guest access plus assigned lineup review and approval |
| EC | Guest access plus roster, lineup, schedule, score, venue, and other authorized operational tools |
| Super Admin | All application administration, access provisioning, season setup, data-quality, and correction tools |

### 4.1 Approving Operations access

1. Verify that the person has a current Player Master record.
2. Verify the exact Google email stored in Player Master.
3. Open **Admin → User Management**.
4. In **Approved Captains, ECs & Approvers**, choose **Approve access**.
5. Select the Player Master record and assign only the required Operations role.
6. For a Captain, verify the season and Team ID.
7. Save the approval.
8. Ask the person to use the restricted Operations sign-in page with that exact Google email.
9. After first sign-in, confirm the person appears under **Registered users** with the correct Player ID, name, role, season, and team.

Do not create access for guests or regular players.

### 4.2 Revoking Operations access

1. Open **Admin → User Management**.
2. Locate the approved access record.
3. Confirm the person, Player ID, email, role, season, and team.
4. Choose **Revoke**.
5. Verify the record shows `REVOKED`.
6. Confirm the user can no longer open private Operations screens.

### 4.3 Player email changes

Changing a Player Master email is an identity and access event, not a simple contact update.

1. Confirm the Player ID and new email with the player.
2. Export or record the existing access state before making the change.
3. Edit the email in **Admin → Player Master**.
4. Confirm that old-email access is revoked or suspended by the protected transfer workflow.
5. Open **Admin → User Management**.
6. Locate the old approval and select the option to provision the new Player Master email.
7. Verify the approval displays the new email.
8. Have the user sign in with the new Google email.
9. Confirm the new registered account, roles, season, and team.
10. Confirm the old email cannot access Operations screens.

If the new email does not appear, do not manually edit Firestore documents. Refresh Player Master and User Management, then run **Admin → Identity Reconciliation** and investigate the reported mismatch.

## 5. Routine operating procedures

### 5.1 Daily or match-day check

1. Open Production as a guest.
2. Confirm the active season name and ID.
3. Check **Active Season** standings, teams, week dates, and matchups.
4. Check **Matches** for today's, upcoming, and completed matches.
5. Sign in as an authorized operator.
6. Review pending lineup submissions, approvals, schedule actions, and scores.
7. Investigate visible errors before changing production data.

### 5.2 Refreshing the public Player Directory

Use this after Player Master names are added or corrected.

1. Open **Admin → Player Master**.
2. Verify the private Player Master records are correct.
3. Select **Refresh Player List**.
4. Confirm the reported player count.
5. Sign out or use a private browser window.
6. Verify Player History and player dropdowns show `Player Name (Player ID)`.

Only Player ID and Player Name belong in the public Player Directory.

### 5.3 Refreshing a public season dashboard

Use this after an active or completed season's teams, dates, standings, matchups, or published results change.

1. Open **Admin → Setup Season**.
2. Locate the intended season by Season ID and name.
3. Select its public-dashboard refresh action.
4. Wait for the success message and verify record counts.
5. Open the corresponding public dashboard as a guest.
6. Check standings, teams, captains, ranks, week dates, matches, and results.

Never refresh a different season merely because its name looks similar. Confirm the permanent Season ID first.

### 5.4 Browser cache check

If a newly deployed screen appears unchanged:

1. Confirm the expected Git commit was deployed.
2. Perform a hard refresh.
3. Close and reopen the browser tab.
4. Test in a private browser window.
5. If necessary, clear site data for the specific AlphaOpen DEV or PROD hostname.

Do not clear unrelated browser data.

## 6. Season lifecycle

### 6.1 Before creating or replacing a season

1. Export the current database workbook.
2. Store the export in the approved backup location.
3. Verify Player Master, Venue Master, teams, captains, roster ranks, weeks, and matchups.
4. Confirm whether the target Season ID is new or an existing draft.
5. Ensure no active or completed season will be replaced unintentionally.

### 6.2 Draft season upload

1. Use the controlled workbook downloaded from the current application.
2. Validate all workbook sheets before upload.
3. Open **Admin → Setup Season → Bulk upload season**.
4. Choose the workbook.
5. Review the validation summary for teams, players, weeks, and matchups.
6. Confirm the permanent Season ID.
7. Replace only the intended draft season.
8. Inspect **Season Teams**, **Matchup Schedule**, and **Manage Team Roster**.
9. Correct source data rather than adding code that derives missing operational data.

### 6.3 Activating a season

Before setting a season to `active`, verify:

- The permanent Season ID, name, dates, timezone, and status.
- All teams and Captain Player IDs.
- Every roster rank and Player Name/Player ID.
- Week lineup-submission, week-start, and play-by dates.
- Every matchup's teams, date, deadline, venue, and status.
- Approved Captain and EC access.
- Public dashboard content after refresh.

Only one season should be the current active season.

### 6.4 Completing a season

1. Confirm all official scores and standings.
2. Resolve data-quality and identity-reconciliation issues.
3. Export the database workbook and retain it as the season-closing backup.
4. Change the season status to `completed`.
5. Refresh that season's public dashboard.
6. Verify it appears under Previous Seasons and Player History.
7. Verify the active-season dashboard no longer treats it as current.

### 6.5 Resetting season data

**Reset data is destructive.**

Before proceeding:

1. Confirm the exact Season ID.
2. Export and archive a backup.
3. Confirm the season is a draft or that reset is otherwise explicitly authorized.
4. Confirm no official scores or history must be retained outside the reset behavior.
5. Capture the reason and approving person in the operations log.
6. Follow the application's typed confirmation exactly.
7. Verify retained global records and removed season descendants afterward.

Do not reset a production season to correct an individual player, matchup, lineup, or score.

## 7. Source-control and change process

### 7.1 Rules

- `main` represents approved production source.
- Every change starts on a dedicated `codex/*` branch created from the latest `main`.
- Do not edit Firebase-hosted files directly.
- Do not make routine source edits in the GitHub website.
- DEV testing does not authorize PROD deployment.
- Production requires explicit approval.
- The commit tested in DEV must be identifiable before it is promoted.

### 7.2 Start a change

```powershell
cd "C:\Users\desai\OneDrive\Documents\New project"
git switch main
git pull --ff-only origin main
git status --short --branch
git switch -c codex/<short-change-name>
```

Stop if `main` has unexpected modified files. Known temporary migration folders must not be staged accidentally.

### 7.3 Local visual test

```powershell
python -m http.server 4173 --bind 127.0.0.1
```

Open `http://127.0.0.1:4173`.

Normal localhost mode disables live data reads and writes. It is suitable for labels, layout, navigation, dialogs, and other data-independent behavior.

Run automated repository checks:

```powershell
node test-prototype.mjs
```

Authentication, security-rule, data, role, lineup, score, and season workflows require Firebase emulators with controlled data or deployment to DEV.

### 7.4 Commit and push a feature branch

Review the exact files first:

```powershell
git status --short
git diff --check
git diff
```

Then stage only the intended files:

```powershell
git add <specific-files>
git commit -m "<concise change description>"
git push -u origin codex/<short-change-name>
```

Record the commit:

```powershell
git rev-parse HEAD
```

## 8. Deployment

Run deployment commands from the repository root. On this Windows configuration, use `firebase.cmd` if PowerShell blocks `firebase.ps1`.

### 8.1 DEV pre-deployment checklist

- Correct feature branch is checked out.
- Working tree has no unintended changes.
- `node test-prototype.mjs` passes.
- Expected Firebase project is `alphaopen-development-2026`.
- Deployment scope matches the change.
- The branch and commit have been pushed to GitHub.

For a hosting-only change:

```powershell
firebase.cmd deploy --only hosting --project alphaopen-development-2026
```

For Firestore rules or indexes:

```powershell
firebase.cmd deploy --only firestore:rules,firestore:indexes --project alphaopen-development-2026
```

For a coordinated hosting and Firestore release:

```powershell
firebase.cmd deploy --only hosting,firestore:rules,firestore:indexes --project alphaopen-development-2026
```

After deployment, record the Git commit and test DEV using the relevant role and a guest browser session.

### 8.2 DEV acceptance

The tester should provide explicit approval similar to:

> I tested commit `<commit>` in DEV and approve this change for production.

Record:

- Branch
- Commit
- DEV deployment time
- Screens and roles tested
- Test result
- Approver

### 8.3 Merge to `main`

After approval:

```powershell
git switch main
git pull --ff-only origin main
git merge --no-ff codex/<short-change-name>
git push origin main
```

Run tests again and record the resulting `main` commit:

```powershell
node test-prototype.mjs
git rev-parse HEAD
```

### 8.4 PROD pre-deployment checklist

- Explicit production approval exists.
- Current branch is `main`.
- Local `main` matches `origin/main`.
- Working tree contains no unintended changes.
- Automated checks pass.
- The approved change is present in the current commit.
- The exact Firebase project is `alphaopen-production`.
- A current data backup exists for any release affecting data or rules.
- A rollback commit or prior Firebase Hosting release is identified.

Hosting-only production deployment:

```powershell
firebase.cmd deploy --only hosting --project alphaopen-production
```

Rules or index deployment:

```powershell
firebase.cmd deploy --only firestore:rules,firestore:indexes --project alphaopen-production
```

Coordinated production deployment:

```powershell
firebase.cmd deploy --only hosting,firestore:rules,firestore:indexes --project alphaopen-production
```

### 8.5 PROD smoke test

Immediately after deployment:

1. Record the deployed Git commit and deployment time.
2. Open Production in a private browser window as a guest.
3. Verify Home, Active Season, Matches, About AO, Previous Seasons, and Player History.
4. Verify no private navigation or data appears to a guest.
5. Sign in as an approved Operations user.
6. Verify the correct name, Player ID, role, season, and team.
7. Test only the non-destructive portion of the changed workflow.
8. Review the browser console for new application errors.
9. Confirm existing critical workflows remain accessible.

Tag important production releases:

```powershell
git tag -a production-YYYY-MM-DD-<description> -m "Production release: <description>"
git push origin production-YYYY-MM-DD-<description>
```

Delete a completed feature branch only after successful production verification.

## 9. Rollback and recovery

### 9.1 Hosting rollback

If a deployment causes a serious public or operational failure:

1. Stop further production changes.
2. Record the failing commit, time, affected screens, and symptoms.
3. Use Firebase Hosting release history to roll back to the last known-good Hosting release if immediate recovery is required.
4. Verify guest and Operations access.
5. Create a Git rollback branch from current `main`.
6. Revert the faulty commit in Git rather than rewriting history.
7. Test the revert in DEV.
8. Merge the approved revert to `main`.
9. Deploy the reconciled `main` to PROD.

A Firebase console rollback is emergency recovery; Git `main` must subsequently be reconciled with the code actually intended for Production.

### 9.2 Firestore rules rollback

Rules changes can expose or block data. Treat them as security changes.

1. Identify the last known-good rules commit.
2. Revert the faulty rules change in a Git branch.
3. Test rules against DEV or the emulator.
4. Obtain approval.
5. Deploy only Firestore rules and indexes to PROD.
6. Verify guest denial of private data and authorized Operations access.

Never replace production rules with test-mode rules.

### 9.3 Data correction

Do not restore an entire database to correct one record.

Use the narrowest approved application workflow:

- Player Master edit and email-transfer workflow
- Team or Captain edit
- Ranked-player replacement
- Matchup schedule edit
- Correct Lineup & Score
- Identity Reconciliation
- Public-dashboard refresh

Before bulk correction, export the database and document the affected collections and permanent IDs.

## 10. Backup procedure

### 10.1 Application data export

Create an application database export:

1. Sign in as Super Admin.
2. Open **Admin → Setup Season**.
3. Select **Export database to Excel**.
4. Wait for the export to complete.
5. Confirm the workbook opens and contains the expected manifest, document paths, Player Master, Venue Master, seasons, teams, rosters, weeks, matchups, standings, line matches, public configuration, and AO content.
6. Store the workbook in the approved backup location using a timestamped, environment-specific name.

Recommended filename:

`AlphaOpen-PROD-Full-Export-YYYY-MM-DDTHH-mm-ssZ.xlsx`

An application workbook export does not export Google/Firebase Authentication accounts or guarantee a one-click full Firestore restoration. Treat Authentication identity, Firestore data, Hosting releases, and Git source as separate recovery assets.

### 10.2 Minimum backup schedule

- Before every season bulk upload, replacement, activation, completion, or reset.
- Before material Player ID or identity migration.
- Before a production release that changes Firestore rules or data-writing behavior.
- After season completion.
- At least weekly during an active season.

### 10.3 Backup verification

A backup is not verified merely because a file downloaded.

Check:

- File opens without repair warnings.
- Export timestamp and environment are recorded.
- Expected sheets and document counts are present.
- Permanent document paths and IDs are included.
- Private records are stored only in the restricted backup location.
- A second authorized person or restoration test confirms usability periodically.

### 10.4 Decisions still required

The owner must define:

- Approved primary and secondary backup locations.
- Encryption and access restrictions.
- Retention period.
- Recovery-time objective.
- Recovery-point objective.
- Restore-test frequency.
- People authorized to restore production data.

Record those decisions in this runbook; do not store credentials or recovery secrets here.

## 11. Incident response

### 11.1 Severity

| Severity | Examples | Initial action |
| --- | --- | --- |
| Critical | Private data visible to guests; unauthorized write access; widespread data loss | Restrict access or roll back immediately; preserve evidence |
| High | Sign-in unavailable to all operators; scoring or lineup workflow corrupts data | Stop affected workflow; use last known-good release |
| Medium | One role or screen fails; public projection is stale | Document, reproduce in DEV, and correct through normal release |
| Low | Cosmetic text or layout problem | Schedule a normal change |

### 11.2 Incident record

Capture:

- Date and time
- Reporter
- Environment
- User role
- URL and screen
- Expected and actual behavior
- Screenshot and exact error
- Affected Player, Team, Season, Matchup, or Line IDs
- Git commit and Firebase release
- Data changes already attempted
- Containment and recovery actions

Do not include passwords, authentication tokens, private phone numbers, or unnecessary personal data in GitHub issues or screenshots.

### 11.3 Common conditions

**Public dashboard is stale**

1. Verify operational records are correct.
2. Refresh the intended season's public dashboard.
3. Test as a guest.

**Player dropdown shows only an ID**

1. Verify Player Master has a proper full name.
2. Refresh the public Player List.
3. Refresh the applicable public season dashboard if it stores a snapshot.
4. Run Identity Reconciliation for operational snapshot mismatches.

**Approved user cannot sign in**

1. Confirm exact Player Master Google email.
2. Confirm active approved Operations access.
3. Confirm role, season, and team.
4. Check whether an email transfer revoked the previous grant.
5. Check Registered Users and Identity Reconciliation.

**Unapproved person attempts sign-in**

The application must deny Operations access. Do not approve the person merely to eliminate the message.

**Deployment appears unchanged**

Verify the deployed commit, hard refresh, test privately, and check service-worker caching before redeploying.

## 12. Security operating rules

- Never enable Firestore test mode in DEV or PROD.
- Never copy production private data to a public repository.
- Never commit credentials, service-account keys, exports, or private Player Master data.
- Do not edit production Firestore records directly unless a documented emergency procedure explicitly requires it.
- Use least-privilege role assignments.
- Review approved Operations access at the start and end of each season.
- Revoke access promptly after role changes.
- Test public pages while signed out.
- Treat Player Master email changes as access transfers.
- Review Firestore rule changes independently from visual code changes.
- Preserve audit and revision records when correcting official results.

## 13. Periodic review checklist

### Weekly during an active season

- Export and verify a backup.
- Review approved and registered Operations users.
- Review unresolved identity-reconciliation findings.
- Confirm the active public dashboard is current.
- Confirm recent official scores and standings.

### Before each season

- Review this runbook.
- Review the ARB and Firestore data model.
- Test guest, Captain, Approver, EC, and Super Admin access in DEV.
- Verify authorized domains and Google sign-in.
- Review Firestore rules and indexes.
- Test backup restoration using non-production data.
- Verify season workbook and upload instructions.
- Remove obsolete Operations access.

### After each production deployment

- Record commit and release time.
- Complete the PROD smoke test.
- Update documentation affected by the change.
- Tag significant releases.
- Close or retain the feature branch according to release policy.

## 14. Operational decision log

Use this table for decisions that affect repeatable operations.

| Date | Decision | Owner | Related commit/release |
| --- | --- | --- | --- |
| 2026-07-29 | GitHub `main` is the production source of truth; DEV and PROD deployments remain manual | Super Admin | `ae83150` |
| 2026-07-29 | Guests do not sign in; private Operations access is pre-approved for limited roles | Super Admin | Production baseline |

## 15. Required follow-up documents and reviews

After this runbook is accepted:

1. Perform and record a Security Audit.
2. Update the ARB to reflect separate DEV and PROD projects and the current access model.
3. Create the Super Admin User Guide.
4. Create short Captain, Neutral Approver, and EC guides.
5. Create a tested backup restoration procedure.
6. Add CI checks, then consider automated DEV deployment.


# AlphaOpen backup and disaster recovery

## Current production protection

This runbook applies to Firebase project `alphaopen-production` and Firestore database `(default)` in `nam5`.

| Layer | Configuration | Purpose |
| --- | --- | --- |
| Firestore managed backup | Daily, 98-day retention | Consistent long-term database and index recovery point |
| Firestore PITR | Enabled, seven-day window | Recover individual records or the database from a recent minute |
| Database delete protection | Enabled | Prevent accidental deletion of `(default)` |
| Manual Firestore export | `gs://alphaopen-prod-backups-2026/firestore/manual/`, 30 days | Exact pre-deployment recovery point |
| Authentication export | `gs://alphaopen-prod-backups-2026/auth/`, 180 days | Preserve Firebase UIDs and provider associations |
| Season archive | `gs://alphaopen-prod-backups-2026/season-archives/`, 365 days | Optional end-of-season archive |
| Hosting/source | Firebase Hosting release history and GitHub | Roll back code, rules, indexes, and static assets |

The bucket is in the separate `alphaopen-backups-2026` project. It uses US Standard Storage, uniform bucket-level access, enforced public-access prevention, Google-managed encryption, and seven-day soft delete. No credentials are stored in this repository.

Firestore is the application system of record. Back up every collection and subcollection, including private identity/access records, season configuration, rosters, matchups, lineups, scores, standings, audits, and public projections. The Excel database export is useful for inspection but is not a full-fidelity Firestore restore.

## Check whether backups are working

From the repository root:

```powershell
npm.cmd run backup:status
```

The command is read-only. A healthy result requires:

- one daily schedule;
- a `READY` managed backup no more than 36 hours old;
- PITR enabled;
- database delete protection enabled;
- at least one manual Firestore export;
- at least one Authentication export.

The command exits with a nonzero status when protection is incomplete or stale. Immediately after creating a new daily schedule, this is expected until the first scheduled backup reaches `READY`.

Direct Firebase CLI checks are also available:

```powershell
firebase.cmd firestore:backups:schedules:list --database "(default)" --project alphaopen-production
firebase.cmd firestore:backups:list --location nam5 --project alphaopen-production
firebase.cmd firestore:databases:list --project alphaopen-production
```

For a usable backup, confirm `state` is `READY`, inspect `snapshotTime`, and confirm `expireTime` is approximately 98 days later. Backup metadata and Cloud Audit Logs provide the completion/configuration record; local files are not the authoritative evidence.

## Run a manual backup

Run this before a production deployment that changes Firestore rules, data-writing behavior, identity logic, imports, resets, or migrations:

```powershell
npm.cmd run backup:manual
```

The command deliberately names `alphaopen-production`, waits for the Firestore export to finish, exports Authentication, uploads it to the restricted bucket, verifies its byte size and SHA-256 checksum, and removes the temporary local Authentication file. A non-sensitive operation record is written under `output/backup-logs/`.

Do not commit exports, Authentication data, service-account keys, or player data to Git.

## Retention

Current retention is:

- Daily managed Firestore backups: 98 days (the maximum scheduled-backup retention).
- Manual pre-deployment Firestore exports: 30 days.
- Authentication exports: 180 days.
- End-of-season archives: 365 days.
- Deleted bucket objects: recoverable through soft delete for seven additional days, subject to Cloud Storage behavior.

To change managed-backup retention, first list the schedule and copy its full resource name:

```powershell
firebase.cmd firestore:backups:schedules:list --database "(default)" --project alphaopen-production
firebase.cmd firestore:backups:schedules:update "<FULL_SCHEDULE_RESOURCE_NAME>" --retention 8w --project alphaopen-production
```

Do not reduce retention during an incident. Bucket lifecycle changes should be made in Google Cloud Console under project `alphaopen-backups-2026`, bucket `alphaopen-prod-backups-2026`, and documented here in the same change.

## Restore decision guide

| Incident | Preferred recovery |
| --- | --- |
| A few documents deleted or changed within seven days | Surgical PITR read and approved write-back |
| Broad corruption within seven days | PITR clone/export to a new recovery database, validate, then controlled import |
| Older corruption or database loss | Restore a `READY` scheduled backup to a new named database |
| Bad deployment with a known manual export | Rehearse that export in an isolated database, then controlled import |
| Authentication account loss | Rehearse Authentication import in an isolated project, then controlled PROD import |
| Bad Hosting release | Firebase Hosting rollback, followed by a Git revert and normal deployment |

## Firestore restore procedure

Restoration changes data. Stop and obtain explicit owner approval before any import, write-back, database cutover, or deletion.

1. Stop the affected workflow and prevent new production writes if broad recovery is required.
2. Record the incident time, suspected cause, last known-good time, current Git commit, and affected collections.
3. Select the narrowest recovery point: PITR for recent/surgical recovery, manual export for a deployment boundary, or a scheduled backup for older/full recovery.
4. Restore or clone into a new named database in `alphaopen-production`; never use `(default)` as the first restore target.
5. Verify document counts, stable IDs, players, Operations access, active season, teams, rosters, weeks, matchups, line matches, scores, standings, audits, and public projections.
6. Perform read-only application and role checks against the recovery data using an approved test method.
7. Prepare a collection-specific or full import plan. Firestore imports overwrite matching document IDs but do not delete unrelated extra documents.
8. Obtain explicit approval for the exact PROD import/write-back command.
9. Perform the import during a maintenance window, verify counts and workflows, and then reopen writes.
10. Preserve the recovery database until the owner confirms recovery. Its later deletion is a separate destructive action requiring explicit approval.

Scheduled backups restore only to a new database. Do not follow an “in-place restore” procedure that deletes `(default)` unless the owner explicitly authorizes permanent deletion as a final-resort disaster action.

## Authentication restore procedure

Authentication exports contain personal data and stable UIDs.

1. Locate the intended `auth/PROD-auth-<UTC timestamp>.json` object and verify its SHA-256 metadata.
2. Download it only to restricted temporary storage.
3. Import it into an isolated recovery Firebase project first.
4. Confirm user count, UID, provider association, disabled state, and sample Google sign-in.
5. Compare UIDs with Firestore `users`, `operationsAccess`, `playerAccountLinks`, and season memberships.
6. Review UID/email collisions. Firebase bulk import can replace an existing matching UID.
7. Obtain explicit approval before importing into PROD.
8. Delete the restricted temporary local file after the cloud copy and restore result are verified.

## Troubleshooting

### No `READY` scheduled backup

- If the schedule is less than 36 hours old, recheck later; Firebase chooses the daily execution time.
- Confirm Blaze billing remains active on `alphaopen-production`.
- Confirm the schedule still exists and retention is nonzero.
- Review Firestore disaster-recovery details and Cloud Audit Logs in Google Cloud Console.
- Do not delete/recreate the schedule merely to retry; that resets scheduling and does not create an immediate backup.
- Run the manual backup command to create a deployment recovery point while investigating.

### Manual Firestore export fails

- Confirm Firebase CLI is signed in with the approved owner account.
- Confirm `alphaopen-production` billing is enabled.
- Confirm the bucket exists in `alphaopen-backups-2026` and is in `US`.
- Confirm the PROD Firestore service agent has `roles/storage.admin` on only this bucket.
- Copy the operation/error text into the incident record without including private document data.

### Authentication upload fails

- Do not email or commit the temporary JSON file.
- Confirm the backup project billing and bucket permissions.
- Rerun the manual backup; its `finally` cleanup removes the temporary file.
- Confirm the uploaded object's SHA-256 metadata before treating it as usable.

### Status command says protection is incomplete

Read the JSON fields individually. The most common initial condition is `readyBackupCount: 0` before the first daily backup. PITR should show `POINT_IN_TIME_RECOVERY_ENABLED`, delete protection should show `DELETE_PROTECTION_ENABLED`, and both manual/Auth object fields should be populated.

## Quarterly recovery rehearsal

At least quarterly and before each season:

1. Choose a verified backup.
2. Restore it into a new isolated named database, never over `(default)`.
3. Verify counts and critical relationships.
4. Record operation IDs, start/end time, result, gaps, and measured recovery time.
5. Keep the recovery database until the owner accepts the rehearsal result.
6. Ask for explicit approval before deleting the recovery database.

Initial objectives are a one-minute recovery point within the seven-day PITR window, less than 24 hours from daily backups, and a four-hour recovery-time target. Replace the four-hour estimate with the measured rehearsal result.

### Rehearsal record: August 7, 2026

- Source: `gs://alphaopen-prod-backups-2026/firestore/manual/PROD-20260807T203306Z`.
- Destination: isolated named database `ao-recovery-20260807` in `alphaopen-production`.
- Client access: closed default rules; the production application remains on `(default)`.
- Protection: database delete protection enabled.
- Import result: `SUCCESSFUL`, 1,511 of 1,511 documents, approximately 31 seconds.
- Verification result: 1,511 documents inventoried across all expected collection groups; inventory completed in approximately 93 seconds without exposing document contents.
- Disposition: recovery database intentionally retained for owner review. Deletion requires a separate explicit approval.

This verifies backup readability and database reconstruction. It does not yet measure a full application cutover or surgical PITR write-back, so the four-hour end-to-end recovery-time target remains conservative.

## Official references

- [Firestore scheduled backups](https://firebase.google.com/docs/firestore/backups)
- [Firestore point-in-time recovery](https://firebase.google.com/docs/firestore/use-pitr)
- [Firestore export and import](https://firebase.google.com/docs/firestore/manage-data/export-import)
- [Firebase Authentication export and import](https://firebase.google.com/docs/cli/auth)
- [Cloud Storage lifecycle management](https://cloud.google.com/storage/docs/lifecycle)
- [Cloud Audit Logs](https://cloud.google.com/logging/docs/audit)

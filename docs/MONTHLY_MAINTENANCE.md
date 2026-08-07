# Monthly maintenance checklist

Complete this once per month and before each season launch. Record the date, owner, evidence links, and follow-up items.

## Source and CI

- [ ] GitHub `main` matches the intended PROD source.
- [ ] No emergency production changes remain uncommitted.
- [ ] Latest `Quality checks` workflow is green.
- [ ] Node, Firebase CLI, Functions dependencies, and GitHub Actions versions were reviewed for supported/security releases.
- [ ] Old feature branches and temporary release artifacts were reviewed safely.

## Environments and release health

- [ ] DEV, UAT, and PROD URLs load.
- [ ] PROD custom domains and TLS work.
- [ ] Guest Home, Active Season, Matches, History, and resources work in a private window.
- [ ] One approved operator can sign in with the correct role.
- [ ] Service-worker/module versions match the current release.
- [ ] Firebase usage, errors, quotas, and Functions logs show no unexplained spike.

## Security and access

- [ ] Super Admin and EC access list reviewed.
- [ ] Departed/inactive users revoked.
- [ ] Captain, Approver, season, and team assignments reviewed.
- [ ] Identity Reconciliation reviewed and unresolved conflicts assigned.
- [ ] No private data is visible through guest pages or public projections.
- [ ] Firestore rules in Git match the active PROD rules.

## Data quality

- [ ] Active Season ID/status is correct and unique.
- [ ] Player Master duplicate email/ID checks reviewed.
- [ ] Teams, ranks, rosters, weeks, matchups, venues, and deadlines sampled.
- [ ] Pending/rejected lineups, disputed scores, and stale public dashboards reviewed.
- [ ] Completed results and standings sampled for consistency.

## Backup and recovery

- [ ] Weekly Firestore export completed and operation succeeded.
- [ ] Authentication and operational workbook backups are current.
- [ ] Backup checksums, access restrictions, and retention reviewed.
- [ ] Quarterly restore rehearsal is current or scheduled.
- [ ] Last known-good Hosting release and Git commit recorded.

## Documentation and risk

- [ ] Deployment/rollback instructions still match actual commands and projects.
- [ ] New incidents and workarounds added to troubleshooting.
- [ ] Technical-risk list reviewed; owners and target dates updated.
- [ ] Upcoming season/rule changes documented before development.

## Sign-off

```text
Month:
Completed by:
Exceptions:
Follow-up owner/date:
Evidence location:
```

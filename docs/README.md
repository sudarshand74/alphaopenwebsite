# AlphaOpen owner and engineering guide

Start here when operating or changing AlphaOpen.

| Need | Document |
| --- | --- |
| Understand the system | [Architecture](ARCHITECTURE.md) |
| Set up a computer | [Local setup](LOCAL_SETUP.md) |
| Release DEV, UAT, or PROD | [Deployment](DEPLOYMENT.md) |
| Undo a bad release | [Rollback](ROLLBACK.md) |
| Diagnose a problem | [Troubleshooting](TROUBLESHOOTING.md) |
| Protect or restore data | [Backup and restoration](BACKUP_RESTORE.md) |
| Perform routine ownership work | [Monthly maintenance](MONTHLY_MAINTENANCE.md) |
| Review weaknesses and priorities | [Known technical risks](TECHNICAL_RISKS.md) |
| Run the league day to day | [Production operations runbook](PRODUCTION_OPERATIONS_RUNBOOK.md) |
| Understand Firestore records | [Firestore data model](../FIRESTORE_DATA_MODEL.md) |

## Three commands to remember

From the repository root:

```powershell
npm run lint
npm test
npm run build
```

Run all three with `npm run check`. These commands do not deploy or write Firebase data.

## Product-owner safety rules

1. Never deploy without an explicit project ID.
2. Test in DEV, then UAT, before PROD.
3. Back up data before rules or data-writing changes.
4. Do not stage every changed file in a dirty workspace; stage named files only.
5. CI validates code but never deploys.
6. If the requested change affects behavior, document it and obtain approval before implementation.

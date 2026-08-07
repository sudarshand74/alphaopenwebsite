# AlphaOpen website

AlphaOpen is a Firebase-hosted tennis-league application for guests, Captains, Neutral Approvers, EC members, and Super Admins.

## Product owner start here

Open the [owner and engineering guide](docs/README.md). It links to architecture, setup, deployment, rollback, troubleshooting, backup/restore, monthly maintenance, and known-risk documentation.

The safe local quality check is:

```powershell
npm run check
```

On Windows, use `npm.cmd run check` if PowerShell blocks `npm.ps1`. This command does not deploy or change Firebase data.

## Safety

- Test in DEV and UAT before PROD.
- Always specify the Firebase project ID and deployment scope.
- Back up data before rules or data-writing changes.
- Never commit credentials, Firebase exports, or player backup files.
- Application behavior changes require product-owner explanation and approval.

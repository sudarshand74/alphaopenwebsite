# Local setup

## What local mode is for

Local mode supports code review, layout checks, automated tests, and Firebase Emulator work. A plain local web server does not safely reproduce live Firebase permissions or data.

## Prerequisites

- Git
- Node.js 22 LTS and npm
- Firebase CLI
- Java 21 or another Firebase Emulator-supported Java runtime if using emulators
- A browser such as Chrome or Edge
- Access to the GitHub repository; Firebase access only if deployments or emulator exports are required

Verify:

```powershell
git --version
node --version
npm --version
firebase.cmd --version
java -version
```

On Windows, use `npm.cmd` instead of `npm` if PowerShell blocks `npm.ps1`; the commands are otherwise identical.

## First-time setup

```powershell
git clone https://github.com/sudarshand74/alphaopenwebsite.git
cd alphaopenwebsite
npm ci
npm ci --prefix functions
npm run check
```

If working from the existing Windows folder:

```powershell
cd "C:\Users\desai\OneDrive\Documents\New project"
git status --short --branch
npm ci
npm ci --prefix functions
```

Stop if the working tree contains changes you do not recognize. Never delete or stage them simply to make the status clean.

## Run the static application

```powershell
python -m http.server 4173 --bind 127.0.0.1
```

Open `http://127.0.0.1:4173`. Use this for layout, navigation, dialogs, and public static content. Do not assume local Firebase behavior matches DEV.

## Run quality checks

```powershell
npm run lint
npm test
npm run build
```

Or run `npm run check`. The build output is placed in `dist/` and is ignored by Git.

## Firebase login and project verification

Only needed for emulator/project operations:

```powershell
firebase.cmd login
firebase.cmd projects:list
Get-Content .firebaserc
```

Never download or commit a service-account key for normal owner operation.

## Emulator Suite

```powershell
firebase.cmd emulators:start --project alphaopen-development-2026
```

The configured ports are Auth `9099`, Firestore `8080`, Hosting `5000`, and Emulator UI `4000`. Use controlled test data. Do not point emulator tests at PROD.

## Start a safe change

```powershell
git fetch origin
git switch main
git pull --ff-only origin main
git switch -c codex/<short-description>
```

Before asking for review, run `npm run check`, inspect `git diff --check`, and list the exact files changed.

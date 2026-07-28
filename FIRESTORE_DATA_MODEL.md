# AlphaOpen Firestore Data Model

Status: Final design for MVP implementation  
Version: 1.0  
Firebase project: `alphaopen-development-2026`

## 1. Design decisions

1. Firebase Authentication UID is the permanent account key. Player ID is the permanent Player Master key; normalized email is a unique deduplication index and may change without changing player history.
2. Existing AlphaOpen canonical IDs remain unchanged and become Firestore document IDs wherever practical.
3. Master people and venues are global. Competition records are owned by a season.
4. Public and private data use separate documents because Firestore security rules cannot hide individual fields in a readable document.
5. Current state is stored for fast screens; immutable revisions and audit events preserve history.
6. Scores, standings, participation totals, and validation results are derived by trusted application code. Captains cannot directly write official calculated values.
7. Timestamps are Firestore `Timestamp` values in UTC. A season stores its IANA timezone, such as `America/New_York`, for display and deadline calculation.
8. Deleting historical competition records is prohibited. Records are archived or voided with an audit reason.

## 2. Canonical identifier rules

| Entity | Document ID | Example |
|---|---|---|
| Firebase user | Firebase Authentication UID | `a7Q...x91` |
| Player | `P` + four digits | `P1001` |
| Venue | `V` + three digits | `V101` |
| Season | `AO-{S|F}-{YYYY}` | `AO-F-2026` |
| Team | `{Season_ID}-T{n}` | `AO-F-2026-T1` |
| Roster assignment | `AO` + four digits | `AO1001` |
| Week | configured code | `W1`, `QF`, `SF`, `F` |
| Season matchup | `{Season_ID}-W{n}-M{n}` | `AO-F-2026-W1-M1` |
| Line match | `{Matchup_ID}-L{n}` | `AO-F-2026-W1-M1-L1` |

Auto-generated Firestore IDs are used for requests, reviews, proposals, notifications, and audit events.

## 3. Collection tree

```text
users/{uid}
  notifications/{notificationId}

players/{playerId}
playerPrivate/{playerId}
playerEmailIndex/{encodedNormalizedEmail}
systemCounters/players
playerAccountLinks/{playerId}
playerLinkRequests/{requestId}
registrationRequests/{uid}
venues/{venueId}
venuePrivate/{venueId}

seasons/{seasonId}
  ruleVersions/{ruleVersionId}
  members/{uid}
  teams/{teamId}
  rosterSlots/{teamId_rankNumber}
  rosterAssignments/{assignmentId}
  weeks/{weekId}
  matchups/{matchupId}
    lineups/{teamId}
      revisions/{revisionId}
    lineupReviews/{reviewId}
    lineMatches/{lineMatchId}
      corrections/{correctionId}
      scheduleProposals/{proposalId}
      scoreSubmissions/{submissionId}
      scoreDecisions/{decisionId}
  approverAssignments/{assignmentId}
  availability/{availabilityId}
  replacementRequests/{requestId}
  latePassRequests/{requestId}
  adjustments/{adjustmentId}
  standings/{teamId}
  standingsSnapshots/{snapshotId}
  playoffBrackets/{bracketId}
  announcements/{announcementId}
  auditEvents/{eventId}

```

Season data is stored only in the operational `seasons` tree and requires an authenticated, authorized account.

## 4. Global collections

### 4.1 `users/{uid}`

One document for every authenticated account.

Required fields:

```text
uid: string
email: string
emailVerified: boolean
displayName: string
photoUrl: string | null
status: "pending" | "active" | "suspended"
profileType: "pending" | "guest" | "player" | "captain" | "ec" | "neutralApprover" | "superAdmin"
playerId: string | null
globalRoles: string[]                 // normally [] or ["superAdmin"]
createdAt: Timestamp
lastLoginAt: Timestamp
updatedAt: Timestamp
```

Rules:

- The document ID must equal the Firebase UID.
- A user may read their own document.
- Only a Super Admin may change `status`, `playerId`, or `globalRoles`.
- `superAdmin` should also be represented by a Firebase custom claim for efficient security-rule checks.

### 4.2 `players/{playerId}`

Guest-safe player identity. Only fields approved for public display belong here.

```text
playerId: string
displayName: string
status: "active" | "inactive"
publicProfileEnabled: boolean
photoUrl: string | null
createdAt: Timestamp
updatedAt: Timestamp
```

### 4.3 `playerPrivate/{playerId}`

EC-controlled private master record.

```text
playerId: string
firstName: string
lastName: string
fullName: string
emailNormalized: string
phone: string | null
tShirtSize: string | null
globalRank: number | null
globalScore: number | null
waiverStatus: string | null
emergencyContact: map | null
internalNotes: string | null
createdByUid: string
createdAt: Timestamp
updatedByUid: string
updatedAt: Timestamp
```

### 4.4 `playerAccountLinks/{playerId}`

The approved one-to-one connection between a master player and Google account.

```text
playerId: string
uid: string
emailAtApproval: string
status: "active" | "revoked"
linkMethod: "exactEmail" | "ecApproved" | "superAdminOverride"
approvedByUid: string
approvedAt: Timestamp
revokedByUid: string | null
revokedAt: Timestamp | null
reason: string | null
```

The application must prevent more than one active player link per UID and more than one active UID per Player ID unless a recorded Super Admin exception exists. `playerEmailIndex` enforces one normalized email per Player ID, and `systemCounters/players.nextNumber` assigns permanent sequential IDs beginning at `P1001`.

### 4.5 `playerLinkRequests/{requestId}`

```text
requestingUid: string
requestedPlayerId: string
verifiedEmail: string
status: "pending" | "approved" | "rejected" | "cancelled"
requestNote: string | null
decisionNote: string | null
decidedByUid: string | null
createdAt: Timestamp
decidedAt: Timestamp | null
```

### 4.6 `registrationRequests/{uid}`

Legacy administrative record retained for previously registered accounts and identity-transfer cleanup. Public authentication no longer creates this document.

```text
uid: string
email: string
displayName: string
photoUrl: string | null
status: "pending" | "approved" | "rejected"
requestedAt: Timestamp
decidedByUid: string | null
decidedAt: Timestamp | null
decisionNote: string | null
matchedPlayerId: string | null
assignedProfileType: string | null
```

AlphaOpen uses a public-first model. Guests and players do not authenticate. Google sign-in is exposed only at the private `#operations` entry and succeeds only for an existing active account with a Captain, EC, Neutral Approver, or Super Admin role. Unknown and player-only identities are signed out without creating `users` or `registrationRequests` records.

### 4.7 `venues/{venueId}` and `venuePrivate/{venueId}`

`venues` contains guest-safe fields:

```text
venueId: string
name: string
address: string
addressLine1: string
addressLine2: string
city: string
state: string
postalCode: string
fullAddress: string
courtCount: number | null
mapUrl: string | null
status: "active" | "inactive"
active: boolean
updatedByUid: string
updatedAt: Timestamp
```

`venuePrivate` contains operational instructions, gate codes, reservation contacts, and internal notes.

## 5. Season root and configuration

### 5.0 `systemConfig/seasonControl`

```text
activeSeasonId: string | null
updatedByUid: string
updatedAt: Timestamp
```

The application treats this document as the authoritative active-season pointer. Only a Super Admin may update it. When a season is changed to `active`, the same atomic transaction changes any previously active season to `completed` and updates this pointer. Player and user profile role editing is enabled only for the pointed active season; all other season memberships are displayed read-only.

### 5.1 `seasons/{seasonId}`

```text
seasonId: string
name: string
term: "spring" | "fall"
year: number
status: "draft" | "published" | "active" | "playoffs" | "completed" | "archived"
timezone: string
startDate: string                     // YYYY-MM-DD date-only value
endDate: string                       // YYYY-MM-DD date-only value
activeRuleVersionId: string
teamCount: number
rosterRanksPerTeam: number
regularSeasonMatchupsPerTeam: number
linesPerMatchup: number
playersPerLine: number
createdByUid: string
createdAt: Timestamp
updatedByUid: string
updatedAt: Timestamp
```

### 5.2 `seasons/{seasonId}/ruleVersions/{ruleVersionId}`

Rule versions are immutable after use by a submitted lineup or score.

```text
version: number
status: "draft" | "active" | "retired"
effectiveAt: Timestamp
roster: map
lineup: map
sor: map
replacement: map
deadlines: map
latePass: map
scoring: map
playoffs: map
standings: map
createdByUid: string
createdAt: Timestamp
```

Fall 2026 lineup settings include five doubles lines, ten unique players, rank restrictions for L1/L4/L5, nondecreasing SOR, and min/max participation at team-rank level.

## 6. Season access and teams

### 6.1 `seasons/{seasonId}/members/{uid}`

This is the authoritative season access document.

```text
uid: string
playerId: string | null
roles: string[]                       // "ec", "captain", "player", "neutralApprover"
teamIds: string[]
status: "active" | "inactive"
effectiveFrom: Timestamp
effectiveTo: Timestamp | null
assignedByUid: string
assignedAt: Timestamp
```

Global Super Admin is not repeated here. An approver's actual authority comes from `approverAssignments`, not merely the `neutralApprover` label.

### 6.2 `seasons/{seasonId}/teams/{teamId}`

```text
teamId: string
name: string
shortName: string
captainPlayerIds: string[]
captainNameSnapshot: string
status: "active" | "withdrawn"
seed: number | null
color: string | null
createdAt: Timestamp
updatedAt: Timestamp
```

### 6.3 `seasons/{seasonId}/rosterSlots/{teamId_rankNumber}`

Example document ID: `AO-F-2026-T1_06`.

```text
teamId: string
rankNumber: number
minimumAppearances: number
maximumAppearances: number
officialAppearances: number
remainingToMinimum: number
remainingBeforeMaximum: number
minimumWaived: boolean
waiverAdjustmentId: string | null
updatedAt: Timestamp
```

Calculated participation fields are trusted summaries rebuilt from published line matches. Historical matches retain rank snapshots.

### 6.4 `seasons/{seasonId}/rosterAssignments/{assignmentId}`

```text
assignmentId: string
teamId: string
rankNumber: number
playerId: string
assignmentType: "original" | "temporaryReplacement" | "permanentReplacement" | "emergencyReplacement"
status: "requested" | "approved" | "active" | "expired" | "rejected" | "revoked"
effectiveFrom: Timestamp
effectiveTo: Timestamp | null
regularSeasonEligible: boolean
playoffEligible: boolean
replacementRequestId: string | null
reason: string | null
requestedByUid: string | null
approvedByUid: string | null
approvedAt: Timestamp | null
minimumWaiver: boolean
internalNotes: string | null
createdAt: Timestamp
updatedAt: Timestamp
```

Multiple assignment documents may use the same team and rank. Existing assignments are never overwritten to represent a replacement.

## 7. Weeks and team matchups

### 7.1 `seasons/{seasonId}/weeks/{weekId}`

```text
weekId: string
label: string
sequence: number
stage: "regular" | "quarterfinal" | "semifinal" | "final"
startsAt: Timestamp
lineupDeadlineAt: Timestamp
approvalDeadlineAt: Timestamp
publishAt: Timestamp
playByAt: Timestamp
status: "draft" | "open" | "closed"
```

### 7.2 `seasons/{seasonId}/matchups/{matchupId}`

```text
matchupId: string
weekId: string
stage: string
homeTeamId: string
awayTeamId: string
approverUids: string[]
lineupDeadlineAt: Timestamp
approvalDeadlineAt: Timestamp
publishAt: Timestamp
playByAt: Timestamp
effectivePlayByAt: Timestamp
status: "scheduled" | "lineupsOpen" | "readyForApproval" | "approved" | "published" | "inProgress" | "completed" | "ecReview" | "cancelled"
homeLineupStatus: "pendingSubmission" | "submitted" | "approved" | "rejected"
awayLineupStatus: "pendingSubmission" | "submitted" | "approved" | "rejected"
lineupApprovalStatus: "awaitingSubmission" | "awaitingApproval" | "rejected" | "fullyApproved"
homeLineupRevisionNumber: number
awayLineupRevisionNumber: number
homeLineupTracking: map
awayLineupTracking: map
approvalCycleNumber: number
bothLineupsSubmitted: boolean
lineupsPublished: boolean
lineupsPublishedAt: Timestamp | null
fullyApprovedAt: Timestamp | null
lastLineupReset: map | null
lineupWorkflowActorUid: string | null
lineupWorkflowOperationId: string | null
completedLineCount: number
homeTeamPoints: number
awayTeamPoints: number
standingsApplied: boolean
updatedAt: Timestamp
```

Captain and approver UID snapshots make security checks deterministic. Assignment changes must update future unlocked matchups through trusted code.

## 8. Lineups and approval

### 8.1 `matchups/{matchupId}/lineups/{teamId}`

There are exactly two current lineup documents per matchup, one per team.

```text
teamId: string
opponentTeamId: string
status: "draft" | "submitted" | "approved" | "rejected"
revisionNumber: number
ruleVersionId: string
lines: array[5]
  lineNumber: number
  player1: map { playerId, displayNameSnapshot, assignmentId, rankSnapshot }
  player2: map { playerId, displayNameSnapshot, assignmentId, rankSnapshot }
  sor: number
validation: map
  passed: boolean
  checkedAt: Timestamp
  errors: array
  warnings: array
submittedByUid: string | null
submittedByPlayerId: string | null
submittedByNameSnapshot: string | null
submittedByRole: "captain" | "ec" | "neutralApprover" | "superAdmin" | null
submittedAt: Timestamp | null
approvedByUid: string | null
approvedByPlayerId: string | null
approvedByNameSnapshot: string | null
approvedByRole: "neutralApprover" | "superAdmin" | null
approvedAt: Timestamp | null
rejectionReason: string | null
rejectedByUid: string | null
rejectedByPlayerId: string | null
rejectedByNameSnapshot: string | null
rejectedAt: Timestamp | null
updatedAt: Timestamp
```

Five lines fit safely in one document and allow a lineup to be validated and submitted atomically. Each submitted version is copied to the immutable `revisions` subcollection.

Sealing rules:

- A captain can read their own team's lineup.
- The opposing captain cannot read it before `lineupsPublished == true`.
- An assigned approver can read each submitted lineup independently, including while the opponent remains pending.
- ECs and Super Admins may read all lineups in their permitted scope.
- Captains can submit only their authorized team's current revision. Firestore rules prevent them from setting approval or publication fields.

### 8.2 `matchups/{matchupId}/lineupReviews/{reviewId}`

```text
teamId: string | null
side: "home" | "away" | null
lineupRevisionNumber: number | null
action: "submitted" | "approved" | "rejected" | "approvalReopened" | "resetBothApprovedLineups"
reason: string | null
actedByUid: string
actedByPlayerId: string | null
actedByNameSnapshot: string
actedByRole: "captain" | "ec" | "neutralApprover" | "superAdmin"
actedAt: Timestamp
previousStatus: string
newStatus: string
selfApproved: boolean | null
operationId: string
```

On the Firebase Spark plan, official submission, approval, rejection, full
publication, and approved-lineup reset use atomic browser-side Firestore
transactions. Firestore rules validate the actor, team scope, status
transition, immutable revision, and create-only audit record. A fully approved
reset always resets both teams, increments `approvalCycleNumber`, and preserves
immutable revisions and review history. The reset screen checks every Match
Line for score activity and the transaction re-reads those records immediately
before resetting. When Cloud Functions become available, this same document
contract can move behind callable functions without a data migration.

### 8.3 `seasons/{seasonId}/approverAssignments/{assignmentId}`

```text
approverUid: string
backupApproverUid: string | null
scopeType: "season" | "week" | "matchup"
weekId: string | null
matchupId: string | null
priority: number
status: "active" | "inactive"
effectiveFrom: Timestamp
effectiveTo: Timestamp | null
assignedByUid: string
assignedAt: Timestamp
```

Matchup scope overrides week scope; week scope overrides season scope. The resolved approver UIDs are copied to each unlocked matchup.

## 9. Line matches, scheduling, and scores

### 9.1 `matchups/{matchupId}/lineMatches/{lineMatchId}`

```text
lineMatchId: string
lineNumber: number
homeTeamId: string
awayTeamId: string
homeLineupRevisionNumber: number
awayLineupRevisionNumber: number
lineupState: "approved" | "awaitingReapproval"
scoreEntryAllowed: boolean
homePlayers: array[2]                 // player, assignment, name and rank snapshots
awayPlayers: array[2]
scheduleStatus: string
scheduledAt: Timestamp | null
venueId: string | null
venueNameSnapshot: string | null
effectivePlayByAt: Timestamp
thirdSetFormat: "tiebreakTo12" | "fullSet" | null
thirdSetFormatConfirmedByUids: string[]
thirdSetFormatConfirmedAt: Timestamp | null
resultType: "normal" | "retirement" | "walkover" | "notPlayed" | "abandoned" | "ecAwarded" | null
sets: array
  setNumber: number
  format: "standardSet" | "tiebreakTo12"
  homeScore: number
  awayScore: number
winnerTeamId: string | null
homePoints: number
awayPoints: number
scoreRuleVersionId: string
scoreStatus: "scheduled" | "inProgress" | "submitted" | "awaitingConfirmation" | "confirmed" | "disputed" | "ecReview" | "published" | "locked"
submittedByUid: string | null
submittedAt: Timestamp | null
confirmedByUid: string | null
confirmedAt: Timestamp | null
publishedAt: Timestamp | null
updatedAt: Timestamp
```

The official score fields are written only after validation. Set 3 is absent for a straight-set result and required after split Sets 1 and 2.

### 9.2 `scheduleProposals`, `scoreSubmissions`, and `scoreDecisions`

- `scheduleProposals` preserves proposed dates, venues, proposing side, response, and notes.
- `scoreSubmissions` preserves exactly what a captain submitted before confirmation.
- `scoreDecisions` preserves confirmations, disputes, corrections, EC awards, and reasons.

Official line-match state is a trusted projection of these immutable workflow documents.

### 9.3 `lineMatches/{lineMatchId}/corrections/{correctionId}`

Immutable EC/Admin before-and-after record for player, schedule, or completed-score corrections.

```text
correctionId: string
seasonId: string
matchupId: string
lineMatchId: string
reason: string
previousStatus: string
correctedStatus: string
previousHomePlayers: array
previousAwayPlayers: array
correctedHomePlayers: array
correctedAwayPlayers: array
previousSets: array
correctedSets: array
previousHomePoints: number
previousAwayPoints: number
correctedHomePoints: number
correctedAwayPoints: number
previousWinnerTeamId: string | null
correctedWinnerTeamId: string | null
correctedByUid: string
correctedByNameSnapshot: string
correctedAt: Timestamp
```

EC and Super Admin may create correction records. They are never updated or deleted. Captains cannot use this correction path.

## 10. Operational workflow collections

### `availability/{availabilityId}`

Use ID `{weekId}_{teamId}_{playerId}` and store availability status, note, responder UID, and update timestamp.

### `replacementRequests/{requestId}`

Store team, rank, proposed player, replacement type, eligibility requested, reason, status, captain request, EC decision, and resulting assignment ID.

### `latePassRequests/{requestId}`

Store team, matchup or line scope, reason, requested extension, opponent position, decision, resulting effective play-by date, and the team's pass balance snapshot.

### `adjustments/{adjustmentId}`

Store penalties, waivers, overrides, MSP bonuses, score corrections, point impacts, authority, reason, decision-maker, and timestamps. Adjustment documents are never silently edited after application; corrections create reversing and replacement entries.

## 11. Standings and publication

### `standings/{teamId}`

Current trusted summary for fast display:

```text
teamId: string
completedMatchups: number
completedLines: number
lineWins: number
lineLosses: number
matchPoints: number
bonusPoints: number
penaltyPoints: number
adjustedTotal: number
playoffPosition: number | null
qualified: boolean
calculatedAt: Timestamp
sourceVersion: number
```

The EC/Admin browser recalculates these rows from official, published, completed
regular-season line matches before rebuilding the public dashboard:

- `matchPoints` is the sum of the team's official line points.
- `adjustedTotal = matchPoints + bonusPoints - penaltyPoints`.
- Existing `bonusPoints` and `penaltyPoints` are preserved during score corrections.
- Ranking uses adjusted total, line wins, completed lines, and Team ID in that order.
- `playoffPosition` and `qualified` are refreshed from that ranking.

The same refresh recalculates each matchup's team-point totals, completed/canceled
line counts, completion status, and winner. Matchups record
`derivedRecordsUpdatedAt` and `derivedRecordsUpdatedByUid`. Admin can run the same
process manually with **Setup Season → Refresh Active Public Dashboard** if a
browser or network interruption occurs after a private correction is saved.

`standingsSnapshots` stores immutable standings at publication milestones. Season summaries, schedules, approved lineups, results, standings, playoff brackets, and announcements remain in the authorized season tree.

## 12. Notifications and audit

### `users/{uid}/notifications/{notificationId}`

```text
type: string
title: string
body: string
seasonId: string | null
entityType: string | null
entityId: string | null
read: boolean
createdAt: Timestamp
readAt: Timestamp | null
```

### `seasons/{seasonId}/auditEvents/{eventId}`

```text
occurredAt: Timestamp
actorUid: string
actorRolesSnapshot: string[]
entityType: string
entityId: string
action: string
before: map | null
after: map | null
reason: string | null
authorityReference: string | null
correlationId: string
```

Ordinary clients cannot update or delete audit events. Sensitive tokens, passwords, and unnecessary personal data must never be stored in the audit record.

## 13. Required composite indexes

Create indexes only when an implemented query requires them. The expected MVP set is:

| Collection group | Fields |
|---|---|
| `rosterAssignments` | `teamId ASC, rankNumber ASC, status ASC, effectiveFrom ASC` |
| `rosterAssignments` | `playerId ASC, status ASC, effectiveFrom DESC` |
| `matchups` | `weekId ASC, status ASC` |
| `matchups` | `homeTeamId ASC, playByAt ASC` |
| `matchups` | `awayTeamId ASC, playByAt ASC` |
| `approverAssignments` | `approverUid ASC, status ASC, scopeType ASC` |
| `replacementRequests` | `teamId ASC, status ASC, createdAt DESC` |
| `latePassRequests` | `teamId ASC, status ASC, createdAt DESC` |
| `auditEvents` | `entityType ASC, entityId ASC, occurredAt DESC` |
| `notifications` | `read ASC, createdAt DESC` |

Avoid array-contains queries combined with several range filters. Where a dashboard needs a complex cross-entity view, create a trusted summary document instead of repeatedly scanning operational records.

## 14. Security-rule ownership

| Data | Guest | Player | Captain | Approver | EC | Super Admin |
|---|---:|---:|---:|---:|---:|---:|
| Season tree | No | Public projection only | Authorized-season read | Assigned-season read | Season-scoped read/write | Full |
| Own user/profile | No | No operations account | Same | Same | Scoped read | Full |
| Player private master | No | No | Team-needed subset through safe view | No | Season roster scope | Full |
| Roster assignments | No | Public projection only | Own team read | Matchup-needed read | Season write | Full |
| Draft lineup | No | No | Own team write | No | Season read/override | Full |
| Submitted sealed lineup | No | No | Own side only | Both when review-ready | Season read | Full |
| Approved lineup/result | Public projection | Public projection | Authorized-season read | Assigned-season read | Read | Full |
| Official score/points | Public projection | Public projection | Submit proposal only | Assigned-season read | Resolve | Full |
| Audit events | No | No | No | Assigned-event read | Season read | Full |

Security rules authorize access; they do not replace league-rule validation. SOR, eligibility, participation limits, score calculation, simultaneous lineup publication, standings updates, and audit creation require trusted server-side transactions before production use.

## 15. Atomic server operations

The following operations must be implemented as trusted transactions or callable server operations:

1. Link or unlink a Firebase UID and Player ID.
2. Activate, expire, or revoke a roster assignment.
3. Validate and submit a lineup while saving an immutable revision.
4. Mark both lineups ready without exposing either early.
5. Approve and publish both lineups simultaneously.
6. Validate a score and calculate winner and league points.
7. Confirm or resolve a score and apply it to matchup totals.
8. Recalculate rank participation and standings.
9. Apply or reverse a penalty, waiver, bonus, or override.
10. Write the matching audit events.

Cloud Functions deployment requires a billing-enabled Firebase project. Development can begin on the Spark plan with Authentication, Firestore structure, UI validation, emulators, and sample data, but production-authoritative operations above must not rely solely on browser code.

## 16. Import order

Import sample and production data in this order:

1. `venues` and `venuePrivate`
2. `players` and `playerPrivate`
3. `seasons` and `ruleVersions`
4. `members`
5. `teams`
6. `rosterSlots`
7. `rosterAssignments`
8. `weeks`
9. `matchups`
10. `lineups` and `lineMatches`
11. confirmed historical scores
12. calculated participation and standings
13. account links after users first authenticate

Every import must support dry-run validation, duplicate-ID detection, reference checks, and an import audit record.

## 17. Remaining rule decisions that affect implementation

The database supports either outcome, but these league decisions must be finalized before server validation is frozen:

1. Whether two players assigned to the same rank may both play in one weekly matchup.
2. Whether that situation counts as one or two rank appearances.
3. Injury/retirement points during a third set.
4. Exact invalid-lineup penalty and opponent award.
5. Final standings tie-break fallback.
6. One-sided lineup handling after the deadline.

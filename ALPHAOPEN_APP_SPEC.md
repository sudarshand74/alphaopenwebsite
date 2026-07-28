# AlphaOpen Tennis League App Specification

Version: 0.1 Draft  
Target season: Fall 2026  
Target platforms: iPhone, Android, tablet, and desktop web browsers  
Product form: Mobile-first Progressive Web App (PWA)

## 1. Purpose

AlphaOpen is a friendly competitive tennis league. The application will combine a public league website with a secure league-management system for Executive Committee members (ECs), captains, lineup approvers, and Super Admins.

The application will manage seasons, master players, secure player accounts, personal playing history, team/rank assignments, player replacements, weekly lineups, automated lineup validation, neutral lineup approval, scheduling, scores, standings, late passes, playoffs, and a permanent audit history.

This specification is based only on:

- The Fall 2026 `AO-Rules` tab supplied by AlphaOpen.
- Requirements supplied directly in the product-design conversation.

No other spreadsheet tabs are treated as requirements or authoritative data sources.

## 2. Product goals

1. Work cleanly on Apple and Android phones without requiring separate native applications.
2. Give guests a professional public website for schedules, results, standings, upcoming matches, and rules.
3. Give each authenticated user only the access needed for their assigned responsibility.
4. Let ECs maintain the authoritative master player roster and season team/rank assignments.
5. Let captains create valid weekly lineups from EC-approved players.
6. Validate SOR and all programmable lineup rules before submission.
7. Keep opposing lineups sealed until both are submitted and a neutral approver approves them.
8. Support player replacements while applying participation limits at the team-rank level.
9. Validate tennis scores and calculate league points and standings consistently.
10. Maintain an audit trail for every material action, decision, replacement, approval, and override.

## 3. Product boundaries

### 3.1 Included in the first production release

- Public league website
- User authentication
- Player self-service signup and secure account linking
- Personal player dashboard and playing history
- Role and permission management
- Season configuration
- Master player roster
- Team creation
- Team/rank assignments
- Replacement management
- Player and rank-level participation tracking
- Captain lineup builder
- Automated lineup and SOR validation
- Sealed lineup submission
- Neutral lineup approval
- Match scheduling
- Late-pass requests and decisions
- Score submission and confirmation
- Automatic points and standings
- Playoff qualification and bracket
- EC decisions, penalties, waivers, and overrides
- Notifications
- Audit log
- Mobile Home Screen installation

### 3.2 Deferred features

- Native Apple App Store distribution
- Native Google Play distribution
- Online player payments
- In-app chat
- Live match scoring point by point
- Court-reservation vendor integration
- Advanced player-rating calculations
- Public social network features

## 4. User types and access

### 4.1 Super Admin

Super Admin is the highest system role. Recommended limit: two trusted users.

Super Admin can:

- Manage users and roles.
- Create, configure, publish, archive, and reopen seasons.
- Assign ECs, captains, and lineup approvers.
- Perform every EC action.
- Configure system rules and deadlines.
- Correct historical records through controlled correction workflows.
- Reopen approved or locked lineups and scores.
- View the complete audit log.
- Manage system integrations and security settings.

### 4.2 Executive Committee member (EC)

ECs manage league operations for assigned seasons.

ECs can:

- Maintain the master player roster.
- Add players to a season.
- Create teams.
- Assign players to teams and roster ranks.
- Manage original, temporary, and permanent rank assignments.
- Approve or reject replacements.
- Allow regular-season or playoff replacements.
- Manage season schedules and venues.
- Review all season lineups and results.
- Resolve score and scheduling disputes.
- Grant late passes.
- Apply penalties and waivers.
- View season-level audit history.
- Act as lineup approver only when separately assigned.

EC permission may be limited to one or more specific seasons.

### 4.3 Captain

A captain is assigned to one or more teams for a season.

Captains can:

- View their approved team roster.
- View rank-level participation status.
- Record or review player availability.
- Draft a weekly lineup.
- Run automated validation.
- Submit a valid lineup by the deadline.
- Respond to lineup correction requests.
- Propose match times and venues.
- Request late passes and replacements.
- Submit scores for assigned matches.
- Confirm or dispute opponent-submitted scores.
- View their team's history.

Captains cannot:

- Create master player records.
- Assign or change player ranks.
- Activate a replacement.
- View an opponent's sealed lineup.
- Approve their own lineups unless separately assigned and explicitly permitted.
- Modify published results without an approval workflow.

### 4.4 Player

A player uses the same public experience as a Guest and does not need an account. Captains, Neutral Approvers, ECs, and Administrators who also play retain their immutable `Player_ID` while using one approved operations login.

Limited operations access workflow:

1. Public navigation contains no sign-in or registration control.
2. Approved operations personnel receive the private `#operations` address.
3. Google authentication must resolve to an existing active user with a Captain, Neutral Approver, EC, or Super Admin assignment.
4. Unknown, inactive, and player-only identities are signed out without creating a registration request.
5. Firestore rules enforce the role assignment; knowing the private URL never grants access.

Players can:

- View published teams, rosters, schedules, standings, scores, and player history.
- View wins, losses, set scores, games, league points, line numbers played, team history, rank history, replacements, and playoff appearances.

Players cannot:

- Sign in solely because they exist in Player Master.
- Change official team, rank, eligibility, lineup, score, or historical results.
- View private contact information or other Player Master fields.
- View sealed opposing lineups or internal EC notes.

Player history is calculated from immutable Player IDs in official Match Data and roster assignments. Changing a name or email does not remove prior history.

### 4.5 Guest

Guests do not require login.

Guests can view only published information:

- Home page and announcements
- Current season
- Upcoming matches
- Published schedules
- Completed results
- Standings
- Playoff bracket
- Rules
- Public venue information
- Join/contact information

Guests cannot view private contact data, availability, draft lineups, sealed lineups, internal notes, disputes, or audit records.

### 4.6 Lineup Approver assignment

Lineup Approver is an assignment, not a permanent global role. An EC or neutral person may receive this assignment.

Assignment scopes:

1. Entire season
2. Specific week
3. Specific team matchup

The most specific active assignment takes precedence. Each scope may have one primary and one backup approver.

An approver can:

- See both lineups only after both captains submit, or when an authorized exception is invoked after the deadline.
- Review system-validation results.
- Approve both lineups together.
- Request changes from either or both captains.
- Escalate a matchup to an EC or Super Admin.

An approver cannot directly edit a captain's lineup.

By default, a person cannot approve a matchup in which that person is a player or captain. A Super Admin override must include a reason.

## 5. Season model

Each season has independent configuration and history.

Required season fields:

- Name
- Status: Draft, Published, Active, Playoffs, Completed, Archived
- Timezone
- Start and end dates
- Number of teams
- Roster ranks per team
- Number of regular-season matchups per team
- Number of lines per team matchup
- Players per line
- Player/rank minimum appearances
- Player/rank maximum appearances
- Lineup submission deadline rules
- Lineup approval deadline rules
- Lineup publication rules
- Play-by date rules
- Late-pass rules
- Score rules
- Third-set formats
- Standings rules
- Playoff rules
- Replacement policy
- Notification settings

Fall 2026 defaults:

- 8 teams
- 14 roster ranks per team
- 7 regular-season team matchups per team
- 5 doubles lines per team matchup
- 10 selected players per team matchup
- Minimum 4 appearances per team rank
- Maximum 6 appearances per team rank

All defaults remain configurable by Super Admin for future seasons.

## 6. Master player roster

ECs own the master roster. Each real person should have one master player record.

Required player fields:

- Unique player ID
- Legal/full name
- Preferred/display name
- Email
- Phone, if collected
- Active/inactive status
- Public profile permission
- Internal EC notes
- Date created
- Last modified

Optional fields:

- Global AlphaOpen rank
- Global AlphaOpen score
- Emergency contact
- Waiver status

Private player fields must never be exposed to Guests.

The system should warn ECs about likely duplicate players but must not merge records automatically.

## 7. Team and rank assignments

### 7.1 Core principle

Rank belongs to a team's season roster slot. A player is assigned to that slot for an effective period.

Multiple players may be associated with the same team rank because of replacements. Historical assignments must never be overwritten.

### 7.2 Required rank-assignment fields

- Assignment ID
- Season
- Team
- Roster rank
- Player
- Assignment type: Original, Temporary Replacement, Permanent Replacement, Emergency Replacement
- Status: Requested, Approved, Active, Expired, Rejected, Revoked
- Effective start date
- Effective end date, if temporary
- Regular-season eligibility
- Playoff eligibility
- Replacement reason
- Requesting captain, if applicable
- Approving EC
- Approval timestamp
- Rank-minimum waiver flag
- Internal notes

### 7.3 Replacement behavior

- Captains may request a replacement.
- Only an EC or Super Admin may create or activate the replacement assignment.
- Multiple players may remain associated with one rank.
- A replacement may be temporary or permanent.
- A replacement may be permitted during regular season or playoffs when approved.
- The season's replacement limits and policies must be configurable.
- Historical matches retain the player and roster rank used at match time.
- Ending an assignment does not delete prior appearances.

### 7.4 Lineup eligibility

A player is selectable only when:

- The player is active.
- The player has an approved assignment to that team and rank.
- The assignment is effective for the relevant match date or week.
- The assignment permits the match stage: regular season or playoffs.
- The rank has not reached its maximum, unless an approved override exists.

## 8. Participation tracking and min/max rule

Min/max compliance is evaluated at the team-rank level, not separately for each person.

Example:

- Original Rank 6 player appears 3 times.
- Replacement Rank 6 player appears 2 times.
- Rank 6 participation total is 5.

Required calculations:

- Individual player appearances
- Team-rank appearances across all assigned players
- Remaining appearances before maximum
- Remaining scheduled opportunities to reach minimum
- At-risk rank slots
- Approved minimum waivers

An approved lineup appearance increments the team-rank counter using a saved rank snapshot. Later assignment changes must not alter historical counts.

Default behavior: one team-rank slot may be used only once per weekly team matchup. Using two players assigned to the same rank in one team matchup requires an EC override until the league explicitly adopts another rule.

## 9. Lineup construction and validation

### 9.1 Lineup structure

Each team submits five doubles lines:

- L1: two players
- L2: two players
- L3: two players
- L4: two players
- L5: two players

Ten unique players are required unless an EC-approved exception exists.

### 9.2 SOR calculation

For each line:

`SOR = roster rank of player 1 + roster rank of player 2`

Required order:

`L1 SOR <= L2 SOR <= L3 SOR <= L4 SOR <= L5 SOR`

### 9.3 Line-rank restrictions

- L1: ranks 1 through 4 only
- L2: no rank restriction other than SOR
- L3: no rank restriction other than SOR
- L4: ranks 7 through 13 only
- L5: ranks 11 through 14 only

The top/strongest roster rank selected for the weekly lineup must play L1. The bottom/weakest roster rank selected must play L5.

### 9.4 Automatic validation checks

Before submission, the system must verify:

1. Five lines exist.
2. Every line contains two players.
3. Ten unique players are used.
4. Each player belongs to the submitting team.
5. Each player has an active, approved rank assignment.
6. Each assignment is eligible for the match stage.
7. No player is used more than once in the weekly team matchup.
8. Rank-level maximum has not been exceeded.
9. Same-rank use complies with the active rule or override.
10. L1 restrictions pass.
11. L4 restrictions pass.
12. L5 restrictions pass.
13. Strongest selected rank is represented on L1.
14. Weakest selected rank is represented on L5.
15. SOR is nondecreasing from L1 through L5.
16. Any season-specific replacement or eligibility restrictions pass.

Validation must run in the user interface for immediate feedback and again on the server before saving the submission.

### 9.5 Validation output

The captain should receive exact messages, such as:

- `L3 SOR is 15 and L4 SOR is 13. L4 must be equal to or greater than L3.`
- `Player A is not eligible for L1 because the player's roster rank is 5.`
- `Rank 8 has already reached the maximum of six appearances.`
- `Player B's replacement assignment is not approved for playoffs.`

Passing automatic validation does not constitute lineup approval.

## 10. Sealed lineup submission and approval

### 10.1 Weekly deadlines

Each week contains:

- Captain lineup submission deadline
- Approver review deadline
- Official lineup exchange/publication time
- Play-by date

All timestamps are stored consistently and displayed in the season timezone.

### 10.2 Submission workflow

Statuses:

1. Draft
2. Validation Failed
3. System Validated
4. Captain Submitted
5. Waiting for Opponent
6. Ready for Approval
7. Changes Requested
8. Resubmitted
9. Approved
10. Published
11. Locked

Rules:

- A captain normally cannot submit an invalid lineup.
- After submission, the lineup is sealed.
- The submitting captain can see their own lineup.
- The opposing captain cannot see it before approval/publication.
- The approver cannot review a one-sided submission under the normal workflow.
- Once both teams submit, the assigned approver receives access to both lineups simultaneously.
- Approval applies to both lineups together.
- Approved lineups are published simultaneously.
- Post-publication changes require opponent consent or an EC/Super Admin decision.

### 10.3 Missing or late lineup

If only one captain submits by the deadline:

- The submitted lineup remains sealed.
- The late team, approver, and ECs are notified.
- The system records the late submission condition.
- The written-rule penalty is proposed for EC action.
- The on-time lineup is not exposed to the late opponent.
- An EC may extend, penalize, forfeit, or otherwise resolve the situation with a recorded reason.

### 10.4 Approver actions

The assigned approver can:

- Approve both lineups.
- Request changes from Team A.
- Request changes from Team B.
- Request changes from both teams.
- Escalate to EC.

A change request requires a reason. Captains revise only their own lineups. The system revalidates every revision.

## 11. Match scheduling

Each of the five lines has an independent schedule record.

Required capabilities:

- Identify home and away team.
- Collect at least three proposed times where required.
- Propose and accept a date, time, and venue.
- Display the applicable play-by date.
- Apply approved late-pass extensions.
- Track scheduling status.
- Store venue address and instructions.
- Record court-reservation status.
- Display home-team responsibilities.
- Record scheduling notes and disputes.

Suggested statuses:

- Not Started
- Proposals Requested
- Times Proposed
- Confirmed
- Reschedule Requested
- Late Pass Pending
- Postponed
- Completed
- Cancelled
- EC Review

## 12. Late passes

Default Fall 2026 policy:

- EC approval required.
- Up to two late passes per team during regular season.
- Each late pass grants seven additional days.
- Permitted in Weeks 1 through 6.
- Not normally permitted in Week 7 or playoffs.
- Multiple passes may be applied to one matchup when approved.
- Reasons include medical emergency, emergency travel, weather, or EC-approved exception.

Required workflow:

1. Captain requests late pass.
2. Request records team, matchup/line, reason, dates, and opponent position.
3. EC approves, rejects, or requests information.
4. Approved pass updates the deadline and team balance.
5. Every action is audited.

## 13. Score submission

### 13.1 Structured score model

Each line result contains:

- Result type
- Set 1 score
- Set 2 score
- Optional Set 3 score
- Third-set format
- Winning team derived by system
- League points derived by system
- Submitting user and timestamp
- Opponent confirmation or dispute
- EC resolution, if needed

Captains do not manually type W/L when the system can derive it.

### 13.2 Result types

- Normal completion
- Retirement/injury
- Walkover/default
- Not played by deadline
- Abandoned/incomplete
- EC-awarded result

### 13.3 Fall 2026 points

- Every line must be completed by its applicable Play-by Date unless an EC-approved exception, such as a late pass, changes that deadline.
- If a line is not played by the applicable deadline, both teams receive zero points for that line.
- The winning side always receives 14 points.
- In a three-set match, the losing side receives 10 points.
- In a two-set match, the losing side receives points equal to its total games won across Sets 1 and 2, subject to a minimum of 2 and a maximum of 8.
- The number of games won in a third-set tiebreak is not added to the two-set-loss calculation.

Formula for a normally completed line:

```
if line_not_played_by_applicable_deadline:
    team_a_points = 0
    team_b_points = 0
else:
    winner_points = 14

    if match_required_a_third_set:
        loser_points = 10
    else:
        loser_games_won = loser_set_1_games + loser_set_2_games
        loser_points = min(8, max(2, loser_games_won))
```

Examples:

| Match result | Winner points | Loser points | Reason |
|---|---:|---:|---|
| 6-0, 6-0 | 14 | 2 | Two-set minimum |
| 6-2, 6-3 | 14 | 5 | Loser won five games |
| 7-6, 6-4 | 14 | 8 | Ten loser games capped at eight |
| 6-4, 4-6, third-set tiebreak | 14 | 10 | Three-set loss |
| 6-4, 4-6, full third set in playoffs | 14 | 10 | Three-set loss |
| Not played by applicable deadline | 0 | 0 | Rule 5.1 |

### 13.4 Third set

A third set is played only when the first two sets are split, meaning each side has won one set.

- If the same side wins Set 1 and Set 2, that side wins the line in straight sets and Set 3 must remain empty.
- If each side wins one of the first two sets, Set 3 is mandatory and determines the line winner.
- The line winner is always the first side to win two sets.

During the regular season, a split-set match must use the league's configured `12 point tie breaker` as Set 3.

During playoffs, the two sides may choose to play a full third set instead. That choice must be recorded before the match begins. If a full third set is not jointly selected before play, the configured regular third-set tiebreak applies.

Required pre-match field for a playoff line:

- `Third-set format: 12-point tiebreak / Full third set`
- Confirmation by both sides, or recording by an authorized match official
- Confirmation timestamp before the match start

Once the match begins, the third-set format cannot be changed except through an EC correction with a recorded reason.

The Fall 2026 `12 point tie breaker` is defined as:

- First side to reach at least 12 points while leading by at least two points wins.
- At 11-11, play continues until one side establishes a two-point lead.
- There is no fixed maximum score.
- The value stored for each side is tiebreak points, not tennis games.
- Standard tennis tiebreak serving and changeover format applies during play; the app validates and records only the final tiebreak score.

Validation formula:

```
high_score >= 12
and high_score - low_score >= 2
```

Valid examples:

- 12-0 through 12-10
- 13-11
- 14-12
- 15-13

Invalid examples:

- 11-9, because the winner has not reached 12
- 12-11, because the lead is only one
- 13-12, because the lead is only one
- A tied score

### 13.5 Score-entry validation

For a normal result, the app must:

1. Require valid scores for Set 1 and Set 2.
2. Derive the winner of each set from the entered game scores.
3. Reject any Set 3 score when the same side wins Sets 1 and 2.
4. Require Set 3 when the first two sets are split, with one set won by each side.
5. Apply the configured third-set validator according to regular-season or playoff format.
6. Derive the line winner as the first side to win two sets.
7. Calculate 14 points for the winner.
8. Calculate either 10 points or the capped two-set game total for the loser.
9. Prevent a captain from manually entering a W/L value or league-point value that contradicts the scores.
10. Route retirement, default, abandonment, and EC-awarded results through their specialized workflows rather than the normal-score formula.

### 13.5 Score confirmation workflow

Statuses:

1. Scheduled
2. In Progress
3. Score Submitted
4. Awaiting Opponent Confirmation
5. Confirmed
6. Disputed
7. EC Review
8. Published
9. Locked

An opponent captain can confirm or dispute. A dispute requires a reason. Only confirmed or EC-resolved results affect official standings.

## 14. Injury and retirement

The application must:

- Preserve all completed set/game scores.
- Declare the opposing side winner when required by the rules.
- Prevent replacement players from completing an already-started line.
- Mark the result as retirement/injury.
- Record the retiring side, reason, and time if known.
- Route ambiguous scoring to EC review.

The exact points for an injury occurring during a third set remain an unresolved rules decision.

## 15. Penalties, waivers, and overrides

ECs and Super Admins need controlled administrative actions for:

- Late lineup penalty
- Invalid lineup penalty
- Opponent-awarded win
- Rank-minimum waiver
- Rank-maximum override
- Replacement exception
- Playoff replacement permission
- Late-pass exception
- Score correction
- Disciplinary point adjustment
- MSP bonus decision
- Standings correction

Every action requires:

- Rule or authority used
- Reason
- Affected team, rank, lineup, match, or player
- Point impact
- Effective date
- Decision-maker
- Timestamp

Original values remain available in the audit history.

## 16. Standings and playoffs

Official standings are computed from approved results, bonuses, and penalties.

Required standings fields:

- Team
- Completed lines/matchups
- Wins and losses as applicable
- Match points
- Bonus points
- Penalties
- Adjusted total
- Playoff position
- Qualification status

Fall 2026 playoff rules:

- Top six of eight teams qualify.
- Seeds 1 and 2 advance directly to semifinals.
- QF1: Seed 3 vs Seed 6.
- QF2: Seed 4 vs Seed 5.
- SF1: Seed 1 vs the lower-seeded QF winner.
- SF2: Seed 2 vs the higher-seeded QF winner.
- Higher seed is the home team.
- A playoff matchup is won by winning three of five lines.

Tie-break sequence currently specified:

1. Total season points
2. More points in the regular-season head-to-head matchup
3. Team winning three head-to-head lines

A final fallback remains to be defined.

## 17. Mid-Season Party support

The app must support:

- Configuring an MSP week and venue.
- Recording line availability for each team.
- Recording whether at least one line played at the MSP venue.
- Awarding the configured five-point bonus once per eligible team.
- Applying the written no-overlap availability rules.
- Recording an EC decision and reason.
- Keeping MSP bonus decisions separate from match forfeits.

## 18. Notifications

Initial notification channels:

- In-app notifications
- Email notifications

Optional later channel:

- PWA push notifications

Required events:

- Lineup deadline approaching
- Lineup submitted
- Opponent lineup still missing
- Both lineups ready for approval
- Changes requested
- Lineups approved and published
- Scheduling proposal received
- Match time confirmed or changed
- Late-pass decision
- Replacement decision
- Score submitted
- Score confirmation requested
- Score disputed or resolved
- Rank nearing minimum/maximum risk
- Season announcement

## 19. Audit log

Audit events must be immutable to ordinary users.

Each event stores:

- Event ID
- Timestamp
- Actor user
- Actor role/assignment
- Season
- Entity type and ID
- Action
- Before state where applicable
- After state where applicable
- Reason
- Approval/override reference
- Device/session metadata where appropriate

Audited actions include roster changes, rank assignments, replacements, lineup submissions, approvals, post-approval changes, schedules, late passes, scores, confirmations, disputes, penalties, waivers, standings changes, and permission changes.

## 20. Main screens

### 20.1 Public/Guest

- Home
- Season overview
- Upcoming matches
- Schedule
- Results
- Standings
- Playoff bracket
- Rules
- Venues
- Join/contact

### 20.2 Player

- Player dashboard
- Current team and roster rank
- Upcoming matches and availability
- Current-season participation progress
- Match-by-match season history
- Career history and season filter
- Team and rank history
- Profile, privacy, and notification preferences
- Account-link status and correction request

### 20.3 Captain

- Captain dashboard
- My team roster
- Player availability
- Participation/min-max tracker
- Lineup builder
- Submitted/approved lineups
- Match scheduling
- Score submission
- Score confirmations/disputes
- Replacement requests
- Late-pass requests
- Notifications

### 20.4 Lineup Approver

- Assigned weeks/matchups
- Submission readiness dashboard
- Side-by-side lineup review
- System-validation details
- Approve/request changes/escalate
- Approval history

### 20.5 EC

- Season operations dashboard
- Master player roster
- Team and rank assignment editor
- Replacement requests and assignments
- Participation-risk dashboard
- Schedule and deadlines
- All lineups
- Late-pass requests
- Scores and disputes
- Penalties and waivers
- Standings and playoffs
- MSP administration
- Season audit log

### 20.6 Super Admin

- All EC screens
- User and role administration
- Season creation and rule configuration
- Lineup approver assignments
- Security and integration settings
- Historical correction workflows
- Complete audit log

## 21. Data model

The implementation-level Firestore structure, document fields, access boundaries, indexes, and atomic operations are defined in `FIRESTORE_DATA_MODEL.md`. That file is the canonical database blueprint for the Firebase implementation; this section remains the platform-neutral logical model and import/export contract.

### 21.1 Canonical identifiers and workbook tables

All identifiers are immutable. Display names may be edited without changing relationships or history.

| Record | Canonical ID | Example | Key rule |
|---|---|---|---|
| Venue | `V` + three digits | `V101` | Unique `Venue_ID` |
| Season | `AO-{S\|F}-{YYYY}` | `AO-S-2026`, `AO-F-2026` | `S` means Spring; `F` means Fall |
| Player | `P` + four digits | `P1001` | One ID per real person |
| Team | `{Season_ID}-T{n}` | `AO-S-2026-T1` | Composite ownership by `Season_ID + Team_ID` |
| Roster assignment | `AO` + four digits | `AO1001` | Composite key: `Season_ID + Team_ID + Assignment_ID` |
| Season matchup | `{Season_ID}-W{n}-M{n}` | `AO-S-2026-W1-M1` | Composite key: `Season_ID + Season_Matchup_ID`; `Match_Week` stores `Week1` through `Week7`, `QF`, `SF`, or `F` |
| Line match | `{Season_Matchup_ID}-L{n}` | `AO-S-2026-W1-M1-L1` | Composite key: `Season_ID + Season_Matchup_ID + Match_ID` |

The canonical import/export workbook uses these logical tables:

- `Season Master`
- `Venue Master`
- `Player Master`
- `Player Account Links`
- `Player Profiles`
- `Team Master`
- `Team Roster`
- `Season Schedule`
- `Match Data`

The production database may normalize `Match Data` into `line_matches`, `score_submissions`, and `set_scores`, but it must retain the same canonical IDs and foreign-key relationships.

Minimum entities:

- `users`
- `profiles`
- `player_account_links`
- `player_privacy_preferences`
- `player_link_requests`
- `user_season_roles`
- `seasons`
- `season_rules`
- `weeks`
- `players`
- `teams`
- `team_captains`
- `team_rank_slots`
- `player_rank_assignments`
- `player_availability`
- `replacement_requests`
- `team_matchups`
- `line_matches`
- `lineup_approver_assignments`
- `lineup_submissions`
- `lineup_lines`
- `lineup_players`
- `lineup_reviews`
- `schedule_proposals`
- `venues`
- `late_pass_requests`
- `score_submissions`
- `set_scores`
- `score_confirmations`
- `penalties_adjustments`
- `standings_snapshots`
- `playoff_brackets`
- `notifications`
- `audit_events`

Important stored snapshots:

- Player's team and roster rank at lineup submission
- Active assignment used for eligibility
- Rule-set version used for validation
- Validation results
- Score-rule version used for point calculation

## 22. Security requirements

- HTTPS for all traffic
- Verified login for non-guests
- Google identity email must be verified before automatic player linking
- One active Google account link per Player ID unless a Super Admin records an exception
- Failed or ambiguous email matches require EC or Super Admin approval
- Database-level row access policies
- Captains limited to assigned teams
- Neutral approvers limited to assigned seasons/weeks/matchups
- ECs limited to assigned seasons unless globally authorized
- Multi-factor authentication required for Super Admins
- Private player data excluded from public queries
- Server-side validation for every material write
- Rate limiting for authentication and public forms
- Secure password recovery or passwordless login
- Automatic session expiration controls
- Backups and tested restore procedure
- No shared captain or EC accounts

## 23. Mobile and accessibility requirements

- Responsive from 320px phone width upward
- Large touch targets
- Bottom navigation for primary mobile tasks
- No critical workflow dependent solely on drag-and-drop
- Keyboard-accessible desktop operation
- Screen-reader labels for controls and validation messages
- Sufficient contrast
- Clear error summaries and field-level errors
- Works in current Safari, Chrome, Edge, and Android browsers
- Installable as a Home Screen PWA
- Graceful handling of weak or interrupted connections
- Confirmation before destructive or irreversible actions

## 24. Nonfunctional requirements

- Public pages should load quickly on cellular networks.
- Ordinary app screens should respond within approximately two seconds under normal league load.
- All dates must use the configured season timezone.
- All rule-driven calculations must be deterministic and testable.
- Rules must be versioned so historical seasons retain their original logic.
- Production data changes must be traceable.
- The system should support multiple seasons without copying application code.
- The application must separate public data from private operational data.

## 25. MVP acceptance criteria

The MVP is acceptable when all of the following pass:

1. A Super Admin can create a test season.
2. An EC can create players, teams, and team/rank assignments.
3. An EC can assign multiple players to one rank with effective dates.
4. Rank-level participation combines appearances across replacement players.
5. A captain can see only the roster for assigned teams.
6. A Google-authenticated user can be securely linked to one Player ID through unique email matching or EC approval.
7. A linked player can see personal season and career history but cannot see another player's private data.
8. A captain who is also a player receives both Player and Captain access under one login.
9. A captain can build five doubles lines.
10. Invalid line restrictions or SOR prevent normal submission.
11. Valid lineups can be submitted and remain sealed.
12. The opponent cannot view a sealed lineup.
13. The assigned approver sees both lineups only when the review condition is met.
14. The approver can approve or request changes without editing a lineup.
15. Approved lineups publish simultaneously.
16. Post-publication changes require consent or authorized override.
17. Captains can schedule individual lines.
18. Captains can submit structured scores.
19. The system derives W/L and league points.
20. An opponent can confirm or dispute a result.
21. Only approved results update official standings.
22. ECs can process replacements and late passes.
23. Guests can view public schedules, results, standings, upcoming matches, and rules.
24. Every material action appears in the audit log.
25. Core workflows pass on an iPhone-sized screen, Android-sized screen, and desktop.

## 26. Open rules decisions

These items require EC confirmation before production logic is finalized:

1. Whether two players assigned to the same rank may both play in one weekly team matchup.
2. If both same-rank players play, whether rank participation increases once or twice.
3. Numeric meaning of `equal or lower rank` for replacements.
4. Whether there is a hard replacement limit per team, and how multiple players at one rank affect that limit.
5. Default playoff replacement policy and required approval level.
6. Injury/retirement points when retirement occurs during a third set.
7. Exact invalid-lineup penalty calculation and opponent point award.
8. Final standings tie-break fallback.
9. Resolution when only one captain submits by the deadline.
10. Whether an EC may approve an otherwise invalid lineup before play.
11. Exact conditions under which an approver may view a one-sided submission after a deadline.

## 27. Recommended delivery phases

### Phase 1: Rules confirmation

Resolve the open decisions and freeze the Fall 2026 rule configuration.

### Phase 2: Mobile prototype

Prototype Guest, Player, Captain, Lineup Approver, EC, and Super Admin screens using realistic test data.

### Phase 3: Core MVP

Implement authentication, secure player-account linking, personal history, roles, seasons, roster/rank assignments, replacements, lineup validation, sealed submission, and approval.

### Phase 4: Competition operations

Implement scheduling, late passes, scoring, confirmations, standings, and playoffs.

### Phase 5: Pilot

Run a small test season with test users and matches. Validate permissions and every exception workflow.

### Phase 6: Production launch

Import the authoritative Fall 2026 roster, train ECs/captains/approvers, connect the domain, and launch with monitored support.

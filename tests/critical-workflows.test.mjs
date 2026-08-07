import test from "node:test";
import assert from "node:assert/strict";
import {calculateMatchScore, isStandardSet, isTiebreakTo12} from "../score-rules.js";
import {
  deriveLineupApprovalStatus,
  hasScoreActivity,
  validateLineupShape,
} from "../functions/src/workflow.js";

function roster() {
  return Array.from({length: 14}, (_, index) => ({
    playerId: `AO-${1001 + index}`,
    playerNameSnapshot: `Player ${index + 1}`,
    rankNumber: index + 1,
    status: "active",
  }));
}

test("score calculation covers straight-set and third-set wins", () => {
  assert.deepEqual(calculateMatchScore([{home: 6, away: 2}, {home: 6, away: 4}]), {
    homePoints: 14, awayPoints: 6, winnerSide: "home",
  });
  assert.deepEqual(calculateMatchScore([{home: 6, away: 3}, {home: 4, away: 6}, {home: 12, away: 10}]), {
    homePoints: 14, awayPoints: 10, winnerSide: "home",
  });
  assert.equal(isStandardSet(7, 6), true);
  assert.equal(isTiebreakTo12(13, 11), true);
});

test("invalid or incomplete scores cannot produce league points", () => {
  assert.equal(calculateMatchScore([{home: 6, away: 5}, {home: 6, away: 4}]), null);
  assert.equal(calculateMatchScore([{home: 6, away: 2}, {home: 3, away: 6}]), null);
  assert.equal(calculateMatchScore([{home: 6, away: 2}, {home: 3, away: 6}, {home: 11, away: 9}]), null);
});

test("lineup validation accepts a valid five-line lineup", () => {
  const pairs = [[1, 2], [3, 4], [5, 6], [7, 8], [11, 12]];
  const lines = pairs.map(([first, second], index) => ({
    lineNumber: index + 1,
    player1Id: `AO-${1000 + first}`,
    player2Id: `AO-${1000 + second}`,
  }));
  const result = validateLineupShape(lines, roster());
  assert.equal(result.length, 5);
  assert.deepEqual(result.map(line => line.sor), [3, 7, 11, 15, 23]);
});

test("lineup validation rejects duplicate and out-of-rank players", () => {
  const duplicate = [[1, 2], [3, 4], [5, 6], [7, 8], [1, 12]].map(([first, second], index) => ({
    lineNumber: index + 1,
    player1Id: `AO-${1000 + first}`,
    player2Id: `AO-${1000 + second}`,
  }));
  assert.throws(() => validateLineupShape(duplicate, roster()), /unique/);

  const badRank = [[1, 5], [3, 4], [6, 7], [8, 9], [11, 12]].map(([first, second], index) => ({
    lineNumber: index + 1,
    player1Id: `AO-${1000 + first}`,
    player2Id: `AO-${1000 + second}`,
  }));
  assert.throws(() => validateLineupShape(badRank, roster()), /Line 1 requires/);
});

test("approval and score-activity states protect completed work", () => {
  assert.equal(deriveLineupApprovalStatus("submitted", "submitted"), "awaitingApproval");
  assert.equal(deriveLineupApprovalStatus("approved", "approved"), "fullyApproved");
  assert.equal(deriveLineupApprovalStatus("rejected", "approved"), "rejected");
  assert.equal(hasScoreActivity({scheduleStatus: "scheduled", sets: []}), false);
  assert.equal(hasScoreActivity({scheduleStatus: "completed", sets: []}), true);
  assert.equal(hasScoreActivity({scheduleStatus: "scheduled", sets: [{home: 6, away: 2}]}), true);
});

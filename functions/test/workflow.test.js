import test from "node:test";
import assert from "node:assert/strict";
import {
  deriveLineupApprovalStatus,
  hasScoreActivity,
  normalizeTeamStatus,
  validateLineupShape,
} from "../src/workflow.js";

test("derives matchup approval status with stable precedence", () => {
  assert.equal(deriveLineupApprovalStatus("pendingSubmission", "submitted"), "awaitingSubmission");
  assert.equal(deriveLineupApprovalStatus("submitted", "submitted"), "awaitingApproval");
  assert.equal(deriveLineupApprovalStatus("approved", "submitted"), "awaitingApproval");
  assert.equal(deriveLineupApprovalStatus("approved", "approved"), "fullyApproved");
  assert.equal(deriveLineupApprovalStatus("approved", "rejected"), "rejected");
  assert.equal(normalizeTeamStatus("draft"), "pendingSubmission");
});

test("canonicalizes and validates a five-line lineup", () => {
  const roster = Array.from({length: 14}, (_, index) => ({
    playerId: `P${index + 1}`,
    playerNameSnapshot: `Player ${index + 1}`,
    rankNumber: index + 1,
    status: "active",
  }));
  const lines = [
    ["P1", "P2"],
    ["P3", "P4"],
    ["P5", "P6"],
    ["P7", "P8"],
    ["P11", "P12"],
  ].map(([player1Id, player2Id], index) => ({lineNumber: index + 1, player1Id, player2Id}));
  const result = validateLineupShape(lines, roster);
  assert.equal(result.length, 5);
  assert.equal(result[0].sor, 3);
  assert.equal(result[4].sor, 23);
});

test("detects score activity while allowing scheduling-only records", () => {
  assert.equal(hasScoreActivity({scheduleStatus: "scheduled", scoreStatus: "scheduled", sets: []}), false);
  assert.equal(hasScoreActivity({scheduleStatus: "completed", scoreStatus: "published"}), true);
  assert.equal(hasScoreActivity({scheduleStatus: "scheduled", sets: [{home: 6, away: 2}]}), true);
  assert.equal(hasScoreActivity({homePoints: 1}), true);
});

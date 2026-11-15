const { test } = require("node:test");
const assert = require("node:assert/strict");
const { MODERATION_ACTIONS, REPORT_REASONS, blockedBetween, shouldAutoHide } = require("./moderation");

test("blocking check covers both directions", () => {
  const sql = blockedBetween("$1", "p.user_id");
  assert.match(sql, /bl\.blocker_id=\$1 AND bl\.blocked_id=p\.user_id/);
  assert.match(sql, /bl\.blocker_id=p\.user_id AND bl\.blocked_id=\$1/);
});

test("report reasons and moderation actions are stable identifiers", () => {
  for (const key of Object.keys(REPORT_REASONS)) assert.match(key, /^[a-z_]+$/);
  assert.ok(REPORT_REASONS.other);
  assert.deepEqual(MODERATION_ACTIONS.sort(), ["delete_comment", "dismiss", "hide_course", "hide_group", "hide_post", "restore_course", "restore_group", "restore_post", "suspend_user", "unsuspend_user"]);
});

test("a single report never hides a post on its own", () => {
  assert.equal(shouldAutoHide({ openReports: 1, reasons: ["spam"], authorAgeDays: 0 }), false);
  assert.equal(shouldAutoHide({ openReports: 1, reasons: ["hate"], authorAgeDays: 400 }), false);
});

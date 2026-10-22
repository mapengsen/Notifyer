import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import { notificationChannels, readDesktopNotificationPolicy } from "../notificationPolicy";

test("desktop switch mutes desktop-only notifications and preserves explicitly configured VS Code notices", () => {
  assert.deepEqual(notificationChannels("Desktop", false), { desktop: false, editor: false });
  assert.deepEqual(notificationChannels("Both", false), { desktop: false, editor: true });
  assert.deepEqual(notificationChannels("VS Code", false), { desktop: false, editor: true });
  assert.deepEqual(notificationChannels("Both", true), { desktop: true, editor: true });
  assert.deepEqual(notificationChannels("Desktop", true), { desktop: true, editor: false });
});

test("shared desktop preference defaults off and subsequent events immediately observe an explicit toggle", () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "notifyer-policy-"));
  const file = path.join(folder, "notification-policy.json");
  try {
    assert.equal(readDesktopNotificationPolicy(undefined), false);
    assert.equal(readDesktopNotificationPolicy(file), false);
    fs.writeFileSync(file, JSON.stringify({ desktopEnabled: false }));
    assert.equal(readDesktopNotificationPolicy(file), false);
    fs.writeFileSync(file, JSON.stringify({ desktopEnabled: true }));
    assert.equal(readDesktopNotificationPolicy(file), true);
    fs.writeFileSync(file, JSON.stringify({}));
    assert.equal(readDesktopNotificationPolicy(file), false);
    fs.writeFileSync(file, JSON.stringify({ desktopEnabled: "true" }));
    assert.equal(readDesktopNotificationPolicy(file), false);
    fs.writeFileSync(file, "invalid JSON");
    assert.equal(readDesktopNotificationPolicy(file), false);
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const jwt = require("jsonwebtoken");

test("visit events and Amazon clicks form one anonymous journey for the admin dashboard", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dealzone-journeys-"));
  fs.writeFileSync(path.join(dir, "users.json"), JSON.stringify([{ id: "test-admin" }]));
  fs.writeFileSync(path.join(dir, "deals.json"), JSON.stringify([
    { id: "test-deal", asin: "B012345678", title: "Arched mirror", affiliateUrl: "https://www.amazon.com/dp/B012345678", clicks: 0 },
  ]));
  const port = 19000 + Math.floor(Math.random() * 10000);
  const child = spawn(process.execPath, [path.join(__dirname, "server.js")], {
    env: { ...process.env, VERCEL: "", MONGODB_URI: "", PORT: String(port), DATA_DIR: dir, UPLOADS_DIR: path.join(dir, "uploads"), JWT_SECRET: "test-secret" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(async () => {
    if (child.exitCode === null) {
      const closed = new Promise((resolve) => child.once("exit", resolve));
      child.kill();
      await closed;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Server did not start")), 10000);
    child.stdout.on("data", () => { clearTimeout(timeout); resolve(); });
    child.once("exit", (code) => { if (code) reject(new Error(`Server exited ${code}`)); });
  });
  const base = `http://127.0.0.1:${port}/api`;
  const browser = { "Content-Type": "application/json", "User-Agent": "Mozilla/5.0 (iPhone) Mobile" };
  const ids = { visitorId: "vabc12345678", sessionId: "sabc12345678" };
  const send = (body, headers = browser) => fetch(`${base}/events`, { method: "POST", headers, body: JSON.stringify(body) });

  assert.equal((await send({ type: "page_view", ...ids, path: "/deal/B012345678", source: "pinterest" })).status, 204);
  assert.equal((await send({ type: "product_view", ...ids, path: "/deal/B012345678", asin: "B012345678", source: "pinterest" })).status, 204);
  await send({ type: "page_view", ...ids, path: "/" }, { ...browser, "User-Agent": "Pinterestbot/1.0" });  // dropped
  const redirect = await fetch(`${base}/go/B012345678?src=pinterest&vid=${ids.visitorId}&sid=${ids.sessionId}`, { redirect: "manual" });
  assert.equal(redirect.status, 302);

  assert.equal((await fetch(`${base}/analytics/visitors`)).status, 401);
  const token = jwt.sign({ id: "test-admin" }, "test-secret");
  const response = await fetch(`${base}/analytics/visitors?days=7`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.totals.sessions, 1);
  assert.equal(data.totals.amazonClicks, 1);
  const session = data.sessions[0];
  assert.equal(session.source, "pinterest");
  assert.equal(session.device, "mobile");
  assert.deepEqual(session.timeline.map((e) => e.type), ["page_view", "product_view", "amazon_click"]);
  assert.deepEqual(data.topProducts[0], { asin: "B012345678", title: "Arched mirror", views: 1, amazonClicks: 1 });
  const stored = JSON.parse(fs.readFileSync(path.join(dir, "visits.json"), "utf8"));
  assert.equal(stored.length, 2);
  assert.equal(JSON.stringify(stored).includes("Mozilla"), false);  // raw user agent is not stored with visits
});

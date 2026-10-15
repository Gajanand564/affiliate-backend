const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { spawn } = require("node:child_process");

test("MongoDB event writes and counters use individual document operations", async () => {
  const calls = [];
  const collection = {
    insertOne: async (record) => calls.push(["insert", record]),
    updateOne: async (filter, update) => calls.push(["update", filter, update]),
    deleteOne: async (filter) => calls.push(["delete", filter]),
  };
  class MongoClient {
    async connect() { return this; }
    db() { return { collection: () => collection }; }
  }
  const context = {
    require: (name) => name === "mongodb" ? { MongoClient } : require(name),
    process: { env: { MONGODB_URI: "mongodb://test" } },
    __dirname, module: { exports: {} },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "db.js"), "utf8"), context);
  const db = context.module.exports;
  await db.append("clicks.json", { id: "event-1" });
  await db.increment("deals.json", "deal-1", "clicks", { lastClickedAt: "now" });
  await db.remove("subscribers.json", "subscriber-1");
  assert.equal(calls[0][0], "insert");
  assert.equal(calls[1][1].id, "deal-1");
  assert.equal(calls[1][2].$inc.clicks, 1);
  assert.equal(calls[1][2].$set.lastClickedAt, "now");
  assert.equal(calls[2][0], "delete");
});

test("concurrent subscriptions and clicks persist without losing records", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dealzone-tracking-"));
  fs.writeFileSync(path.join(dir, "users.json"), JSON.stringify([{ id: "test-admin" }]));
  fs.writeFileSync(path.join(dir, "deals.json"), JSON.stringify([
    { id: "test-deal", asin: "B012345678", affiliateUrl: "https://www.amazon.com/dp/B012345678", clicks: 0 },
  ]));
  const port = 19000 + Math.floor(Math.random() * 10000);
  const child = spawn(process.execPath, [path.join(__dirname, "server.js")], {
    env: { ...process.env, VERCEL: "", MONGODB_URI: "", PORT: String(port), DATA_DIR: dir, UPLOADS_DIR: path.join(dir, "uploads") },
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
    child.once("error", reject);
    child.once("exit", (code) => { if (code) reject(new Error(`Server exited ${code}`)); });
  });
  const base = `http://127.0.0.1:${port}/api`;
  const subscriptions = await Promise.all(Array.from({ length: 40 }, (_, i) => fetch(`${base}/subscribers`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: `person${i}@example.com` }),
  })));
  assert.ok(subscriptions.every((response) => response.status === 201));
  const clicks = await Promise.all(Array.from({ length: 40 }, () => fetch(`${base}/deals/test-deal/track-click`, { method: "POST" })));
  assert.ok(clicks.every((response) => response.status === 200));
  const read = (file) => JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
  assert.equal(read("subscribers.json").length, 40);
  assert.equal(read("clicks.json").length, 40);
  assert.equal(read("deals.json")[0].clicks, 40);
  const redirect = await fetch(`${base}/go/B012345678?src=pinterest`, { redirect: "manual" });
  assert.equal(redirect.status, 302);
  assert.match(redirect.headers.get("location"), /tag=budgethome0f3-20/);
  assert.equal(read("clicks.json").length, 41);
  assert.equal(read("clicks.json")[40].source, "pinterest");
});

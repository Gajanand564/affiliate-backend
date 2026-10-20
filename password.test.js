const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

test("admin can replace the default password; wrong or weak passwords are rejected", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dealzone-password-"));
  const port = 19000 + Math.floor(Math.random() * 10000);
  const child = spawn(process.execPath, [path.join(__dirname, "server.js")], {
    env: { ...process.env, VERCEL: "", MONGODB_URI: "", PORT: String(port), DATA_DIR: dir, UPLOADS_DIR: path.join(dir, "uploads"), JWT_SECRET: "pw-secret" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(async () => {
    if (child.exitCode === null) { const closed = new Promise((r) => child.once("exit", r)); child.kill(); await closed; }
    fs.rmSync(dir, { recursive: true, force: true });
  });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Server did not start")), 10000);
    child.stdout.on("data", () => { clearTimeout(timeout); resolve(); });
  });
  const base = `http://127.0.0.1:${port}/api`;
  const post = (url, body, token) => fetch(base + url, { method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  const login = async (password) => post("/auth/login", { username: "admin", password });
  for (let i = 0; i < 50 && !(await login("admin123")).ok; i++) await new Promise((r) => setTimeout(r, 100));  // wait for seed
  const { token } = await (await login("admin123")).json();
  assert.equal((await post("/auth/password", { currentPassword: "admin123", newPassword: "N3w-strong-pass!" })).status, 401);  // no token
  assert.equal((await post("/auth/password", { currentPassword: "wrong", newPassword: "N3w-strong-pass!" }, token)).status, 401);
  assert.equal((await post("/auth/password", { currentPassword: "admin123", newPassword: "short" }, token)).status, 400);
  assert.equal((await post("/auth/password", { currentPassword: "admin123", newPassword: "N3w-strong-pass!" }, token)).status, 200);
  assert.equal((await login("admin123")).status, 401);
  assert.equal((await login("N3w-strong-pass!")).status, 200);
});

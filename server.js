const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { v4: uuidv4 } = require("uuid");
const fs = require("fs");
const path = require("path");
const multer = require("multer");

const app = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = "dealzone-super-secret-2026";
const AUTOMATION_KEY = process.env.AUTOMATION_KEY || "dealzone-automation-2026";
// DATA_DIR/UPLOADS_DIR are overridable so a deployed instance can point
// them at a mounted persistent volume (e.g. Fly.io) instead of the
// container's own ephemeral filesystem.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, "uploads");

// Create data/uploads dirs if missing
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// Multer config — save to /uploads with original extension
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${uuidv4()}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
  fileFilter: (req, file, cb) => {
    const allowed = [".jpg", ".jpeg", ".png", ".webp", ".gif"];
    if (allowed.includes(path.extname(file.originalname).toLowerCase())) cb(null, true);
    else cb(new Error("Only images allowed"));
  },
});

app.use(cors("*"));
app.use(express.json());

// Serve uploaded images as static files
app.use("/uploads", express.static(UPLOADS_DIR));

// ─── File helpers ────────────────────────────────────────
const read = (file) => {
  const p = path.join(DATA_DIR, file);
  if (!fs.existsSync(p)) return [];
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return []; }
};
const write = (file, data) =>
  fs.writeFileSync(path.join(DATA_DIR, file), JSON.stringify(data, null, 2));

// ─── Auth middleware ──────────────────────────────────────
const auth = (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "No token" });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
};

// ─── Startup: seed data ───────────────────────────────────
async function initData() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  // Admin user
  const users = read("users.json");
  if (users.length === 0) {
    const hash = await bcrypt.hash("admin123", 10);
    write("users.json", [{ id: "1", name: "Admin User", username: "admin", password: hash, role: "admin", initials: "AD" }]);
    console.log("✅ Admin created  →  username: admin  |  password: admin123");
  }

  // Seed deals
  if (read("deals.json").length === 0) {
    write("deals.json", SEED_DEALS);
    console.log("✅ Deals seeded");
  }

  // Seed categories
  if (read("categories.json").length === 0) {
    write("categories.json", SEED_CATEGORIES);
    console.log("✅ Categories seeded");
  }

  // Empty subscribers
  if (!fs.existsSync(path.join(DATA_DIR, "subscribers.json")))
    write("subscribers.json", []);
}

// ═══════════════════════════════════════════════════════════
//  IMAGE UPLOAD ROUTE
// ═══════════════════════════════════════════════════════════
app.post("/api/upload", auth, upload.single("image"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  const url = `/uploads/${req.file.filename}`;
  res.json({ url, filename: req.file.filename });
});

// Delete old image when deal is updated/deleted
app.delete("/api/upload/:filename", auth, (req, res) => {
  const filePath = path.join(UPLOADS_DIR, req.params.filename);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  res.json({ success: true });
});

// ═══════════════════════════════════════════════════════════
//  AUTH ROUTES
// ═══════════════════════════════════════════════════════════
app.post("/api/auth/login", async (req, res) => {
  const { username, password } = req.body;
  const users = read("users.json");
  const user = users.find((u) => u.username === username);
  if (!user) return res.status(401).json({ error: "Invalid credentials" });
  const ok = await bcrypt.compare(password, user.password);
  if (!ok) return res.status(401).json({ error: "Invalid credentials" });
  const token = jwt.sign({ id: user.id, name: user.name, role: user.role, initials: user.initials }, JWT_SECRET, { expiresIn: "7d" });
  res.json({ token, user: { id: user.id, name: user.name, role: user.role, initials: user.initials } });
});

app.get("/api/auth/me", auth, (req, res) => res.json(req.user));

// ═══════════════════════════════════════════════════════════
//  DEALS ROUTES
// ═══════════════════════════════════════════════════════════
app.get("/api/deals", (req, res) => {
  let deals = read("deals.json");
  const { category, featured, active } = req.query;
  if (category && category !== "all") deals = deals.filter((d) => d.category === category);
  if (featured === "true") deals = deals.filter((d) => d.featured);
  if (active === "true") deals = deals.filter((d) => d.active !== false);
  res.json(deals);
});

app.post("/api/deals", auth, (req, res) => {
  const deals = read("deals.json");
  const deal = { id: uuidv4(), active: true, createdAt: new Date().toISOString(), ...req.body };
  deals.push(deal);
  write("deals.json", deals);
  res.status(201).json(deal);
});

app.put("/api/deals/:id", auth, (req, res) => {
  const deals = read("deals.json");
  const idx = deals.findIndex((d) => d.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Deal not found" });
  deals[idx] = { ...deals[idx], ...req.body, id: req.params.id, updatedAt: new Date().toISOString() };
  write("deals.json", deals);
  res.json(deals[idx]);
});

app.delete("/api/deals/:id", auth, (req, res) => {
  const deals = read("deals.json");
  const filtered = deals.filter((d) => d.id !== req.params.id);
  if (filtered.length === deals.length) return res.status(404).json({ error: "Deal not found" });
  write("deals.json", filtered);
  res.json({ success: true });
});

// ═══════════════════════════════════════════════════════════
//  AUTOMATION IMPORT ROUTE (pinterest-bot -> live deal)
//  Service-to-service ingestion: a shared key instead of a user JWT, since
//  the bot runs unattended and a 7-day-expiring login token would break it.
// ═══════════════════════════════════════════════════════════
app.post("/api/deals/import", (req, res) => {
  const key = req.headers["x-automation-key"];
  if (key !== AUTOMATION_KEY) return res.status(401).json({ error: "Invalid automation key" });

  const { asin, title, affiliateUrl } = req.body;
  if (!title || !affiliateUrl) return res.status(400).json({ error: "title and affiliateUrl required" });

  const deals = read("deals.json");
  const existing = deals.find((d) => (asin && d.asin === asin) || d.affiliateUrl === affiliateUrl);
  if (existing) return res.status(200).json({ skipped: true, reason: "already imported", deal: existing });

  const {
    desc = "", category = "decor", price = "", original = "",
    rating = 4.5, reviews = 0, image = "", badge = "", discount = "",
    emoji = "🛍️", gradient = "from-cyan-500 to-blue-600", source = "automation",
  } = req.body;

  const deal = {
    id: uuidv4(), asin, title, desc, category, price, original, rating, reviews,
    affiliateUrl, image, badge, discount, emoji, gradient, source,
    featured: false, active: true, createdAt: new Date().toISOString(),
  };
  deals.push(deal);
  write("deals.json", deals);
  res.status(201).json(deal);
});

// ═══════════════════════════════════════════════════════════
//  CATEGORIES ROUTES
// ═══════════════════════════════════════════════════════════
app.get("/api/categories", (req, res) => res.json(read("categories.json")));

app.post("/api/categories", auth, (req, res) => {
  const cats = read("categories.json");
  const cat = { id: uuidv4(), ...req.body, createdAt: new Date().toISOString() };
  cats.push(cat);
  write("categories.json", cats);
  res.status(201).json(cat);
});

app.put("/api/categories/:id", auth, (req, res) => {
  const cats = read("categories.json");
  const idx = cats.findIndex((c) => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Category not found" });
  cats[idx] = { ...cats[idx], ...req.body, id: req.params.id };
  write("categories.json", cats);
  res.json(cats[idx]);
});

app.delete("/api/categories/:id", auth, (req, res) => {
  const cats = read("categories.json");
  write("categories.json", cats.filter((c) => c.id !== req.params.id));
  res.json({ success: true });
});

// ═══════════════════════════════════════════════════════════
//  SUBSCRIBERS ROUTES
// ═══════════════════════════════════════════════════════════
app.get("/api/subscribers", auth, (req, res) => res.json(read("subscribers.json")));

app.post("/api/subscribers", (req, res) => {
  const subs = read("subscribers.json");
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: "Email required" });
  if (subs.find((s) => s.email === email))
    return res.status(409).json({ error: "Already subscribed" });
  const sub = { id: uuidv4(), email, subscribedAt: new Date().toISOString(), active: true };
  subs.push(sub);
  write("subscribers.json", subs);
  res.status(201).json(sub);
});

app.delete("/api/subscribers/:id", auth, (req, res) => {
  const subs = read("subscribers.json");
  write("subscribers.json", subs.filter((s) => s.id !== req.params.id));
  res.json({ success: true });
});

// ═══════════════════════════════════════════════════════════
//  STATS ROUTE
// ═══════════════════════════════════════════════════════════
app.get("/api/stats", auth, (req, res) => {
  const deals = read("deals.json");
  const cats = read("categories.json");
  const subs = read("subscribers.json");
  res.json({
    totalDeals: deals.length,
    activeDeals: deals.filter((d) => d.active !== false).length,
    featuredDeals: deals.filter((d) => d.featured).length,
    totalCategories: cats.length,
    totalSubscribers: subs.length,
    newSubscribers: subs.filter((s) => {
      const d = new Date(s.subscribedAt);
      return Date.now() - d.getTime() < 7 * 24 * 60 * 60 * 1000;
    }).length,
    dealsByCategory: cats.map((c) => ({
      name: c.name,
      icon: c.icon,
      count: deals.filter((d) => d.category === c.id).length,
    })),
  });
});

// ═══════════════════════════════════════════════════════════
//  SEED DATA
// ═══════════════════════════════════════════════════════════
const SEED_CATEGORIES = [
  { id: "decor", name: "Home Decor", icon: "🖼️" },
];

// No static seed deals — this site runs entirely on products the
// pinterest-bot pipeline posts (see /api/deals/import). Deals only ever
// come from that automation, never hand-written placeholder data.
const SEED_DEALS = [];

// ─── Start server ─────────────────────────────────────────
// On Vercel the exported `app` is invoked directly per-request by the
// serverless runtime — app.listen() must not run there (no port to bind,
// and it would keep the function alive instead of returning). Locally /
// on a normal host, initData() seeds default data, then the app listens.
//
// IMPORTANT (see README-VERCEL.md): Vercel's filesystem is read-only
// except /tmp, and /tmp is wiped on every cold start. initData() re-seeds
// on each cold start, so deals/admin-panel changes will NOT persist
// reliably when deployed this way — this is a platform limitation, not a
// bug here. Fine for a quick test; not fine for the pinterest-bot's
// auto-sync to actually stick. Fix: move data/*.json storage to an
// external database (see README-VERCEL.md).
if (process.env.VERCEL) {
  // initData() is re-run once per cold start (see comment above) — cached
  // per warm container so it doesn't re-seed on every single request.
  let ready = null;
  module.exports = (req, res) => {
    if (!ready) ready = initData();
    ready.then(() => app(req, res));
  };
} else {
  initData().then(() => {
    app.listen(PORT, () => {
      console.log(`\n🚀 DealZone API running on http://localhost:${PORT}`);
      console.log(`📊 Admin login → username: admin | password: admin123\n`);
    });
  });
  module.exports = app;
}

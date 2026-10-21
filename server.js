const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { v4: uuidv4 } = require("uuid");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const { read, write, append, increment, remove, upsert } = require("./db");

const app = express();
const PORT = process.env.PORT || 3001;
// Set JWT_SECRET in the hosting environment; the fallback keeps existing sessions working until then.
const JWT_SECRET = process.env.JWT_SECRET || "dealzone-super-secret-2026";
const AUTOMATION_KEY = process.env.AUTOMATION_KEY || "dealzone-automation-2026";
const AMAZON_AFFILIATE_TAG = process.env.AMAZON_AFFILIATE_TAG || "budgethome0f3-20";
// UPLOADS_DIR is overridable so a deployed instance can point it at a
// mounted persistent volume (e.g. Fly.io) instead of the container's own
// ephemeral filesystem. On Vercel this still isn't persistent (only /tmp
// is writable there, and it's wiped every cold start) — uploaded images
// aren't covered by the MongoDB backend in db.js, only deals/categories/
// subscribers/users are.
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, "uploads");

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
  // Admin user
  const users = await read("users.json");
  if (users.length === 0) {
    const hash = await bcrypt.hash("admin123", 10);
    await write("users.json", [{ id: "1", name: "Admin User", username: "admin", password: hash, role: "admin", initials: "AD" }]);
    console.log("✅ Admin created  →  username: admin  |  password: admin123");
  }

  // Seed deals
  if ((await read("deals.json")).length === 0) {
    await write("deals.json", SEED_DEALS);
    console.log("✅ Deals seeded");
  }

  // Seed or merge categories. Deployed MongoDB instances may already have the
  // original categories, so keep existing records and add any new seed ids.
  const categories = await read("categories.json");
  if (categories.length === 0) {
    await write("categories.json", SEED_CATEGORIES);
    console.log("✅ Categories seeded");
  } else {
    const existingIds = new Set(categories.map((c) => c.id));
    const missing = SEED_CATEGORIES.filter((c) => !existingIds.has(c.id));
    if (missing.length) {
      await write("categories.json", [...categories, ...missing]);
      console.log(`✅ Added ${missing.length} missing categories`);
    }
  }
}

// ═══════════════════════════════════════════════════════════
//  IMAGE UPLOAD ROUTE
// ═══════════════════════════════════════════════════════════
const { trafficSummary, productTrafficSummary } = require('./traffic-summary');
const { sanitizeVisitEvent, journeys } = require('./visitor-analytics');

function normalizeAffiliateUrl(url) {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    if (!/amazon\./i.test(parsed.hostname)) return url;
    parsed.searchParams.set("tag", AMAZON_AFFILIATE_TAG);
    return parsed.toString();
  } catch {
    return url;
  }
}

function publicDeal(deal) {
  return { ...deal, affiliateUrl: normalizeAffiliateUrl(deal.affiliateUrl) };
}

async function trackDealClick(req, deal, source = "site") {
  const event = {
    id: uuidv4(),
    dealId: deal.id,
    asin: deal.asin,
    source,
    src: req.query.src || "",
    medium: req.query.utm_medium || req.query.medium || "",
    campaign: req.query.utm_campaign || req.query.campaign || "",
    content: req.query.utm_content || req.query.content || "",
    country: process.env.VERCEL && /^[A-Z]{2}$/.test(req.get("x-vercel-ip-country") || "")
      ? req.get("x-vercel-ip-country") : "",
    referrer: req.get("referer") || "",
    userAgent: req.get("user-agent") || "",
    // Anonymous browser IDs join this click to its visit journey.
    visitorId: /^[a-z0-9]{8,40}$/.test(req.query.vid || "") ? req.query.vid : "",
    sessionId: /^[a-z0-9]{8,40}$/.test(req.query.sid || "") ? req.query.sid : "",
    clickedAt: new Date().toISOString(),
  };
  await append("clicks.json", event);
  await increment("deals.json", deal.id, "clicks", { lastClickedAt: event.clickedAt });
  return event;
}

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
  const users = await read("users.json");
  const user = users.find((u) => u.username === username);
  if (!user) return res.status(401).json({ error: "Invalid credentials" });
  const ok = await bcrypt.compare(password, user.password);
  if (!ok) return res.status(401).json({ error: "Invalid credentials" });
  const token = jwt.sign({ id: user.id, name: user.name, role: user.role, initials: user.initials }, JWT_SECRET, { expiresIn: "7d" });
  res.json({ token, user: { id: user.id, name: user.name, role: user.role, initials: user.initials } });
});

app.get("/api/auth/me", auth, (req, res) => res.json(req.user));

// Change the signed-in admin's password (the seeded default must be replaced).
app.post("/api/auth/password", auth, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (typeof newPassword !== "string" || newPassword.length < 12 || newPassword === "admin123") {
    return res.status(400).json({ error: "New password must be at least 12 characters" });
  }
  const users = await read("users.json");
  const user = users.find((u) => u.id === req.user.id);
  if (!user || !(await bcrypt.compare(String(currentPassword || ""), user.password))) {
    return res.status(401).json({ error: "Current password is incorrect" });
  }
  await upsert("users.json", { ...user, password: await bcrypt.hash(newPassword, 10), passwordChangedAt: new Date().toISOString() });
  res.json({ success: true });
});

// ═══════════════════════════════════════════════════════════
//  DEALS ROUTES
// ═══════════════════════════════════════════════════════════
// Public catalog reads may be served from the CDN for a few minutes; signed-in
// admin requests (Authorization header) are not cached by Vercel.
function publicCache(res) {
  res.setHeader("Cache-Control", "public, max-age=60, s-maxage=300, stale-while-revalidate=86400");
}

app.get("/api/deals", async (req, res) => {
  let deals = await read("deals.json");
  const { category, featured, active, asins, limit, exclude } = req.query;
  if (category && category !== "all") deals = deals.filter((d) => d.category === category);
  if (featured === "true") deals = deals.filter((d) => d.featured);
  if (active === "true") deals = deals.filter((d) => d.active !== false);
  if (asins) {
    const wanted = new Set(String(asins).toUpperCase().split(",").filter((a) => /^[A-Z0-9]{10}$/.test(a)).slice(0, 60));
    deals = deals.filter((d) => wanted.has(String(d.asin || "").toUpperCase()));
  }
  if (exclude) deals = deals.filter((d) => d.id !== exclude && d.asin !== exclude);
  const max = parseInt(limit, 10);
  if (max > 0) deals = deals.slice(0, Math.min(max, 200));
  if (!req.headers.authorization) publicCache(res);
  res.json(deals.map(publicDeal));
});

app.get("/api/deals/asin/:asin", async (req, res) => {
  const asin = String(req.params.asin || "").trim().toUpperCase();
  const deals = await read("deals.json");
  const deal = deals.find((d) => String(d.asin || "").toUpperCase() === asin);
  if (!deal) return res.status(404).json({ error: "Deal not found" });
  publicCache(res);
  res.json(publicDeal(deal));
});

app.post("/api/deals/:id/track-click", async (req, res) => {
  const deals = await read("deals.json");
  const deal = deals.find((d) => d.id === req.params.id);
  if (!deal) return res.status(404).json({ error: "Deal not found" });
  const event = await trackDealClick(req, deal, "site-card");
  res.json({ success: true, eventId: event.id });
});

app.post("/api/deals/asin/:asin/track-click", async (req, res) => {
  const asin = String(req.params.asin || "").trim().toUpperCase();
  const deals = await read("deals.json");
  const deal = deals.find((d) => String(d.asin || "").toUpperCase() === asin);
  if (!deal) return res.status(404).json({ error: "Deal not found" });
  const event = await trackDealClick(req, deal, "site-detail");
  res.json({ success: true, eventId: event.id });
});

app.get("/api/go/:asin", async (req, res) => {
  const asin = String(req.params.asin || "").trim().toUpperCase();
  const deals = await read("deals.json");
  const deal = deals.find((d) => String(d.asin || "").toUpperCase() === asin);
  if (!deal) return res.status(404).send("Deal not found");
  await trackDealClick(req, deal, req.query.utm_source || req.query.src || "redirect");
  res.redirect(302, normalizeAffiliateUrl(deal.affiliateUrl));
});

app.post("/api/deals", auth, async (req, res) => {
  const deals = await read("deals.json");
  const deal = { id: uuidv4(), active: true, createdAt: new Date().toISOString(), ...req.body };
  deal.affiliateUrl = normalizeAffiliateUrl(deal.affiliateUrl);
  deals.push(deal);
  await write("deals.json", deals);
  res.status(201).json(publicDeal(deal));
});

app.put("/api/deals/:id", auth, async (req, res) => {
  const deals = await read("deals.json");
  const idx = deals.findIndex((d) => d.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Deal not found" });
  deals[idx] = { ...deals[idx], ...req.body, id: req.params.id, updatedAt: new Date().toISOString() };
  deals[idx].affiliateUrl = normalizeAffiliateUrl(deals[idx].affiliateUrl);
  await write("deals.json", deals);
  res.json(publicDeal(deals[idx]));
});

app.delete("/api/deals/:id", auth, async (req, res) => {
  const deals = await read("deals.json");
  const filtered = deals.filter((d) => d.id !== req.params.id);
  if (filtered.length === deals.length) return res.status(404).json({ error: "Deal not found" });
  await write("deals.json", filtered);
  res.json({ success: true });
});

// ═══════════════════════════════════════════════════════════
//  AUTOMATION IMPORT ROUTE (pinterest-bot -> live deal)
//  Service-to-service ingestion: a shared key instead of a user JWT, since
//  the bot runs unattended and a 7-day-expiring login token would break it.
// ═══════════════════════════════════════════════════════════
app.post("/api/deals/import", async (req, res) => {
  const key = req.headers["x-automation-key"];
  if (key !== AUTOMATION_KEY) return res.status(401).json({ error: "Invalid automation key" });

  const { asin, title, affiliateUrl } = req.body;
  if (!title || !affiliateUrl) return res.status(400).json({ error: "title and affiliateUrl required" });

  const deals = await read("deals.json");
  const normalizedAffiliateUrl = normalizeAffiliateUrl(affiliateUrl);
  const existing = deals.find((d) => (asin && d.asin === asin) || normalizeAffiliateUrl(d.affiliateUrl) === normalizedAffiliateUrl);
  if (existing) return res.status(200).json({ skipped: true, reason: "already imported", deal: publicDeal(existing) });

  const {
    desc = "", category = "decor", price = "", original = "",
    rating = 4.5, reviews = 0, image = "", badge = "", discount = "",
    emoji = "🛍️", gradient = "from-cyan-500 to-blue-600", source = "automation",
  } = req.body;

  const deal = {
    id: uuidv4(), asin, title, desc, category, price, original, rating, reviews,
    affiliateUrl: normalizedAffiliateUrl, image, badge, discount, emoji, gradient, source,
    featured: false, active: true, createdAt: new Date().toISOString(),
  };
  deals.push(deal);
  await write("deals.json", deals);
  res.status(201).json(publicDeal(deal));
});

// ═══════════════════════════════════════════════════════════
//  CATEGORIES ROUTES
// ═══════════════════════════════════════════════════════════
// Anonymous visit events (page and product views) for the admin journeys dashboard.
app.post('/api/events', async (req, res) => {
  const event = sanitizeVisitEvent(req.body, {
    userAgent: req.get('user-agent') || '',
    country: process.env.VERCEL ? (req.get('x-vercel-ip-country') || '') : '',
  });
  if (event) await append('visits.json', event);
  res.status(204).end();
});

app.get('/api/analytics/visitors', auth, async (req, res) => {
  const days = Math.min(Math.max(parseInt(req.query.days, 10) || 7, 1), 90);
  const [visits, clicks, deals] = await Promise.all([read('visits.json'), read('clicks.json'), read('deals.json')]);
  res.json(journeys(visits, clicks, deals, { days }));
});

app.get('/api/growth-summary', async (req, res) => {
  if (req.headers['x-automation-key'] !== AUTOMATION_KEY) return res.status(401).json({ error: 'Invalid automation key' });
  const clicks = await read('clicks.json');
  res.set('Cache-Control', 'no-store');
  res.json({ collectedAt: new Date().toISOString(), periodDays: 7,
    measurement: 'Outbound Amazon click events, not unique visitors, reach or sales',
    channels: trafficSummary(clicks), products: productTrafficSummary(clicks) });
});

app.get('/api/social-posts', async (req, res) => {
  publicCache(res);
  const records = await read('social_posts.json');
  const groups = new Map();
  for (const post of [...records].sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)))) {
    if (!groups.has(post.asin)) groups.set(post.asin, { asin: post.asin, title: post.title, tip: post.tip, publishedAt: post.publishedAt });
    groups.get(post.asin)[post.platform] = post.permalink;
  }
  res.json([...groups.values()].slice(0, 30));
});

app.post('/api/social-posts/import', async (req, res) => {
  if (req.headers['x-automation-key'] !== AUTOMATION_KEY) return res.status(401).json({ error: 'Invalid automation key' });
  const { platform, asin, publishedId, permalink, title, tip, publishedAt } = req.body;
  const allowed = { instagram: ['www.instagram.com', 'instagram.com'], facebook: ['www.facebook.com', 'facebook.com'] };
  let validLink = false;
  try { const url = new URL(permalink); validLink = url.protocol === 'https:' && allowed[platform]?.includes(url.hostname); } catch { /* invalid URL */ }
  if (!validLink || !/^[A-Z0-9]{10}$/.test(asin || '') || !/^[0-9_]{5,80}$/.test(publishedId || '') || typeof title !== 'string' || !title.trim() || !Number.isFinite(Date.parse(publishedAt))) {
    return res.status(400).json({ error: 'Valid published social post fields required' });
  }
  const deals = await read('deals.json');
  if (!deals.some((deal) => deal.asin === asin && deal.active !== false)) return res.status(400).json({ error: 'Active catalog product required' });
  const record = { id: `${platform}:${publishedId}`, platform, asin, publishedId, permalink,
    title: title.slice(0, 180), tip: typeof tip === 'string' ? tip.slice(0, 600) : '', publishedAt };
  await upsert('social_posts.json', record);
  res.json({ synced: true, id: record.id });
});

app.get("/api/categories", async (req, res) => res.json(await read("categories.json")));

app.post("/api/categories", auth, async (req, res) => {
  const cats = await read("categories.json");
  const cat = { id: uuidv4(), ...req.body, createdAt: new Date().toISOString() };
  cats.push(cat);
  await write("categories.json", cats);
  res.status(201).json(cat);
});

app.put("/api/categories/:id", auth, async (req, res) => {
  const cats = await read("categories.json");
  const idx = cats.findIndex((c) => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Category not found" });
  cats[idx] = { ...cats[idx], ...req.body, id: req.params.id };
  await write("categories.json", cats);
  res.json(cats[idx]);
});

app.delete("/api/categories/:id", auth, async (req, res) => {
  const cats = await read("categories.json");
  await write("categories.json", cats.filter((c) => c.id !== req.params.id));
  res.json({ success: true });
});

// ═══════════════════════════════════════════════════════════
//  SUBSCRIBERS ROUTES
// ═══════════════════════════════════════════════════════════
app.get("/api/subscribers", auth, async (req, res) => res.json(await read("subscribers.json")));

app.post("/api/subscribers", async (req, res) => {
  const subs = await read("subscribers.json");
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: "Email required" });
  if (subs.find((s) => s.email === email))
    return res.status(409).json({ error: "Already subscribed" });
  const sub = { id: uuidv4(), email, subscribedAt: new Date().toISOString(), active: true };
  await append("subscribers.json", sub);
  res.status(201).json(sub);
});

app.delete("/api/subscribers/:id", auth, async (req, res) => {
  await remove("subscribers.json", req.params.id);
  res.json({ success: true });
});

// ═══════════════════════════════════════════════════════════
//  STATS ROUTE
// ═══════════════════════════════════════════════════════════
app.get("/api/stats", auth, async (req, res) => {
  const deals = await read("deals.json");
  const cats = await read("categories.json");
  const subs = await read("subscribers.json");
  const clicks = await read("clicks.json");
  res.json({
    totalDeals: deals.length,
    activeDeals: deals.filter((d) => d.active !== false).length,
    featuredDeals: deals.filter((d) => d.featured).length,
    totalClicks: clicks.length,
    trafficLast7Days: trafficSummary(clicks),
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
  { id: "wall-decor", name: "Wall Decor", icon: "🖼️" },
  { id: "lighting", name: "Lighting", icon: "💡" },
  { id: "bathroom", name: "Bathroom", icon: "🪞" },
  { id: "kitchen", name: "Kitchen", icon: "🍳" },
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
// Persistence: db.js picks MongoDB when MONGODB_URI is set (required on
// Vercel — its filesystem is read-only outside /tmp, and /tmp is wiped
// every cold start) or local JSON files otherwise. See README-VERCEL.md.
if (process.env.VERCEL) {
  // initData() is re-run once per cold start — cached per warm container
  // (and effectively a no-op after the first request once MongoDB already
  // has data, since the seed checks are "only if empty").
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

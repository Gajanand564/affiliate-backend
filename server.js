const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { v4: uuidv4 } = require("uuid");
const fs = require("fs");
const path = require("path");
const multer = require("multer");

const app = express();
const PORT = 3001;
const JWT_SECRET = "dealzone-super-secret-2026";
const DATA_DIR = path.join(__dirname, "data");
const UPLOADS_DIR = path.join(__dirname, "uploads");

// Create uploads dir if missing
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
  { id: "tech",    name: "Tech",    icon: "💻" },
  { id: "gaming",  name: "Gaming",  icon: "🎮" },
  { id: "fashion", name: "Fashion", icon: "👗" },
  { id: "health",  name: "Health",  icon: "💊" },
  { id: "home",    name: "Home",    icon: "🏠" },
  { id: "travel",  name: "Travel",  icon: "✈️" },
  { id: "books",   name: "Books",   icon: "📚" },
  { id: "food",    name: "Food",    icon: "🍔" },
];

const SEED_DEALS = [
  { id: uuidv4(), title: "Apple AirPods Pro (2nd Gen)", desc: "Industry-leading noise cancellation, 30-hour total battery life.", category: "tech", emoji: "🎧", badge: "🔥 HOT", discount: "20% OFF", price: "$189", original: "$249", rating: 4.8, reviews: 12840, featured: true, active: true, affiliateUrl: "https://www.amazon.com/dp/B0BDHWDR12", gradient: "from-purple-500 to-blue-500", createdAt: new Date().toISOString() },
  { id: uuidv4(), title: "Samsung 49\" Ultrawide Monitor", desc: "DQHD display with 240Hz refresh rate — perfect for gaming and productivity.", category: "tech", emoji: "🖥️", badge: "✨ NEW", discount: "15% OFF", price: "$849", original: "$999", rating: 4.7, reviews: 5320, featured: true, active: true, affiliateUrl: "https://www.amazon.com/dp/B0CKBR1K77", gradient: "from-cyan-500 to-blue-600", createdAt: new Date().toISOString() },
  { id: uuidv4(), title: "Logitech MX Master 3S Mouse", desc: "8000 DPI sensor, whisper-quiet clicks, USB-C charging.", category: "tech", emoji: "🖱️", badge: null, discount: "10% OFF", price: "$89", original: "$99", rating: 4.9, reviews: 9210, featured: false, active: true, affiliateUrl: "https://www.amazon.com/dp/B09HM94VDS", gradient: "from-indigo-500 to-purple-600", createdAt: new Date().toISOString() },
  { id: uuidv4(), title: "PlayStation 5 Console Bundle", desc: "Next-gen gaming with ultra-fast SSD and DualSense haptic controller.", category: "gaming", emoji: "🎮", badge: "🔥 HOT", discount: "Bundle Deal", price: "$499", original: "$549", rating: 4.9, reviews: 34500, featured: true, active: true, affiliateUrl: "https://www.amazon.com/dp/B0BCNKKZ91", gradient: "from-blue-600 to-indigo-700", createdAt: new Date().toISOString() },
  { id: uuidv4(), title: "Razer BlackShark V2 Pro Headset", desc: "Wireless 70-hour battery, THX Spatial Audio, crystal-clear mic.", category: "gaming", emoji: "🎧", badge: null, discount: "25% OFF", price: "$149", original: "$199", rating: 4.5, reviews: 7830, featured: false, active: true, affiliateUrl: "https://www.amazon.com/dp/B0CH2WLMKM", gradient: "from-green-500 to-teal-600", createdAt: new Date().toISOString() },
  { id: uuidv4(), title: "Nike Air Max 270 Running Shoes", desc: "Lightweight foam midsole with 270° Air unit. Style meets comfort.", category: "fashion", emoji: "👟", badge: "🏷️ SALE", discount: "30% OFF", price: "$99", original: "$140", rating: 4.4, reviews: 21000, featured: false, active: true, affiliateUrl: "https://www.amazon.com/dp/B07CKMHVHK", gradient: "from-orange-500 to-red-500", createdAt: new Date().toISOString() },
  { id: uuidv4(), title: "Fitbit Charge 6 Fitness Tracker", desc: "Built-in GPS, heart rate, 7-day battery life, Google integration.", category: "health", emoji: "⌚", badge: "✨ NEW", discount: "18% OFF", price: "$129", original: "$159", rating: 4.6, reviews: 6720, featured: true, active: true, affiliateUrl: "https://www.amazon.com/dp/B0CCT8DHGQ", gradient: "from-emerald-500 to-green-600", createdAt: new Date().toISOString() },
  { id: uuidv4(), title: "Dyson V15 Detect Cordless Vacuum", desc: "Laser dust detection, powerful suction, 60-minute battery.", category: "home", emoji: "🧹", badge: "⭐ TOP PICK", discount: "12% OFF", price: "$649", original: "$749", rating: 4.7, reviews: 8900, featured: false, active: true, affiliateUrl: "https://www.amazon.com/dp/B09JQ82YLS", gradient: "from-fuchsia-500 to-purple-600", createdAt: new Date().toISOString() },
  { id: uuidv4(), title: "Atomic Habits – James Clear", desc: "The proven system for building good habits. 15 million copies sold.", category: "books", emoji: "📖", badge: null, discount: "20% OFF", price: "$15", original: "$19", rating: 4.9, reviews: 280000, featured: false, active: true, affiliateUrl: "https://www.amazon.com/dp/0735211299", gradient: "from-amber-500 to-yellow-600", createdAt: new Date().toISOString() },
  { id: uuidv4(), title: "Keurig K-Elite Coffee Maker", desc: "Brew 4–12 oz, iced coffee mode, 75-oz reservoir.", category: "food", emoji: "☕", badge: "🔥 POPULAR", discount: "22% OFF", price: "$139", original: "$179", rating: 4.5, reviews: 29400, featured: false, active: true, affiliateUrl: "https://www.amazon.com/dp/B078NN6XDC", gradient: "from-rose-500 to-red-600", createdAt: new Date().toISOString() },
];

// ─── Start server ─────────────────────────────────────────
initData().then(() => {
  app.listen(PORT, () => {
    console.log(`\n🚀 DealZone API running on http://localhost:${PORT}`);
    console.log(`📊 Admin login → username: admin | password: admin123\n`);
  });
});

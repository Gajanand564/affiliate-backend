/**
 * Storage abstraction with two backends, chosen by whether MONGODB_URI is
 * set:
 *   - Set (e.g. on Vercel)  -> MongoDB. Required there: Vercel's filesystem
 *     is read-only outside /tmp, and /tmp is wiped every cold start, so
 *     local JSON files can't persist data on that platform.
 *   - Unset (local dev, Fly.io, any host with a real disk) -> the original
 *     JSON-file-per-collection behavior, unchanged.
 *
 * Both expose the same read(file)/write(file, data) shape used throughout
 * server.js, so route handlers don't need to know which backend is active.
 */
const fs = require("fs");
const path = require("path");

const MONGODB_URI = process.env.MONGODB_URI || "";
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");

const collectionName = (file) => file.replace(/\.json$/, "");

// ─── MongoDB backend ────────────────────────────────────────
let clientPromise = null;
function getClient() {
  if (!clientPromise) {
    const { MongoClient } = require("mongodb");
    clientPromise = new MongoClient(MONGODB_URI).connect();
  }
  return clientPromise;
}

async function mongoRead(file) {
  const client = await getClient();
  const db = client.db("dealzone");
  return db.collection(collectionName(file)).find({}, { projection: { _id: 0 } }).toArray();
}

async function mongoWrite(file, data) {
  const client = await getClient();
  const db = client.db("dealzone");
  const coll = db.collection(collectionName(file));
  await coll.deleteMany({});
  if (data.length) await coll.insertMany(data);
}

// ─── File backend ───────────────────────────────────────────
function fileRead(file) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const p = path.join(DATA_DIR, file);
  if (!fs.existsSync(p)) return [];
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return []; }
}

function fileWrite(file, data) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(path.join(DATA_DIR, file), JSON.stringify(data, null, 2));
}

// ─── Public API (always async, regardless of backend) ──────
async function read(file) {
  return MONGODB_URI ? mongoRead(file) : fileRead(file);
}

async function write(file, data) {
  return MONGODB_URI ? mongoWrite(file, data) : fileWrite(file, data);
}

module.exports = { read, write };

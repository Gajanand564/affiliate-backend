// Anonymous visitor journeys: which source a visit came from, what it viewed
// and which products it clicked through to Amazon. Visitors are identified only
// by random IDs created in the browser; no names, emails or IP addresses are
// stored. Bots and link-preview crawlers are dropped.

const BOT_UA = /bot|crawl|spider|slurp|headless|lighthouse|preview|facebookexternalhit|pinterest\/|vercel|curl|python|node-fetch|axios/i;
const ID = /^[a-z0-9]{8,40}$/;
const ASIN = /^[A-Z0-9]{10}$/;
const TYPES = new Set(['page_view', 'product_view']);

const clean = (value, max = 80) => String(value || '').trim().toLowerCase().replace(/[^a-z0-9_.\-]/g, '').slice(0, max);

function deviceFrom(userAgent = '') {
  if (/ipad|tablet/i.test(userAgent)) return 'tablet';
  if (/mobi|iphone|android/i.test(userAgent)) return 'mobile';
  return userAgent ? 'desktop' : 'unknown';
}

function referrerHost(referrer) {
  try { return new URL(referrer).hostname.replace(/^www\./, '').slice(0, 80); } catch { return ''; }
}

// Returns a storable event, or null for bots and malformed input.
function sanitizeVisitEvent(body = {}, { userAgent = '', country = '', now = new Date() } = {}) {
  if (!userAgent || BOT_UA.test(userAgent)) return null;
  const type = String(body.type || '');
  const visitorId = String(body.visitorId || '');
  const sessionId = String(body.sessionId || '');
  const path = String(body.path || '');
  if (!TYPES.has(type) || !ID.test(visitorId) || !ID.test(sessionId) || !path.startsWith('/') || path.length > 200) return null;
  const asin = String(body.asin || '').toUpperCase();
  if (type === 'product_view' && !ASIN.test(asin)) return null;
  return {
    type, visitorId, sessionId, path: path.split('?')[0],
    asin: ASIN.test(asin) ? asin : '',
    source: clean(body.source, 40), medium: clean(body.medium, 40),
    campaign: clean(body.campaign), content: clean(body.content),
    referrerHost: referrerHost(body.referrer),
    device: deviceFrom(userAgent),
    country: /^[A-Z]{2}$/.test(country) ? country : '',
    at: now.toISOString(),
  };
}

function sourceOf(item) {
  return item.source || item.src || (item.referrerHost ? `ref:${item.referrerHost}` : 'direct');
}

function journeys(visits, clicks, deals = [], { days = 7, now = Date.now(), limit = 200 } = {}) {
  const since = now - days * 24 * 60 * 60 * 1000;
  const inWindow = (stamp) => { const t = Date.parse(stamp); return Number.isFinite(t) && t >= since && t <= now; };
  const titles = new Map(deals.map((d) => [d.asin, d.title]));
  const sessions = new Map();
  const touch = (id, visitorId) => {
    if (!sessions.has(id)) sessions.set(id, { sessionId: id, visitorId, start: null, end: null, source: '', medium: '',
      campaign: '', landing: '', country: '', device: '', pageViews: 0, productsViewed: [], amazonClicks: [], timeline: [] });
    return sessions.get(id);
  };
  const recentVisits = visits.filter((v) => inWindow(v.at)).sort((a, b) => a.at.localeCompare(b.at));
  for (const v of recentVisits) {
    const s = touch(v.sessionId, v.visitorId);
    s.start = s.start || v.at; s.end = v.at;
    if (!s.source) { s.source = sourceOf(v); s.medium = v.medium; s.campaign = v.campaign; s.landing = v.path; }
    s.country = s.country || v.country; s.device = s.device || v.device;
    if (v.type === 'page_view') s.pageViews++;
    if (v.type === 'product_view' && !s.productsViewed.includes(v.asin)) s.productsViewed.push(v.asin);
    if (s.timeline.length < 50) s.timeline.push({ at: v.at, type: v.type, path: v.path, asin: v.asin });
  }
  const recentClicks = clicks.filter((c) => inWindow(c.clickedAt));
  for (const c of recentClicks) {
    if (!c.sessionId || !sessions.has(c.sessionId)) continue;
    const s = sessions.get(c.sessionId);
    s.amazonClicks.push({ asin: c.asin, at: c.clickedAt });
    s.end = c.clickedAt > s.end ? c.clickedAt : s.end;
    if (s.timeline.length < 50) s.timeline.push({ at: c.clickedAt, type: 'amazon_click', asin: c.asin });
  }
  const list = [...sessions.values()];
  for (const s of list) s.timeline.sort((a, b) => a.at.localeCompare(b.at));

  const bySource = new Map();
  const row = (key) => bySource.get(key) || { source: key, sessions: 0, visitors: new Set(), productViews: 0, amazonClicks: 0 };
  for (const s of list) {
    const r = row(s.source); r.sessions++; r.visitors.add(s.visitorId); r.productViews += s.productsViewed.length;
    bySource.set(s.source, r);
  }
  for (const c of recentClicks) { const r = row(sourceOf(c)); r.amazonClicks++; bySource.set(r.source, r); }

  const byDay = new Map();
  const day = (stamp) => stamp.slice(0, 10);
  for (const s of list) { const d = byDay.get(day(s.start)) || { date: day(s.start), sessions: 0, amazonClicks: 0 }; d.sessions++; byDay.set(d.date, d); }
  for (const c of recentClicks) { const d = byDay.get(day(c.clickedAt)) || { date: day(c.clickedAt), sessions: 0, amazonClicks: 0 }; d.amazonClicks++; byDay.set(d.date, d); }

  const products = new Map();
  const prod = (asin) => products.get(asin) || { asin, title: titles.get(asin) || '', views: 0, amazonClicks: 0 };
  for (const v of recentVisits) if (v.type === 'product_view') { const p = prod(v.asin); p.views++; products.set(v.asin, p); }
  for (const c of recentClicks) if (ASIN.test(c.asin || '')) { const p = prod(c.asin); p.amazonClicks++; products.set(c.asin, p); }

  const count = (key) => {
    const m = new Map();
    for (const s of list) m.set(s[key] || 'unknown', (m.get(s[key] || 'unknown') || 0) + 1);
    return [...m.entries()].map(([name, sessions]) => ({ name, sessions })).sort((a, b) => b.sessions - a.sessions);
  };
  const withClick = list.filter((s) => s.amazonClicks.length).length;
  const withProduct = list.filter((s) => s.productsViewed.length).length;
  return {
    days, generatedAt: new Date(now).toISOString(),
    totals: {
      visitors: new Set(list.map((s) => s.visitorId)).size, sessions: list.length,
      pageViews: recentVisits.filter((v) => v.type === 'page_view').length,
      productViews: recentVisits.filter((v) => v.type === 'product_view').length,
      amazonClicks: recentClicks.length, sessionsWithProductView: withProduct, sessionsWithAmazonClick: withClick,
    },
    bySource: [...bySource.values()].map((r) => ({ ...r, visitors: r.visitors.size })).sort((a, b) => b.sessions - a.sessions || b.amazonClicks - a.amazonClicks),
    byDay: [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date)),
    topProducts: [...products.values()].sort((a, b) => b.amazonClicks - a.amazonClicks || b.views - a.views).slice(0, 25),
    countries: count('country'), devices: count('device'),
    sessions: list.sort((a, b) => b.start.localeCompare(a.start)).slice(0, limit),
  };
}

module.exports = { sanitizeVisitEvent, journeys, deviceFrom };

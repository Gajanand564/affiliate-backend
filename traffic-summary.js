// Crawlers, link checkers and preview fetchers follow /go links like people do
// (2026-11-24: ~2,000 "clicks" in a week, 9 on each of 74 products). They are
// counted separately and never as Amazon clicks.
const BOT_UA = /bot\b|crawl|spider|slurp|scrape|headless|preview|lighthouse|pinterestbot|facebookexternalhit|facebookcatalog|meta-externalagent|google-|googleother|whatsapp|telegram|discord|skype|curl\/|wget|python|axios|node-fetch|undici|go-http|java\/|okhttp|libwww|httpclient|ahrefs|semrush|mj12|petalbot|bytespider|gptbot|claudebot|perplexity|ccbot|amazonbot|applebot|yandex|baidu|duckduck|sogou|seznam|uptime|pingdom|vercel/i;

// Real browsers always send a user agent; an empty one is a script. Events
// without the field at all (very old records) stay counted.
function isBot(userAgent) {
  if (userAgent === undefined) return false;
  const ua = String(userAgent || '').trim();
  return !ua || BOT_UA.test(ua);
}

// Proxy bots with ordinary browser user agents (2026-11-24/25: 221 "clicks"
// in one hour, one or two on each of ~125 products, from JP/CA/BD/TH...).
// People arrive a few a day and a viral pin concentrates on one product, so
// many clicks spread over many products within ten minutes is automated.
const BURST_WINDOW_MS = 10 * 60 * 1000;
const BURST_MIN_CLICKS = 15;
const BURST_MIN_PRODUCTS = 10;

function isBurst(recentClicks) {
  const live = recentClicks.filter((click) => !click.bot && !isBot(click.userAgent));
  return live.length >= BURST_MIN_CLICKS && new Set(live.map((click) => click.asin)).size >= BURST_MIN_PRODUCTS;
}

// IDs of stored clicks that fall in any burst window (also catches bursts
// recorded before live detection existed).
function burstClickIds(clicks) {
  const live = clicks.filter((click) => !click.bot && !isBot(click.userAgent) && Number.isFinite(Date.parse(click.clickedAt)))
    .map((click) => ({ click, time: Date.parse(click.clickedAt) })).sort((a, b) => a.time - b.time);
  const ids = new Set();
  let start = 0;
  for (let end = 0; end < live.length; end++) {
    while (live[end].time - live[start].time > BURST_WINDOW_MS) start++;
    const window = live.slice(start, end + 1).map((item) => item.click);
    if (isBurst(window)) window.forEach((click) => ids.add(click.id));
  }
  return ids;
}

function counted(click, bursts = new Set()) {
  return !click.bot && !click.burst && !isBot(click.userAgent) && !bursts.has(click.id);
}

function trafficSummary(clicks, now = Date.now()) {
  const since = now - 7 * 24 * 60 * 60 * 1000;
  const bursts = burstClickIds(clicks);
  const channels = new Map();
  for (const click of clicks) {
    const time = Date.parse(click.clickedAt);
    if (!Number.isFinite(time) || time < since || time > now || !counted(click, bursts)) continue;
    const source = String(click.source || click.src || 'unknown').slice(0, 120);
    const current = channels.get(source) || { source, amazonClicks: 0, usClicks: 0, unknownCountryClicks: 0 };
    current.amazonClicks++;
    if (click.country === 'US') current.usClicks++;
    if (!click.country) current.unknownCountryClicks++;
    channels.set(source, current);
  }
  return [...channels.values()].sort((a, b) => b.amazonClicks - a.amazonClicks);
}

function productTrafficSummary(clicks, now = Date.now()) {
  const since = now - 7 * 24 * 60 * 60 * 1000;
  const bursts = burstClickIds(clicks);
  const groups = new Map();
  for (const click of clicks) {
    const time = Date.parse(click.clickedAt);
    if (!Number.isFinite(time) || time < since || time > now || !counted(click, bursts) || !/^[A-Z0-9]{10}$/.test(click.asin || '')) continue;
    const source = String(click.source || click.src || 'unknown').slice(0, 120);
    const key = JSON.stringify([source, click.asin]);
    const row = groups.get(key) || { source, asin: click.asin, amazonClicks: 0, usClicks: 0, unknownCountryClicks: 0 };
    row.amazonClicks++;
    if (click.country === 'US') row.usClicks++;
    if (!click.country) row.unknownCountryClicks++;
    groups.set(key, row);
  }
  return [...groups.values()].sort((a, b) => b.amazonClicks - a.amazonClicks);
}


function botClickCount(clicks, now = Date.now()) {
  const since = now - 7 * 24 * 60 * 60 * 1000;
  const bursts = burstClickIds(clicks);
  return clicks.filter((click) => {
    const time = Date.parse(click.clickedAt);
    return Number.isFinite(time) && time >= since && time <= now && !counted(click, bursts);
  }).length;
}

// Shape of counted clicks (2026-11-25: checking a sudden jump to ~110 Amazon
// clicks a day). No IPs or visitor IDs are returned, only aggregate counts.
function clickDiagnostics(clicks, now = Date.now()) {
  const since = now - 7 * 24 * 60 * 60 * 1000;
  const bursts = burstClickIds(clicks);
  const tally = (map, key) => map.set(key, (map.get(key) || 0) + 1);
  const days = new Map(), hours = new Map(), agents = new Map(), referrers = new Map(), countries = new Map(), asinsPerDay = new Map();
  let withVisitor = 0, total = 0;
  for (const click of clicks) {
    const time = Date.parse(click.clickedAt);
    if (!Number.isFinite(time) || time < since || time > now || !counted(click, bursts)) continue;
    total++;
    const day = click.clickedAt.slice(0, 10);
    tally(days, day + ' ' + String(click.source || 'unknown'));
    tally(hours, click.clickedAt.slice(0, 13));
    tally(agents, String(click.userAgent || '').slice(0, 160));
    let ref = '';
    try { ref = click.referrer ? new URL(click.referrer).hostname : ''; } catch { ref = 'invalid'; }
    tally(referrers, ref || '(none)');
    tally(countries, click.country || '(unknown)');
    if (!asinsPerDay.has(day)) asinsPerDay.set(day, new Set());
    asinsPerDay.get(day).add(click.asin);
    if (click.visitorId) withVisitor++;
  }
  const top = (map, n) => [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
  return { total, withVisitorId: withVisitor, byDaySource: top(days, 40), busiestHours: top(hours, 15),
    topUserAgents: top(agents, 12), referrers: top(referrers, 12), countries: top(countries, 12),
    distinctAsinsPerDay: [...asinsPerDay.entries()].map(([d, set]) => [d, set.size]).sort() };
}

module.exports = { trafficSummary, productTrafficSummary, botClickCount, isBot, clickDiagnostics, isBurst, burstClickIds, BURST_WINDOW_MS };

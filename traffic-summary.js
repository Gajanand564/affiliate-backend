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

function counted(click) {
  return !click.bot && !isBot(click.userAgent);
}

function trafficSummary(clicks, now = Date.now()) {
  const since = now - 7 * 24 * 60 * 60 * 1000;
  const channels = new Map();
  for (const click of clicks) {
    const time = Date.parse(click.clickedAt);
    if (!Number.isFinite(time) || time < since || time > now || !counted(click)) continue;
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
  const groups = new Map();
  for (const click of clicks) {
    const time = Date.parse(click.clickedAt);
    if (!Number.isFinite(time) || time < since || time > now || !counted(click) || !/^[A-Z0-9]{10}$/.test(click.asin || '')) continue;
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
  return clicks.filter((click) => {
    const time = Date.parse(click.clickedAt);
    return Number.isFinite(time) && time >= since && time <= now && !counted(click);
  }).length;
}

module.exports = { trafficSummary, productTrafficSummary, botClickCount, isBot };

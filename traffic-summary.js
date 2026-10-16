function trafficSummary(clicks, now = Date.now()) {
  const since = now - 7 * 24 * 60 * 60 * 1000;
  const channels = new Map();
  for (const click of clicks) {
    const time = Date.parse(click.clickedAt);
    if (!Number.isFinite(time) || time < since || time > now) continue;
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
    if (!Number.isFinite(time) || time < since || time > now || !/^[A-Z0-9]{10}$/.test(click.asin || '')) continue;
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

module.exports = { trafficSummary, productTrafficSummary };

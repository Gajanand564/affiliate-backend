const { test } = require('node:test');
const assert = require('node:assert/strict');
const { trafficSummary } = require('./traffic-summary');
const { productTrafficSummary } = require('./traffic-summary');

test('product summaries aggregate source and ASIN without leaking raw event metadata', () => {
  const now = Date.parse('2026-10-16T00:00:00Z');
  const rows = productTrafficSummary([
    { asin: 'B012345678', source: 'facebook', country: 'US', clickedAt: '2026-10-15T12:00:00Z', userAgent: 'private' },
    { asin: 'B012345678', source: 'facebook', clickedAt: '2026-10-15T12:00:00Z' },
    { asin: 'B012345678', source: 'instagram', clickedAt: '2026-10-15T12:00:00Z' },
    { asin: 'B012345678', source: 'facebook', clickedAt: '2026-09-15T12:00:00Z' },
  ], now);
  assert.deepEqual(rows[0], { source: 'facebook', asin: 'B012345678', amazonClicks: 2, usClicks: 1, unknownCountryClicks: 1 });
  assert.equal(rows.length, 2);
  assert.equal(JSON.stringify(rows).includes('private'), false);
});

test('separates outbound clicks by source and country without treating missing geography as US', () => {
  const now = Date.parse('2026-10-16T00:00:00Z');
  const recent = { clickedAt: '2026-10-15T12:00:00Z' };
  const summary = trafficSummary([
    { ...recent, source: 'instagram', country: 'US' },
    { ...recent, source: 'instagram' },
    { ...recent, source: 'facebook', country: 'IN' },
    { ...recent, src: 'pinterest', country: 'US' },
    { source: 'facebook', clickedAt: '2026-10-01T00:00:00Z' },
    { source: 'facebook', clickedAt: 'invalid' },
    { source: 'facebook', clickedAt: '2026-10-17T00:00:00Z' },
  ], now);
  assert.deepEqual(summary[0], { source: 'instagram', amazonClicks: 2, usClicks: 1, unknownCountryClicks: 1 });
  assert.equal(summary.reduce((total, row) => total + row.amazonClicks, 0), 4);
});

test('crawler and link-checker clicks are excluded from Amazon click counts', () => {
  const { botClickCount, isBot } = require('./traffic-summary');
  const now = Date.parse('2026-11-24T00:00:00Z');
  const at = '2026-11-23T12:00:00Z';
  const chrome = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';
  const clicks = [
    { asin: 'B012345678', source: 'site', country: 'US', clickedAt: at, userAgent: chrome },
    { asin: 'B012345678', source: 'site', clickedAt: at, userAgent: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' },
    { asin: 'B012345678', source: 'redirect', clickedAt: at, userAgent: 'Pinterestbot/1.0 (+http://www.pinterest.com/bot.html)' },
    { asin: 'B012345678', source: 'site', clickedAt: at, userAgent: 'Mozilla/5.0 HeadlessChrome/120.0' },
    { asin: 'B012345678', source: 'site', clickedAt: at, userAgent: '' },
    { asin: 'B012345678', source: 'site', clickedAt: at, userAgent: chrome, bot: true },
  ];
  assert.deepEqual(trafficSummary(clicks, now), [{ source: 'site', amazonClicks: 1, usClicks: 1, unknownCountryClicks: 0 }]);
  assert.equal(productTrafficSummary(clicks, now).length, 1);
  assert.equal(botClickCount(clicks, now), 5);
  assert.equal(isBot('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Instagram 300.0'), false);
});

test('people in the Pinterest and Instagram apps are not treated as bots', () => {
  const { isBot } = require('./traffic-summary');
  assert.equal(isBot('Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [Pinterest/iOS]'), false);
  assert.equal(isBot('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36 Pinterest/Android'), false);
  assert.equal(isBot('Mozilla/5.0 (compatible; Pinterestbot/1.0; +http://www.pinterest.com/bot.html)'), true);
});

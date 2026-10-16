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

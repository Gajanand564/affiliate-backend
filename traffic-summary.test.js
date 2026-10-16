const { test } = require('node:test');
const assert = require('node:assert/strict');
const { trafficSummary } = require('./traffic-summary');

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

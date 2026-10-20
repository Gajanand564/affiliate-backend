const { test } = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeVisitEvent, journeys } = require('./visitor-analytics');

const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148';
const ids = { visitorId: 'v1234567890', sessionId: 's1234567890' };

test('visit events are anonymous, validated and bot-free', () => {
  const now = new Date('2026-10-21T10:00:00Z');
  const event = sanitizeVisitEvent({ type: 'product_view', ...ids, path: '/deal/B012345678?utm_source=x', asin: 'b012345678',
    source: 'Pinterest', referrer: 'https://www.pinterest.com/pin/1/', email: 'a@b.c', ip: '1.2.3.4' },
    { userAgent: UA, country: 'US', now });
  assert.deepEqual(event, { type: 'product_view', ...ids, path: '/deal/B012345678', asin: 'B012345678', source: 'pinterest',
    medium: '', campaign: '', content: '', referrerHost: 'pinterest.com', device: 'mobile', country: 'US', at: now.toISOString() });
  assert.equal(sanitizeVisitEvent({ type: 'page_view', ...ids, path: '/' }, { userAgent: 'Pinterestbot/1.0' }), null);
  assert.equal(sanitizeVisitEvent({ type: 'page_view', ...ids, path: '/' }, { userAgent: '' }), null);
  assert.equal(sanitizeVisitEvent({ type: 'login', ...ids, path: '/' }, { userAgent: UA }), null);
  assert.equal(sanitizeVisitEvent({ type: 'page_view', visitorId: 'x', sessionId: 's1234567890', path: '/' }, { userAgent: UA }), null);
  assert.equal(sanitizeVisitEvent({ type: 'product_view', ...ids, path: '/deal/x', asin: 'bad' }, { userAgent: UA }), null);
});

test('journeys join visits and Amazon clicks per session and aggregate by source', () => {
  const now = Date.parse('2026-10-21T12:00:00Z');
  const visits = [
    { type: 'page_view', ...ids, path: '/deal/B012345678', asin: '', source: 'pinterest', device: 'mobile', country: 'US', at: '2026-10-21T10:00:00Z' },
    { type: 'product_view', ...ids, path: '/deal/B012345678', asin: 'B012345678', source: 'pinterest', device: 'mobile', country: 'US', at: '2026-10-21T10:00:01Z' },
    { type: 'page_view', visitorId: 'v2222222222', sessionId: 's2222222222', path: '/finds', source: 'instagram', device: 'desktop', country: '', at: '2026-10-20T09:00:00Z' },
    { type: 'page_view', visitorId: 'v3333333333', sessionId: 's3333333333', path: '/', source: '', device: 'desktop', at: '2026-09-01T09:00:00Z' },
  ];
  const clicks = [
    { asin: 'B012345678', source: 'pinterest', sessionId: 's1234567890', clickedAt: '2026-10-21T10:01:00Z' },
    { asin: 'B099999999', source: 'site', clickedAt: '2026-10-21T11:00:00Z' },
  ];
  const result = journeys(visits, clicks, [{ asin: 'B012345678', title: 'Mirror' }], { now });
  assert.deepEqual(result.totals, { visitors: 2, sessions: 2, pageViews: 2, productViews: 1, amazonClicks: 2,
    sessionsWithProductView: 1, sessionsWithAmazonClick: 1 });
  const first = result.sessions.find((s) => s.sessionId === 's1234567890');
  assert.deepEqual(first.amazonClicks, [{ asin: 'B012345678', at: '2026-10-21T10:01:00Z' }]);
  assert.deepEqual(first.timeline.map((t) => t.type), ['page_view', 'product_view', 'amazon_click']);
  assert.equal(first.source, 'pinterest');
  assert.deepEqual(result.bySource.find((r) => r.source === 'pinterest'),
    { source: 'pinterest', sessions: 1, visitors: 1, productViews: 1, amazonClicks: 1 });
  assert.equal(result.bySource.find((r) => r.source === 'site').amazonClicks, 1);
  assert.deepEqual(result.topProducts[0], { asin: 'B012345678', title: 'Mirror', views: 1, amazonClicks: 1 });
  assert.equal(result.sessions[0].sessionId, 's1234567890');  // newest first
});

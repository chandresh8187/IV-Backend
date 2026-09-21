const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET ||= 'test-session-secret-with-sufficient-length';
const { generateToken } = require('../controllers/authController');

test('new login tokens do not contain an expiry time', () => {
  const token = generateToken({ id: 42, role: 'admin' });
  const decoded = jwt.verify(token, process.env.JWT_SECRET, {
    issuer: 'iv-api', audience: 'iv-app',
  });
  assert.equal(decoded.id, 42);
  assert.equal(decoded.role, 'admin');
  assert.equal(decoded.exp, undefined);
});

test('the configured verification mode accepts previously expired signed tokens', () => {
  const expired = jwt.sign({ id: 42, role: 'admin', exp: 1 }, process.env.JWT_SECRET, {
    issuer: 'iv-api', audience: 'iv-app',
  });
  assert.equal(jwt.verify(expired, process.env.JWT_SECRET, {
    issuer: 'iv-api', audience: 'iv-app', ignoreExpiration: true,
  }).id, 42);
});

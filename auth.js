/**
 * auth.js
 * Verifies the HMAC-signed socket authentication tokens issued by PHP
 * (see php-app/includes/auth_guard.php :: issueSocketToken).
 *
 * Token format: base64url(payload_json) + '.' + hex(hmac_sha256)
 * Payload: { uid, iat, exp }
 *
 * This module NEVER queries MySQL or calls PHP - it only verifies the
 * cryptographic signature and expiry using the shared secret from env.
 */

const crypto = require('crypto');

const SOCKET_AUTH_SECRET = process.env.SOCKET_AUTH_SECRET;

if (!SOCKET_AUTH_SECRET) {
  console.error('FATAL: SOCKET_AUTH_SECRET environment variable is not set.');
  process.exit(1);
}

function base64UrlDecode(str) {
  const padded = str + '='.repeat((4 - (str.length % 4)) % 4);
  const base64 = padded.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(base64, 'base64').toString('utf8');
}

/**
 * Verify a socket auth token.
 * Returns { valid: true, userId: number } or { valid: false, reason: string }
 */
function verifySocketToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) {
    return { valid: false, reason: 'malformed_token' };
  }

  const lastDotIndex = token.lastIndexOf('.');
  const payloadEncoded = token.slice(0, lastDotIndex);
  const signature = token.slice(lastDotIndex + 1);

  if (!payloadEncoded || !signature) {
    return { valid: false, reason: 'malformed_token' };
  }

  const expectedSignature = crypto
    .createHmac('sha256', SOCKET_AUTH_SECRET)
    .update(payloadEncoded)
    .digest('hex');

  // Constant-time comparison to avoid timing attacks.
  const sigBuf = Buffer.from(signature, 'hex');
  const expectedBuf = Buffer.from(expectedSignature, 'hex');
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return { valid: false, reason: 'bad_signature' };
  }

  let payload;
  try {
    payload = JSON.parse(base64UrlDecode(payloadEncoded));
  } catch (err) {
    return { valid: false, reason: 'bad_payload' };
  }

  if (!payload || typeof payload.uid !== 'number') {
    return { valid: false, reason: 'missing_uid' };
  }

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || now >= payload.exp) {
    return { valid: false, reason: 'expired' };
  }

  return { valid: true, userId: payload.uid };
}

module.exports = { verifySocketToken };

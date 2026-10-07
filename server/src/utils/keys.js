import crypto from 'crypto';

// Generates a 10-char URL-safe random string for public chat links
export function generatePublicKey() {
  return crypto.randomBytes(8).toString('base64url').slice(0, 10);
}

// Generates a 6-char uppercase alphanumeric code for agents joining a workspace
export function generateJoinCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  const bytes = crypto.randomBytes(6);
  for (let i = 0; i < 6; i++) {
    code += chars[bytes[i] % chars.length];
  }
  return code;
}

// Generates a unique visitorId for guest customer sessions
export function generateVisitorId() {
  return 'vis_' + crypto.randomBytes(12).toString('hex');
}

import { env } from '../config/env.js';

// In-memory timestamps for agent AI suggestions cooldown
const agentCooldowns = new Map();

// In-memory sliding window for customer message rate limiting (20/min)
const customerMessageBuckets = new Map();

/**
 * Checks if an agent is allowed to trigger an AI suggestion.
 * Enforces per-agent cooldown of AI_COOLDOWN_SECONDS.
 * Returns { allowed: boolean, remainingSeconds: number }
 */
export function checkAgentAiCooldown(agentId) {
  const now = Date.now();
  const lastTime = agentCooldowns.get(agentId) || 0;
  const cooldownMs = env.AI_COOLDOWN_SECONDS * 1000;
  const diff = now - lastTime;

  if (diff < cooldownMs) {
    const remainingSeconds = Math.ceil((cooldownMs - diff) / 1000);
    return { allowed: false, remainingSeconds };
  }

  agentCooldowns.set(agentId, now);
  return { allowed: true, remainingSeconds: 0 };
}

/**
 * Checks customer message rate limit: max 20 messages per minute per visitor.
 * Returns true if allowed, false if limit exceeded.
 */
export function checkCustomerMessageRate(visitorId, maxPerMinute = 20) {
  const now = Date.now();
  const windowMs = 60 * 1000;
  const timestamps = (customerMessageBuckets.get(visitorId) || []).filter(ts => now - ts < windowMs);

  if (timestamps.length >= maxPerMinute) {
    return false;
  }

  timestamps.push(now);
  customerMessageBuckets.set(visitorId, timestamps);
  return true;
}

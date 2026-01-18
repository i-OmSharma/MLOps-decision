/**
 * ============================================================================
 * RATE LIMITING MIDDLEWARE
 * ============================================================================
 * Protects the /decide endpoint from abuse and DoS attacks
 * Prevents exhaustion of AI API quota
 * ============================================================================
 */

import rateLimit from "express-rate-limit";

/**
 * Rate limiter for /decide endpoint
 * - 100 requests per minute per IP
 * - Prevents API abuse and AI quota exhaustion
 */
export const decisionRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // 100 requests per window
  message: {
    error: "Too many requests",
    message: "You have exceeded the 100 requests per minute limit. Please try again later.",
    retryAfter: "60 seconds",
  },
  standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
  legacyHeaders: false, // Disable `X-RateLimit-*` headers
  handler: (req, res) => {
    res.status(429).json({
      decision: {
        final: "ERROR",
        source: "RATE_LIMIT_EXCEEDED",
      },
      error: {
        message: "Too many requests. Please try again later.",
        retryAfter: 60,
        requestId: req.requestId,
      },
      meta: {
        timestamp: new Date().toISOString(),
      },
    });
  },
});

/**
 * Stricter rate limiter for unauthenticated requests
 * Can be used if authentication is added in the future
 */
export const strictRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20, // 20 requests per window
  message: {
    error: "Too many requests",
    message: "Rate limit exceeded for unauthenticated requests.",
  },
});

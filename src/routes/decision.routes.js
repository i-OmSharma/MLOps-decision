import { Router } from "express";
import * as metrics from "../metrics/prometheus.js";
import { decisionRateLimiter } from "../middleware/rateLimit.middleware.js";

export function decisionRoutes(decisionService, ENGINE_VERSION) {
  const router = Router();

  router.post("/decide", decisionRateLimiter, async (req, res) => {
    try {
      const input = req.body;
      const result = await decisionService.decide(input, req.requestId);

      const statusCode = result.decision.final === "ERROR" ? 500 : 200;

      res.status(statusCode).json(result);
    } catch (error) {
      console.error(`[${req.requestId}] Decision error`, error);
      metrics.recordError("unhandled_error", "/decide");

      res.status(500).json({
        decision: {
          final: "ERROR",
          source: "SYSTEM_ERROR",
        },
        error: {
          message: "Internal server error",
          requestId: req.requestId,
        },
        meta: {
          version: ENGINE_VERSION,
          timestamp: new Date().toISOString(),
        },
      });
    }
  });

  return router;
}

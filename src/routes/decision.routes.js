import { Router } from "express";

export function decisionRoutes(decisionService, ENGINE_VERSION) {
  const router = Router();

  router.post("/decide", async (req, res) => {
    try {
      const input = req.body;
      const result = await decisionService.decide(input);

      const statusCode = result.decision.final === "ERROR" ? 500 : 200;

      res.status(statusCode).json(result);
    } catch (error) {
      console.error(`[${req.requestId}] Deciosn error`, error);
      getMetrics.recordError("unhandled_error", "/decide");

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

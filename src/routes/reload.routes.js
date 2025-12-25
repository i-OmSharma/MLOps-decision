import { Router } from "express";

export function reloadRoutes(decisionService) {
  const router = Router();

  router.post("/reload", (req, res) => {
    console.log("Reloading rules configuration...");
    const result = decisionService.reloadRules();

    if (result.success) {
      res.json({
        status: "reloaded",
        rulesCount: result.rulesCount,
        timestamp: new Date().toISOString(),
      });
    } else {
      res.status(500).json({
        status: "failed",
        error: result.error,
        timestamp: new Date().toISOString(),
      });
    }
  });

  return router;
}

import { Router } from "express";

export function readyRoutes(isShuttingDown, decisionService, ENGINE_VERSION) {
  const router = Router();

  //Not ready case:
  router.get("/ready", (req, res) => {
    if (isShuttingDown()) {
      return res.status(503).json({
        status: "not_ready",
        reason: "shutting_down",
      });
    }

    //stuck in middle:


  const status = decisionService.getStatus();
  const rulesLoaded = status.ruleEngine.rulesCount > 0;

    if(!rulesLoaded) {
        return res.status(503).json({
            status:'not_ready',
            reason: 'rule_not_loaded'
        })
    } 

    // Ready case:
    res.status(200).json({
      status: "ready",
      version: ENGINE_VERSION,
      rulesLoaded: status.ruleEngine.rulesCount,
      aiEnabled: status.aiAnalyzer.enabled
    });
  });

  return router;
}


/*

Is shutting down?
   ├─ YES → 503
   └─ NO
        ↓
Rules loaded?
   ├─ NO → 503
   └─ YES
        ↓
     200 READY

*/

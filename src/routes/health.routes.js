import { Router } from "express";

export function healthRoutes(ENGINE_VERSION) {
  const router = Router();

  router.get("/health", (req, res) => {
    res.status(200).json({
      status: "healthy",
      version: ENGINE_VERSION,
      timestamp: new Date().toISOString(),
    });
  });
  return router;
}



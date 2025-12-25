/**
 * ============================================================================
 * DECISION PLATFORM - Express Server
 * ============================================================================
 *
 * Universal Decision Platform API Server
 *
 * Endpoints:
 * - POST /decide     - Main decision endpoint
 * - GET  /health     - Kubernetes health check
 * - GET  /ready      - Kubernetes readiness check
 * - GET  /metrics    - Prometheus metrics
 * - GET  /status     - Detailed system status
 * - POST /reload     - Hot-reload rules configuration
 *
 * Design Decisions:
 * 1. Separate health and ready endpoints for K8s lifecycle
 * 2. Prometheus metrics endpoint for observability
 * 3. Structured logging with timestamps
 * 4. Request ID tracking for distributed tracing
 * 5. Graceful shutdown handling
 * ============================================================================
 */

import express from "express";
import { config } from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import * as metrics from "./metrics/prometheus.js";

// Load environment variables
config();

// Get directory name for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Import our modules
import { DecisionService } from "./decisionService.js";
import { decisionRoutes } from "./routes/decision.routes.js";
import { healthRoutes } from "./routes/health.routes.js";
import { readyRoutes } from "./routes/ready.routes.js";
import metricsRoutes from "./routes/metrics.routes.js";
import { statusRoutes } from "./routes/status.routes.js";
import { reloadRoutes } from "./routes/reload.routes.js";

// ============================================================================
// CONFIGURATION
// ============================================================================

const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || "development";
const ENGINE_VERSION = process.env.ENGINE_VERSION || "v1";
const RULES_CONFIG_PATH =
  process.env.RULES_CONFIG_PATH || resolve(__dirname, "../config/rules.yaml");

// AI Configuration
const AI_ENABLED = process.env.AI_ENABLED === "true";
const AI_PROVIDER = process.env.AI_PROVIDER || "openai";
const AI_API_URL =
  process.env.AI_API_URL || "https://api.openai.com/v1/chat/completions";
const AI_API_KEY = process.env.AI_API_KEY || "";
const AI_MODEL = process.env.AI_MODEL || "gpt-4o-mini";
const AI_TIMEOUT_MS = parseInt(process.env.AI_TIMEOUT_MS) || 5000;

// ============================================================================
// INITIALIZE SERVICES
// ============================================================================

const app = express();
app.use(express.json());

// Initialize decision service
const decisionService = new DecisionService({
  version: ENGINE_VERSION,
  rulesConfigPath: RULES_CONFIG_PATH,
  aiEnabled: AI_ENABLED,
  aiProvider: AI_PROVIDER,
  aiApiUrl: AI_API_URL,
  aiApiKey: AI_API_KEY,
  aiModel: AI_MODEL,
  aiTimeout: AI_TIMEOUT_MS,
});

//decision from routes.

// Track server state for graceful shutdown
let isShuttingDown = false;

// ============================================================================
// MIDDLEWARE
// ============================================================================

/**
 * Request logging middleware
 */
app.use((req, res, next) => {
  const requestId = `req_${Date.now()}_${Math.random()
    .toString(36)
    .substr(2, 9)}`;
  req.requestId = requestId;

  const start = Date.now();

  res.on("finish", () => {
    const duration = Date.now() - start;
    console.log(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        requestId,
        method: req.method,
        path: req.path,
        status: res.statusCode,
        durationMs: duration,
      })
    );
  });

  next();
});

/**
 * Shutdown awareness middleware
 */
app.use((req, res, next) => {
  if (isShuttingDown && req.path !== "/health") {
    return res.status(503).json({
      error: "Service shutting down",
      retryAfter: 5,
    });
  }
  next();
});

// ============================================================================
// ENDPOINTS
// ============================================================================

/**
 * POST /decide - Main decision endpoint
 *
 * Request body:
 * {
 *   "request": { ... },  // Domain-specific request data
 *   "signals": { ... }   // Contextual signals for rule evaluation
 * }
 *
 * Response:
 * {
 *   "decision": { "final": "ALLOW|DENY|REVIEW", ... },
 *   "ruleEvaluation": { ... },
 *   "aiAnalysis": { ... },  // Only in v2 for grey-zone
 *   "meta": { ... }
 * }
 */

// ---------------------------------------Handle in Router file----------------

// app.post('/decide', async (req, res) => {
//   try {
//     const input = req.body;
//     const result = await decisionService.decide(input);

//     // Set appropriate status code based on result
//     const statusCode = result.decision.final === 'ERROR' ? 500 : 200;

//     res.status(statusCode).json(result);
//   } catch (error) {
//     console.error(`[${req.requestId}] Decision error:`, error);
//     metrics.recordError('unhandled_error', '/decide');

//     res.status(500).json({
//       decision: {
//         final: 'ERROR',
//         source: 'SYSTEM_ERROR'
//       },
//       error: {
//         message: 'Internal server error',
//         requestId: req.requestId
//       },
//       meta: {
//         version: ENGINE_VERSION,
//         timestamp: new Date().toISOString()
//       }
//     });
//   }
// });

// -------------------------------------------------------

/**
 * GET /health - Liveness probe for Kubernetes
 * Returns 200 if server is running
 */
// app.get('/health', (req, res) => {
//   res.status(200).json({
//     status: 'healthy',
//     version: ENGINE_VERSION,
//     timestamp: new Date().toISOString()
//   });
// });

//-------------------------------------------
/**
 * GET /ready - Readiness probe for Kubernetes
 * Returns 200 if service is ready to accept traffic
 */
// app.get('/ready', (req, res) => {
//   if (isShuttingDown) {
//     return res.status(503).json({
//       status: 'not_ready',
//       reason: 'shutting_down'
//     });
//   }

// // Check if rule engine is loaded
// const status = decisionService.getStatus();
// const rulesLoaded = status.ruleEngine.rulesCount > 0;

// if (!rulesLoaded) {
//   return res.status(503).json({
//     status: 'not_ready',
//     reason: 'rules_not_loaded'
//   });
// }

// res.status(200).json({
//   status: 'ready',
//   version: ENGINE_VERSION,
//   rulesLoaded: status.ruleEngine.rulesCount,
//   aiEnabled: status.aiAnalyzer.enabled
// });

//----------------------------------------------
/**
 * GET /metrics - Prometheus metrics endpoint
 */
// app.get('/metrics', async (req, res) => {
//   try {
//     const metricsOutput = await metrics.getMetrics();
//     res.set('Content-Type', metrics.getContentType());
//     res.send(metricsOutput);
//   } catch (error) {
//     console.error('Metrics error:', error);
//     res.status(500).send('Error generating metrics');
//   }
// });

//----------------------------------------------
/**
 * GET /status - Detailed system status
 * Useful for debugging and admin dashboards
 */
// app.get('/status', (req, res) => {
//   const status = decisionService.getStatus();
//   res.json({
//     ...status,
//     server: {
//       nodeEnv: NODE_ENV,
//       uptime: process.uptime(),
//       memoryUsage: process.memoryUsage()
//     }
//   });
// });

//----------------------------------------------

/**
 * POST /reload - Hot-reload rules configuration
 * Allows updating rules without restart
 */
// app.post('/reload', (req, res) => {
//   console.log('Reloading rules configuration...');
//   const result = decisionService.reloadRules();

//   if (result.success) {
//     res.json({
//       status: 'reloaded',
//       rulesCount: result.rulesCount,
//       timestamp: new Date().toISOString()
//     });
//   } else {
//     res.status(500).json({
//       status: 'failed',
//       error: result.error,
//       timestamp: new Date().toISOString()
//     });
//   }
// });

//----------------------------------------------
app.use(decisionRoutes(decisionService, ENGINE_VERSION));
app.use(healthRoutes(ENGINE_VERSION));
app.use(readyRoutes(() => isShuttingDown, decisionService, ENGINE_VERSION));
app.use(metricsRoutes);
app.use(statusRoutes(decisionService));
app.use(reloadRoutes(decisionService));
/**
 * 404 handler
 */
app.use((req, res) => {
  res.status(404).json({
    error: "Not Found",
    path: req.path,
    method: req.method,
  });
});

/**
 * Global error handler
 */
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  metrics.recordError("unhandled_exception", req.path);

  res.status(500).json({
    error: "Internal Server Error",
    requestId: req.requestId,
  });
});

// ============================================================================
// SERVER LIFECYCLE
// ============================================================================

const server = app.listen(PORT, () => {
  console.log("=".repeat(60));
  console.log(`UNIVERSAL DECISION PLATFORM`);
  console.log("=".repeat(60));
  console.log(`Version:     ${ENGINE_VERSION}`);
  console.log(`Environment: ${NODE_ENV}`);
  console.log(`Port:        ${PORT}`);
  console.log(`AI Enabled:  ${AI_ENABLED}`);
  console.log(`Rules Path:  ${RULES_CONFIG_PATH}`);
  console.log("=".repeat(60));
  console.log("Endpoints:");
  console.log("  POST /decide  - Make a decision");
  console.log("  GET  /health  - Health check");
  console.log("  GET  /ready   - Readiness check");
  console.log("  GET  /metrics - Prometheus metrics");
  console.log("  GET  /status  - System status");
  console.log("  POST /reload  - Reload rules");
  console.log("=".repeat(60));
});

/**
 * Graceful shutdown handler
 */
function gracefulShutdown(signal) {
  console.log(`\n${signal} received. Starting graceful shutdown...`);
  isShuttingDown = true;

  // Give load balancer time to remove us from rotation
  setTimeout(() => {
    server.close((err) => {
      if (err) {
        console.error("Error during shutdown:", err);
        process.exit(1);
      }
      console.log("Server closed. Goodbye!");
      process.exit(0);
    });
  }, 5000);

  // Force shutdown after 30 seconds
  setTimeout(() => {
    console.error("Forced shutdown after timeout");
    process.exit(1);
  }, 30000);
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

export default app;

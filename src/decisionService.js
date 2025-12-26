/**
 * ============================================================================
 * DECISION SERVICE - Orchestrates the complete decision flow
 * ============================================================================
 *
 * Design Decisions:
 * 1. Single entry point for decision logic (clean API)
 * 2. Version-aware (v1 = rules only, v2 = rules + AI)
 * 3. Metrics recording is integrated but non-blocking
 * 4. Full audit trail in response for debugging/compliance
 * 5. Graceful degradation if AI fails
 *
 * Flow:
 * Input → Rule Engine → [If GREY_ZONE && v2] → AI Analyzer → Combine → Output
 * ============================================================================
 */

import { RuleEngine, OUTCOMES } from "./rules/engine.js";
import { AIAnalyzer } from "./ai/analyzer.js";
import * as metrics from "./metrics/prometheus.js";

/**
 * DecisionService class - main orchestrator
 */
export class DecisionService {
  constructor(config) {
    this.version = config.version || "v1";

    // Initialize rule engine
    this.ruleEngine = new RuleEngine(config.rulesConfigPath);
    this.ruleEngine.loadRules();

    // Initialize AI analyzer (only active in v2)
    this.aiAnalyzer = new AIAnalyzer({
      enabled: config.aiEnabled && this.version === "v2",
      provider: config.aiProvider,
      apiUrl: config.aiApiUrl,
      apiKey: config.aiApiKey,
      model: config.aiModel,
      timeout: config.aiTimeout,
      ...this.ruleEngine.getAIConfig(),
    });

    // Update engine info metrics
    metrics.updateEngineInfo(
      this.version,
      this.ruleEngine.getRules().length,
      this.aiAnalyzer.isEnabled()
    );

    console.log(
      `[DecisionService] Initialized - Version: ${
        this.version
      }, AI Enabled: ${this.aiAnalyzer.isEnabled()}`
    );
  }

  /**
   * Main decision method
   * Takes input, returns complete decision with audit trail
   */
  async decide(input, requestId = "unknown") {
    const startTime = Date.now();
    metrics.activeRequests.inc();

    try {
      // Validate input structure
      const validation = this.validateInput(input);
      if (!validation.valid) {
        return this.buildErrorResponse(validation.error, startTime, requestId);
      }

      // Step 1: Evaluate rules
      const ruleResult = this.ruleEngine.evaluate(input);

      // Step 2: Determine if AI analysis is needed
      let aiInsight = {
        analyzed: false,
        recommendation: null,
        confidence: null,
        reasoning: null,
        riskFactors: [],
        mitigatingFactors: [],
        analysisTimeMs: null,
        error: null,
      };
      const needsAI =
        ruleResult.outcome === OUTCOMES.GREY_ZONE &&
        this.version === "v2" &&
        this.aiAnalyzer.isEnabled();

      if (needsAI) {
        aiInsight = await this.aiAnalyzer.analyze(input, ruleResult);

        // Record AI metrics
        if (aiInsight.analyzed) {
          metrics.recordAIInvocation({
            success: aiInsight.analyzed,
            provider: this.aiAnalyzer.getStatus().provider,
            durationMs: aiInsight.analysisTimeMs || 0,
          });
        }
      }

      // Step 3: Combine rule outcome with AI insight (if available)
      const combinedDecision = this.aiAnalyzer.combineDecision(
        ruleResult.outcome,
        aiInsight
      );

      // Build response
      const response = this.buildResponse({
        ruleResult,
        aiInsight,
        combinedDecision,
        startTime,
        requestId,
      });

      // Record metrics
      metrics.recordDecision({
        outcome: response.decision.final,
        source: response.decision.source,
        version: this.version,
        aiUsed: needsAI && aiInsight?.analyzed,
        durationMs: response.meta.processingTimeMs,
        evaluationPath: ruleResult.evaluationPath,
        matchedRuleId: ruleResult.matchedRule?.id,
      });

      return response;
    } catch (error) {
      console.error("[DecisionService] Decision error:", error);
      metrics.recordError("decision_error", "/decide");
      return this.buildErrorResponse(error.message, startTime, requestId);
    } finally {
      metrics.activeRequests.dec();
    }
  }

  /**
   * Validate input structure
   */
  validateInput(input) {
    if (!input || typeof input !== "object") {
      return { valid: false, error: "Input must be a non-null object" };
    }

    if (!input.request || typeof input.request !== "object") {
      return { valid: false, error: 'Input must contain a "request" object' };
    }

    if (!input.signals || typeof input.signals !== "object") {
      return { valid: false, error: 'Input must contain a "signals" object' };
    }

    return { valid: true };
  }

  /**
   * Build standardized response
   */
  buildResponse({
    ruleResult,
    aiInsight,
    combinedDecision,
    startTime,
    requestId,
  }) {
    const processingTimeMs = Date.now() - startTime;

    const aiAnalysis =
      aiInsight && aiInsight.analyzed
        ? {
            recommendation: aiInsight.recommendation,
            confidence: aiInsight.confidence,
            reasoning: aiInsight.reasoning,
            riskFactors: aiInsight.riskFactors || [],
            mitigatingFactors: aiInsight.mitigatingFactors || [],
            analysisTimeMs: aiInsight.analysisTimeMs || null,
            error: aiInsight.error || null,
          }
        : null;

    return {
      decision: {
        final: combinedDecision.finalDecision,
        source: combinedDecision.source,
        confidence: combinedDecision.confidence || null,
      },
      ruleEvaluation: {
        outcome: ruleResult.outcome,
        matchedRule: ruleResult.matchedRule,
        evaluationTimeMs: ruleResult.evaluationTimeMs,
      },
      aiAnalysis,
      // aiAnalysis: aiInsight ? {
      //   performed: aiInsight.analyzed,
      //   recommendation: aiInsight.recommendation || null,
      //   confidence: aiInsight.confidence || null,
      //   reasoning: aiInsight.reasoning || null,
      //   riskFactors: aiInsight.riskFactors || [],
      //   mitigatingFactors: aiInsight.mitigatingFactors || [],
      //   analysisTimeMs: aiInsight.analysisTimeMs || null,
      //   error: aiInsight.error || null
      // } : null,
      meta: {
        version: this.version,
        processingTimeMs,
        timestamp: new Date().toISOString(),
        requestId,
      },
    };
  }

  /**
   * Build error response
   */
  buildErrorResponse(error, startTime, requestId) {
    return {
      decision: {
        final: "ERROR",
        source: "SYSTEM_ERROR",
        confidence: null,
      },
      error: {
        message: error,
        type: "PROCESSING_ERROR",
      },
      meta: {
        version: this.version,
        processingTimeMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
        requestId,
      },
    };
  }

  /**
   * Generate unique request ID
   */
  // generateRequestId() {
  //   return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  // }

  /**
   * Reload rules configuration (for hot-reload)
   */
  reloadRules() {
    try {
      this.ruleEngine.loadRules();
      metrics.updateEngineInfo(
        this.version,
        this.ruleEngine.getRules().length,
        this.aiAnalyzer.isEnabled()
      );
      return { success: true, rulesCount: this.ruleEngine.getRules().length };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Get service status for health checks
   */
  getStatus() {
    return {
      version: this.version,
      ruleEngine: this.ruleEngine.getMetadata(),
      aiAnalyzer: this.aiAnalyzer.getStatus(),
      rules: this.ruleEngine.getRules(),
    };
  }
}

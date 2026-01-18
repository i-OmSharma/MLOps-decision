import axios from "axios";
import { CircuitBreaker } from "./circuitBreaker.js";

/**
 * ============================================================================
 * AI ANALYZER - Grey-zone decision support using external LLM
 * ============================================================================
 * AI is ADVISORY ONLY – rules always win
 * ============================================================================
 */

export class AIAnalyzer {
  constructor(config = {}) {
    this.enabled = config.enabled || false;
    this.providers = config.providers || [];
    this.timeout = config.timeout || 5000;
    this.confidenceThreshold = config.confidenceThreshold || 0.7;

    // Initialize circuit breaker
    this.circuitBreaker = new CircuitBreaker({
      failureThreshold: 5, // Open circuit after 5 consecutive failures
      resetTimeout: 60000, // Try again after 60 seconds
      halfOpenMaxAttempts: 1, // Test with 1 request when recovering
    });
  }

  // ============================================================================
  // Prompt
  // ============================================================================

buildPrompt(input, ruleContext) {
  return `You are a decision support system analyzing a GREY-ZONE request.

REQUEST:
${JSON.stringify(input, null, 2)}

RULE CONTEXT:
${JSON.stringify(ruleContext.evaluationPath || [], null, 2)}

CONFIDENCE SCORING GUIDELINES:
- 0.1-0.3 (LOW): Missing critical data, highly ambiguous signals, conflicting indicators
- 0.3-0.5 (LOW-MEDIUM): Incomplete data, some ambiguity, weak patterns
- 0.5-0.7 (MEDIUM): Adequate data, moderate clarity, balanced risk/mitigation factors
- 0.7-0.85 (HIGH-MEDIUM): Good data quality, clear patterns, strong indicators
- 0.85-1.0 (HIGH): Complete data, unambiguous signals, very clear risk profile

Factors that LOWER confidence:
- Missing key fields (type, amount, verification status, reputation)
- Conflicting signals (high risk score but verified, low reputation but high amount)
- Edge cases or unusual patterns
- Insufficient context in rule evaluation path

Factors that RAISE confidence:
- All relevant fields present with clear values
- Aligned signals pointing same direction
- Clear match with rule criteria
- Typical/standard transaction patterns

Respond ONLY with valid JSON.
Do not include explanations, markdown, or code fences.
The response must start with '{' and end with '}'.

JSON schema:
{
  "recommendation": "ALLOW" | "DENY" | "REVIEW",
  "confidence": 0.0-1.0,
  "reasoning": "short explanation",
  "risk_factors": [],
  "mitigating_factors": []
}`;
}


  // ============================================================================
  // Provider call
  // ============================================================================

  async callProvider(provider, prompt) {
    if (provider.name !== "gemini") {
      throw new Error(`Unsupported provider: ${provider.name}`);
    }

    const url = `${provider.apiUrl}/${provider.model}:generateContent?key=${provider.apiKey}`;
    const headers = { "Content-Type": "application/json" };
    const body = { contents: [{ parts: [{ text: prompt }] }] };

    const response = await axios.post(url, body, {
      headers,
      timeout: this.timeout,
    });

    // Gemini safety block check
    if (response.data?.promptFeedback?.blockReason) {
      throw new Error(
        `GEMINI_BLOCKED:${response.data.promptFeedback.blockReason}`
      );
    }

    const content = this.extractContent(response);
    if (!content) {
      throw new Error("GEMINI_EMPTY_RESPONSE");
    }

    return content;
  }

extractContent(response) {
  const parts = response.data?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return null;

  const text = parts
    .map(p => typeof p.text === "string" ? p.text : "")
    .join("")
    .trim();

  return text.length > 0 ? text : null;
}


  // ============================================================================
  // Parsing
  // ============================================================================

  parseResponse(raw) {
    try {
      const cleaned = raw.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(cleaned);

      return {
        recommendation: ["ALLOW", "DENY", "REVIEW"].includes(parsed.recommendation)
          ? parsed.recommendation
          : "REVIEW",
        confidence:
          typeof parsed.confidence === "number"
            ? Math.max(0, Math.min(1, parsed.confidence))
            : 0.5,
        reasoning: parsed.reasoning || "",
        riskFactors: parsed.risk_factors || [],
        mitigatingFactors: parsed.mitigating_factors || [],
      };
    } catch {
      return {
        recommendation: "REVIEW",
        confidence: 0,
        reasoning: "Invalid AI response",
        riskFactors: [],
        mitigatingFactors: [],
      };
    }
  }

  // ============================================================================
  // Main analysis with fallback
  // ============================================================================

  async analyze(input, ruleContext) {
    if (!this.enabled) {
      return { analyzed: false, meetsConfidenceThreshold: false };
    }

    const start = Date.now();
    const prompt = this.buildPrompt(input, ruleContext);

    for (const provider of this.providers) {
      // Check circuit breaker before attempting
      const circuitCheck = this.circuitBreaker.allowRequest(provider);
      if (!circuitCheck.allowed) {
        console.warn(
          `[AIAnalyzer] ${provider.name} (${provider.model}) skipped - ${circuitCheck.reason}`
        );
        continue; // Skip this provider, try next
      }

      try {
        const raw = await this.callProvider(provider, prompt);
        const parsed = this.parseResponse(raw);

        // Record success with circuit breaker
        this.circuitBreaker.recordSuccess(provider);

        return {
          analyzed: true,
          provider: provider.name,
          model: provider.model,
          analysisTimeMs: Date.now() - start,
          meetsConfidenceThreshold:
            parsed.confidence >= this.confidenceThreshold,
          ...parsed,
        };
      } catch (err) {
        // Record failure with circuit breaker
        this.circuitBreaker.recordFailure(provider, err);

        console.warn(
          `[AIAnalyzer] ${provider.name} (${provider.model}) failed → fallback`,
          err.message
        );
      }
    }

    return {
      analyzed: false,
      meetsConfidenceThreshold: false,
      reason: "ALL_PROVIDERS_FAILED",
      analysisTimeMs: Date.now() - start,
    };
  }

  // ============================================================================
  // Decision combine
  // ============================================================================

  combineDecision(ruleOutcome, aiInsight) {
    if (ruleOutcome === "SAFE_DENY") {
      return { finalDecision: "DENY", source: "RULE_ABSOLUTE" };
    }

    if (ruleOutcome === "SAFE_ALLOW") {
      if (
        aiInsight?.analyzed &&
        aiInsight.recommendation === "DENY" &&
        aiInsight.confidence >= this.confidenceThreshold
      ) {
        return { finalDecision: "REVIEW", source: "AI_FLAGGED_REVIEW" };
      }
      return { finalDecision: "ALLOW", source: "RULE" };
    }

    if (!aiInsight?.analyzed) {
      return { finalDecision: "REVIEW", source: "AI_UNAVAILABLE" };
    }

    if (aiInsight.meetsConfidenceThreshold) {
      return {
        finalDecision: aiInsight.recommendation,
        source: "AI_RECOMMENDED",
        confidence: aiInsight.confidence,
      };
    }

    return { finalDecision: "REVIEW", source: "AI_UNCERTAIN" };
  }

  isEnabled() {
    return this.enabled;
  }

  getStatus() {
    return {
      enabled: this.enabled,
      providers: this.providers.map(p => ({
        name: p.name,
        model: p.model,
      })),
      confidenceThreshold: this.confidenceThreshold,
      circuitBreaker: this.circuitBreaker.getStatus(),
    };
  }
}


// /**
//  * ============================================================================
//  * AI ANALYZER - Grey-zone decision support using external LLM
//  * ============================================================================
//  *
//  * Design Decisions:
//  * 1. AI is ADVISORY ONLY - it cannot override hard rules (SAFE_DENY)
//  * 2. Configurable provider support (OpenAI, Anthropic, local models)
//  * 3. Structured prompts ensure consistent, parseable responses
//  * 4. Timeout and fallback handling for production reliability
//  * 5. Response includes confidence score for downstream weighting
//  *
//  * Key Principle: AI provides insights, rules make decisions
//  * ============================================================================
//  */

// import axios from "axios";

// /**
//  * AIAnalyzer class - provides decision support for grey-zone requests
//  */
// export class AIAnalyzer {
//   constructor(config = {}) {
//     this.enabled = config.enabled || false;
//     this.providers = config.providers ||[];
//     this.apiUrl = config.apiUrl || "https://api.openai.com/v1/chat/completions";
//     this.apiKey = config.apiKey || "";
//     this.model = config.model || "gpt-4o-mini";
//     this.timeout = config.timeout || 5000;
//     this.confidenceThreshold = config.confidenceThreshold || 0.7;
//     this.recommendationWeight = config.recommendationWeight || 0.6;
//   }

//   /**
//    * Build analysis prompt for the LLM
//    * Returns a structured prompt that encourages consistent JSON responses
//    */
//   buildPrompt(input, ruleContext) {
//     return `You are a decision support system analyzing a request that fell into a "grey zone" -
// meaning deterministic rules couldn't clearly classify it.

// REQUEST DATA:
// ${JSON.stringify(input, null, 2)}

// RULE EVALUATION CONTEXT:
// - No hard rules matched this request
// - Default behavior: requires analysis
// - Evaluation path: ${JSON.stringify(
//       ruleContext.evaluationPath?.map((e) => e.ruleId) || []
//     )}

// YOUR TASK:
// Analyze this request and provide a recommendation. Consider:
// 1. Risk indicators in the signals
// 2. Request characteristics
// 3. Any anomalies or unusual patterns

// RESPOND WITH ONLY THIS JSON FORMAT (no markdown, no explanation):
// {
//   "recommendation": "ALLOW" | "DENY" | "REVIEW",
//   "confidence": 0.0-1.0,
//   "reasoning": "Brief explanation of your analysis",
//   "risk_factors": ["list", "of", "concerns"],
//   "mitigating_factors": ["list", "of", "positives"]
// }`;
//   }

//   /**
//    * Call the external AI provider
//    * Handles different provider formats (OpenAI, Anthropic, etc.)
//    */
//   async callProvider(providerConfig, prompt) {
//     if (!this.enabled) {
//       throw new Error("AI Analyzer is disabled");
//     }

//     const headers = {
//       "Content-Type": "application/json",
//     };

//     let body;

//     // Configure request based on provider
//     switch (this.provider) {
//       case "openai":
//         headers["Authorization"] = `Bearer ${this.apiKey}`;
//         body = {
//           model: this.model,
//           messages: [
//             {
//               role: "system",
//               content:
//                 "You are a risk analysis assistant. Always respond with valid JSON only.",
//             },
//             { role: "user", content: prompt },
//           ],
//           temperature: 0.3, // Lower temperature for more consistent outputs
//           max_tokens: 500,
//         };
//         break;

//       case "anthropic":
//         headers["x-api-key"] = this.apiKey;
//         headers["anthropic-version"] = "2023-06-01";
//         body = {
//           model: this.model,
//           max_tokens: 500,
//           messages: [{ role: "user", content: prompt }],
//         };
//         break;

//       case "local":
//         // For local models (Ollama, etc.)
//         body = {
//           model: this.model,
//           prompt: prompt,
//           stream: false,
//         };
//         break;

//       default:
//         throw new Error(`Unknown AI provider: ${this.provider}`);
//     }

//     try {
//       const response = await axios.post(this.apiUrl, body, {
//         headers,
//         timeout: this.timeout,
//       });

//       // Extract content based on provider response format
//       let content;
//       if (this.provider === "openai") {
//         content = response.data.choices[0].message.content;
//       } else if (this.provider === "anthropic") {
//         content = response.data.content[0].text;
//       } else {
//         content = response.data.response || response.data.output;
//       }

//       return content;
//     } catch (error) {
//       if (error.code === "ECONNABORTED" || error.message.includes("timeout")) {
//         throw new Error("AI_TIMEOUT");
//       }
//       throw error;
//     }
//   }

//   /**
//    * Parse LLM response into structured format
//    * Handles various edge cases and malformed responses
//    */
//   parseResponse(rawResponse) {
//     try {
//       // Clean up response (remove markdown code blocks if present)
//       let cleaned = rawResponse.trim();
//       if (cleaned.startsWith("```")) {
//         cleaned = cleaned
//           .replace(/```json?\n?/g, "")
//           .replace(/```$/g, "")
//           .trim();
//       }

//       const parsed = JSON.parse(cleaned);

//       // Validate required fields
//       const recommendation = ["ALLOW", "DENY", "REVIEW"].includes(
//         parsed.recommendation
//       )
//         ? parsed.recommendation
//         : "REVIEW";

//       const confidence =
//         typeof parsed.confidence === "number"
//           ? Math.max(0, Math.min(1, parsed.confidence))
//           : 0.5;

//       return {
//         recommendation,
//         confidence,
//         reasoning: parsed.reasoning || "No reasoning provided",
//         riskFactors: Array.isArray(parsed.risk_factors)
//           ? parsed.risk_factors
//           : [],
//         mitigatingFactors: Array.isArray(parsed.mitigating_factors)
//           ? parsed.mitigating_factors
//           : [],
//         raw: parsed,
//       };
//     } catch (error) {
//       console.error("[AIAnalyzer] Failed to parse response:", error.message);
//       return {
//         recommendation: "REVIEW",
//         confidence: 0,
//         reasoning: "Failed to parse AI response",
//         riskFactors: [],
//         mitigatingFactors: [],
//         parseError: true,
//       };
//     }
//   }

//   /**
//    * Main analysis method - analyze a grey-zone request
//    * Returns structured AI insight for decision combination
//    */
//   async analyze(input, ruleContext) {
//     if (!this.enabled) {
//       return {
//         analyzed: false,
//         reason: "AI_DISABLED",
//         recommendation: null,
//       };
//     }

//     const startTime = Date.now();

//     try {
//       const prompt = this.buildPrompt(input, ruleContext);
//       const rawResponse = await this.callProvider(prompt);
//       const analysis = this.parseResponse(rawResponse);

//       return {
//         analyzed: true,
//         analysisTimeMs: Date.now() - startTime,
//         recommendation: analysis.recommendation,
//         confidence: analysis.confidence,
//         reasoning: analysis.reasoning,
//         riskFactors: analysis.riskFactors,
//         mitigatingFactors: analysis.mitigatingFactors,
//         meetsConfidenceThreshold:
//           analysis.confidence >= this.confidenceThreshold,
//         parseError: analysis.parseError || false,
//       };
//     } catch (error) {
//       console.error("[AIAnalyzer] Analysis failed:", error.message);

//       return {
//         analyzed: false,
//         analysisTimeMs: Date.now() - startTime,
//         reason: error.message === "AI_TIMEOUT" ? "AI_TIMEOUT" : "AI_ERROR",
//         error: error.message,
//       };
//     }
//   }

//   /**
//    * Combine rule outcome with AI insight to produce final decision
//    * Key principle: AI cannot override SAFE_DENY rules
//    */
//   combineDecision(ruleOutcome, aiInsight) {
//     // SAFE_DENY is absolute - AI cannot override
//     if (ruleOutcome === "SAFE_DENY") {
//       return {
//         finalDecision: "DENY",
//         source: "RULE_ABSOLUTE",
//         aiConsidered: false,
//       };
//     }

//     // SAFE_ALLOW is trusted - but AI can flag concerns
//     if (ruleOutcome === "SAFE_ALLOW") {
//       // If AI strongly recommends DENY, flag for review instead of auto-allow
//       if (
//         aiInsight?.analyzed &&
//         aiInsight.recommendation === "DENY" &&
//         aiInsight.confidence >= this.confidenceThreshold
//       ) {
//         return {
//           finalDecision: "REVIEW",
//           source: "AI_OVERRIDE_TO_REVIEW",
//           aiConsidered: true,
//           note: "AI flagged concerns on auto-approved request",
//         };
//       }
//       return {
//         finalDecision: "ALLOW",
//         source: "RULE",
//         aiConsidered: false,
//       };
//     }

//     // GREY_ZONE - AI insight matters most here
//     if (!aiInsight?.analyzed) {
//       return {
//         finalDecision: "REVIEW",
//         source: "DEFAULT_NO_AI",
//         aiConsidered: false,
//       };
//     }

//     // Use AI recommendation if confidence is sufficient
//     if (aiInsight.meetsConfidenceThreshold) {
//       if (aiInsight.recommendation === "ALLOW") {
//         return {
//           finalDecision: "ALLOW",
//           source: "AI_RECOMMENDED",
//           aiConsidered: true,
//           confidence: aiInsight.confidence,
//         };
//       } else if (aiInsight.recommendation === "DENY") {
//         return {
//           finalDecision: "DENY",
//           source: "AI_RECOMMENDED",
//           aiConsidered: true,
//           confidence: aiInsight.confidence,
//         };
//       }
//     }

//     // Low confidence or REVIEW recommendation - escalate
//     return {
//       finalDecision: "REVIEW",
//       source: "AI_UNCERTAIN",
//       aiConsidered: true,
//       confidence: aiInsight.confidence,
//     };
//   }

//   /**
//    * Check if analyzer is enabled
//    */
//   isEnabled() {
//     return this.enabled;
//   }

//   /**
//    * Get analyzer status for health checks
//    */
//   getStatus() {
//     return {
//       enabled: this.enabled,
//       provider: this.provider,
//       model: this.model,
//       confidenceThreshold: this.confidenceThreshold,
//       recommendationWeight: this.recommendationWeight,
//     };
//   }
// }

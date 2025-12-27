/**
 * ============================================================================
 * RULE ENGINE - Core decision logic for Universal Decision Platform
 * ============================================================================
 *
 * Design Decisions:
 * 1. Rules are loaded from YAML for easy configuration without code changes
 * 2. Rules are sorted by priority (highest first) for predictable evaluation
 * 3. First matching rule wins - order matters for performance
 * 4. Supports nested AND/OR conditions for complex logic
 * 5. Unknown fields or missing values fail gracefully (no match)
 *
 * ============================================================================
 */

import fs from "fs";
import yaml from "js-yaml";

// Decision outcomes - these are the only valid outcomes
export const OUTCOMES = {
  SAFE_ALLOW: "SAFE_ALLOW",
  SAFE_DENY: "SAFE_DENY",
  GREY_ZONE: "GREY_ZONE",
};

// Supported comparison operators
const OPERATORS = {
  eq: (a, b) => a === b,
  neq: (a, b) => a !== b,
  gt: (a, b) => a > b,
  gte: (a, b) => a >= b,
  lt: (a, b) => a < b,
  lte: (a, b) => a <= b,
  in: (a, b) => Array.isArray(b) && b.includes(a),
  nin: (a, b) => Array.isArray(b) && !b.includes(a),
  // exists: (a, b) => b ? a !== undefined : a === undefined,
  exists: (a, b) => {
    const exists = a !== undefined && a !== null;
    return b === true ? exists : !exists;
  },
  // regex: (a, b) => new RegExp(b).test(String(a)),
  regex: (a, b) => {
    try {
      return new RegExp(b).test(String(a));
    } catch {
      return false;
    }
  },
};

/**
 * RuleEngine class - evaluates requests against configured rules
 */
export class RuleEngine {
  constructor(configPath) {
    this.configPath = configPath;
    this.rules = [];
    this.defaults = {};
    this.aiConfig = {};
    this.metadata = {};
  }

  /**
   * Load rules from YAML configuration file
   * Called at startup and can be called again for hot-reload
   */
  loadRules() {
    try {
      const configContent = fs.readFileSync(this.configPath, "utf8");
      const config = yaml.load(configContent);

      // Extract and sort rules by priority (descending)
      // this.rules = (config.rules || [])
      //   .filter((rule) => rule.enabled !== false)
      //   .sort((a, b) => (b.priority || 0) - (a.priority || 0));

      this.rules = (config.rules || [])
        .filter(
          (rule) =>
            rule.id &&
            rule.condition &&
            Object.values(OUTCOMES).includes(rule.outcome) &&
            rule.enabled !== false
        )
        .sort((a, b) => (b.priority || 0) - (a.priority || 0));

      this.defaults = config.defaults || {
        no_match_outcome: OUTCOMES.GREY_ZONE,
      };
      this.aiConfig = config.ai_config || {};
      this.metadata = config.metadata || {};

      console.log(
        `[RuleEngine] Loaded ${this.rules.length} active rules from ${this.configPath}`
      );
      return true;
    } catch (error) {
      console.error(`[RuleEngine] Failed to load rules: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get nested value from object using dot notation
   * Example: getValue({a: {b: 1}}, 'a.b') => 1
   */
  getValue(obj, path) {
    return path.split(".").reduce((current, key) => {
      return current && current[key] !== undefined ? current[key] : undefined;
    }, obj);
  }

  /**
   * Evaluate a single condition against input data
   * Returns true if condition matches, false otherwise
   */
  evaluateCondition(condition, input) {
    // Handle compound conditions (AND/OR)
    if (condition.operator) {
      if (!Array.isArray(condition.operands)) {
        return false;
      }
      const results = condition.operands.map((op) =>
        this.evaluateCondition(op, input)
      );

      if (condition.operator === "AND") {
        return results.every((r) => r === true);
      } else if (condition.operator === "OR") {
        return results.some((r) => r === true);
      }
      return false;
    }

    // Handle simple field comparison
    const { field, op, value } = condition;
    const actualValue = this.getValue(input, field);

    // Get comparison function
    const compareFn = OPERATORS[op];
    if (!compareFn) {
      console.warn(`[RuleEngine] Unknown operator: ${op}`);
      return false;
    }

    try {
      return compareFn(actualValue, value);
    } catch (error) {
      console.warn(`[RuleEngine] Error evaluating condition: ${error.message}`);
      return false;
    }
  }

  /**
   * Main evaluation method - processes input against all rules
   * Returns: { outcome, matchedRule, evaluationPath }
   */
  evaluate(input) {
    const startTime = Date.now();
    const evaluationPath = [];

    // Validate input structure
    if (!input || typeof input !== "object") {
      return {
        outcome: this.defaults.no_match_outcome,
        matchedRule: null,
        evaluationPath: ["INVALID_INPUT"],
        evaluationTimeMs: Date.now() - startTime,
      };
    }

    // Evaluate rules in priority order
    for (const rule of this.rules) {
      const matches = this.evaluateCondition(rule.condition, input);

      evaluationPath.push({
        ruleId: rule.id,
        ruleName: rule.name,
        matched: matches,
      });

      if (matches) {
        return {
          outcome: rule.outcome,
          matchedRule: {
            id: rule.id,
            name: rule.name,
            priority: rule.priority,
          },
          evaluationPath,
          evaluationTimeMs: Date.now() - startTime,
        };
      }
    }

    // No rule matched - return default outcome
    return {
      outcome: this.defaults.no_match_outcome,
      matchedRule: null,
      evaluationPath,
      evaluationTimeMs: Date.now() - startTime,
    };
  }

  /**
   * Get AI configuration for grey-zone analysis
   */
  getAIConfig() {
    return this.aiConfig;
  }

  /**
   * Get all loaded rules (for debugging/admin endpoints)
   */
  getRules() {
    return this.rules.map((r) => ({
      id: r.id,
      name: r.name,
      outcome: r.outcome,
      priority: r.priority,
      enabled: r.enabled !== false,
    }));
  }

  /**
   * Get engine metadata
   */
  getMetadata() {
    return {
      ...this.metadata,
      rulesCount: this.rules.length,
      defaultOutcome: this.defaults.no_match_outcome,
    };
  }
}

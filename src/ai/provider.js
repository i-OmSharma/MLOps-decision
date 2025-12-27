/**
 * ============================================================================
 * AI PROVIDER BUILDER
 * ============================================================================
 * Builds ordered AI provider list from environment variables
 *
 * Priority:
 * 1. Gemini 3 Flash
 * 2. Gemini 2.5 Flash
 * 3. Claude
 *
 * Responsibility:
 * - Read env
 * - Skip invalid configs
 * - Return clean provider array
 * ============================================================================
 */

export function buildAIProviders(env) {
  const providers = [];

  // --------------------------------------------------------------------------
  // Gemini - Primary (3 Flash)
  // --------------------------------------------------------------------------
  if (env.GEMINI_API_KEY && env.GEMINI_PRIMARY_MODEL) {
    providers.push({
      name: "gemini",
      model: env.GEMINI_PRIMARY_MODEL,
      apiKey: env.GEMINI_API_KEY,
      apiUrl: "https://generativelanguage.googleapis.com/v1/models"
    });
  }

  // --------------------------------------------------------------------------
  // Gemini - Fallback (2.5 Flash)
  // --------------------------------------------------------------------------
  if (
    env.GEMINI_API_KEY &&
    env.GEMINI_FALLBACK_MODEL &&
    env.GEMINI_FALLBACK_MODEL !== env.GEMINI_PRIMARY_MODEL
  ) {
    providers.push({
      name: "gemini",
      model: env.GEMINI_FALLBACK_MODEL,
      apiKey: env.GEMINI_API_KEY,
      apiUrl: "https://generativelanguage.googleapis.com/v1/models"
    });
  }

  // --------------------------------------------------------------------------
  // Claude (Anthropic)
  // --------------------------------------------------------------------------
  if (env.CLAUDE_API_KEY && env.CLAUDE_MODEL) {
    providers.push({
      name: "claude",
      model: env.CLAUDE_MODEL,
      apiKey: env.CLAUDE_API_KEY,
      apiUrl: "https://api.anthropic.com/v1/messages"
    });
  }

  return providers;
}

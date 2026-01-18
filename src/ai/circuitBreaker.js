/**
 * ============================================================================
 * CIRCUIT BREAKER - Protects against cascading failures
 * ============================================================================
 * Prevents repeated calls to failing AI providers
 * Reduces latency when providers are down
 * Automatically recovers when providers come back online
 * ============================================================================
 */

const CIRCUIT_STATES = {
  CLOSED: "CLOSED", // Normal operation, requests allowed
  OPEN: "OPEN", // Too many failures, requests blocked
  HALF_OPEN: "HALF_OPEN", // Testing if provider recovered
};

export class CircuitBreaker {
  constructor(options = {}) {
    this.failureThreshold = options.failureThreshold || 5; // Open after N failures
    this.resetTimeout = options.resetTimeout || 60000; // Try again after 60s
    this.halfOpenMaxAttempts = options.halfOpenMaxAttempts || 1; // Test with 1 request

    // Per-provider state tracking
    this.providers = new Map(); // key: providerKey, value: state object
  }

  /**
   * Get unique key for provider
   */
  getProviderKey(provider) {
    return `${provider.name}:${provider.model}`;
  }

  /**
   * Initialize provider state if not exists
   */
  initProvider(providerKey) {
    if (!this.providers.has(providerKey)) {
      this.providers.set(providerKey, {
        state: CIRCUIT_STATES.CLOSED,
        failures: 0,
        successes: 0,
        lastFailureTime: null,
        lastAttemptTime: null,
        halfOpenAttempts: 0,
      });
    }
    return this.providers.get(providerKey);
  }

  /**
   * Check if request is allowed for this provider
   * Returns: { allowed: boolean, reason?: string }
   */
  allowRequest(provider) {
    const key = this.getProviderKey(provider);
    const state = this.initProvider(key);

    const now = Date.now();

    // CLOSED state - allow all requests
    if (state.state === CIRCUIT_STATES.CLOSED) {
      return { allowed: true };
    }

    // OPEN state - check if timeout elapsed
    if (state.state === CIRCUIT_STATES.OPEN) {
      const timeSinceFailure = now - state.lastFailureTime;

      if (timeSinceFailure >= this.resetTimeout) {
        // Transition to HALF_OPEN
        state.state = CIRCUIT_STATES.HALF_OPEN;
        state.halfOpenAttempts = 0;
        console.log(
          `[CircuitBreaker] ${key} transitioning to HALF_OPEN after ${timeSinceFailure}ms`
        );
        return { allowed: true };
      }

      // Still open, reject request
      return {
        allowed: false,
        reason: `Circuit OPEN for ${key} (${this.resetTimeout - timeSinceFailure}ms remaining)`,
      };
    }

    // HALF_OPEN state - allow limited requests
    if (state.state === CIRCUIT_STATES.HALF_OPEN) {
      if (state.halfOpenAttempts < this.halfOpenMaxAttempts) {
        state.halfOpenAttempts++;
        return { allowed: true };
      }
      return {
        allowed: false,
        reason: `Circuit HALF_OPEN for ${key}, max test attempts reached`,
      };
    }

    return { allowed: true };
  }

  /**
   * Record successful request
   */
  recordSuccess(provider) {
    const key = this.getProviderKey(provider);
    const state = this.initProvider(key);

    state.successes++;
    state.failures = 0; // Reset failure count

    // If in HALF_OPEN, transition back to CLOSED
    if (state.state === CIRCUIT_STATES.HALF_OPEN) {
      state.state = CIRCUIT_STATES.CLOSED;
      console.log(`[CircuitBreaker] ${key} recovered, transitioning to CLOSED`);
    }

    state.lastAttemptTime = Date.now();
  }

  /**
   * Record failed request
   */
  recordFailure(provider, error) {
    const key = this.getProviderKey(provider);
    const state = this.initProvider(key);

    state.failures++;
    state.lastFailureTime = Date.now();
    state.lastAttemptTime = Date.now();

    // If in HALF_OPEN, go back to OPEN immediately
    if (state.state === CIRCUIT_STATES.HALF_OPEN) {
      state.state = CIRCUIT_STATES.OPEN;
      console.warn(
        `[CircuitBreaker] ${key} failed during HALF_OPEN, returning to OPEN`
      );
      return;
    }

    // Check if we should open the circuit
    if (
      state.state === CIRCUIT_STATES.CLOSED &&
      state.failures >= this.failureThreshold
    ) {
      state.state = CIRCUIT_STATES.OPEN;
      console.warn(
        `[CircuitBreaker] ${key} circuit OPENED after ${state.failures} consecutive failures`
      );
    }
  }

  /**
   * Get current state for all providers (for monitoring)
   */
  getStatus() {
    const status = {};
    for (const [key, state] of this.providers.entries()) {
      status[key] = {
        state: state.state,
        failures: state.failures,
        successes: state.successes,
        lastFailureTime: state.lastFailureTime
          ? new Date(state.lastFailureTime).toISOString()
          : null,
      };
    }
    return status;
  }

  /**
   * Manually reset circuit for a provider
   */
  reset(provider) {
    const key = this.getProviderKey(provider);
    this.providers.delete(key);
    console.log(`[CircuitBreaker] ${key} manually reset`);
  }

  /**
   * Reset all circuits
   */
  resetAll() {
    this.providers.clear();
    console.log("[CircuitBreaker] All circuits reset");
  }
}

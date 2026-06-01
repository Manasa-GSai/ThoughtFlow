export type CircuitState = "closed" | "open" | "half-open";

export interface CircuitBreakerOptions {
  failureThreshold: number;
  recoveryTimeMs: number;
}

export interface CircuitBreaker {
  getState(): CircuitState;
  recordSuccess(): void;
  recordFailure(): void;
  canExecute(): boolean;
  reset(): void;
}

export const createCircuitBreaker = (
  options: CircuitBreakerOptions = { failureThreshold: 5, recoveryTimeMs: 30000 }
): CircuitBreaker => {
  let state: CircuitState = "closed";
  let consecutiveFailures = 0;
  let lastFailureTime = 0;

  return {
    getState(): CircuitState {
      if (state === "open") {
        const elapsed = Date.now() - lastFailureTime;
        if (elapsed >= options.recoveryTimeMs) {
          state = "half-open";
        }
      }
      return state;
    },

    recordSuccess(): void {
      consecutiveFailures = 0;
      state = "closed";
    },

    recordFailure(): void {
      consecutiveFailures++;
      lastFailureTime = Date.now();
      if (consecutiveFailures >= options.failureThreshold) {
        state = "open";
      }
    },

    canExecute(): boolean {
      const currentState = this.getState();
      return currentState === "closed" || currentState === "half-open";
    },

    reset(): void {
      state = "closed";
      consecutiveFailures = 0;
      lastFailureTime = 0;
    },
  };
};

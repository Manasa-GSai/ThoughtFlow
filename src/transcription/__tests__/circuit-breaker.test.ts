import { createCircuitBreaker } from "../circuit-breaker";

describe("CircuitBreaker", () => {
  it("starts in closed state", () => {
    const cb = createCircuitBreaker();
    expect(cb.getState()).toBe("closed");
    expect(cb.canExecute()).toBe(true);
  });

  it("stays closed below failure threshold", () => {
    const cb = createCircuitBreaker({ failureThreshold: 5, recoveryTimeMs: 30000 });
    for (let i = 0; i < 4; i++) cb.recordFailure();
    expect(cb.getState()).toBe("closed");
    expect(cb.canExecute()).toBe(true);
  });

  it("opens after reaching failure threshold", () => {
    const cb = createCircuitBreaker({ failureThreshold: 5, recoveryTimeMs: 30000 });
    for (let i = 0; i < 5; i++) cb.recordFailure();
    expect(cb.getState()).toBe("open");
    expect(cb.canExecute()).toBe(false);
  });

  it("transitions to half-open after recovery time", () => {
    jest.useFakeTimers();
    const cb = createCircuitBreaker({ failureThreshold: 5, recoveryTimeMs: 30000 });
    for (let i = 0; i < 5; i++) cb.recordFailure();
    expect(cb.getState()).toBe("open");

    jest.advanceTimersByTime(30000);
    expect(cb.getState()).toBe("half-open");
    expect(cb.canExecute()).toBe(true);

    jest.useRealTimers();
  });

  it("closes on success from half-open state", () => {
    jest.useFakeTimers();
    const cb = createCircuitBreaker({ failureThreshold: 5, recoveryTimeMs: 30000 });
    for (let i = 0; i < 5; i++) cb.recordFailure();
    jest.advanceTimersByTime(30000);
    expect(cb.getState()).toBe("half-open");

    cb.recordSuccess();
    expect(cb.getState()).toBe("closed");

    jest.useRealTimers();
  });

  it("reopens on failure from half-open state", () => {
    jest.useFakeTimers();
    const cb = createCircuitBreaker({ failureThreshold: 1, recoveryTimeMs: 1000 });
    cb.recordFailure();
    expect(cb.getState()).toBe("open");

    jest.advanceTimersByTime(1000);
    expect(cb.getState()).toBe("half-open");

    cb.recordFailure();
    expect(cb.getState()).toBe("open");

    jest.useRealTimers();
  });

  it("resets to initial state", () => {
    const cb = createCircuitBreaker({ failureThreshold: 5, recoveryTimeMs: 30000 });
    for (let i = 0; i < 5; i++) cb.recordFailure();
    expect(cb.getState()).toBe("open");

    cb.reset();
    expect(cb.getState()).toBe("closed");
    expect(cb.canExecute()).toBe(true);
  });

  it("resets failure count on success", () => {
    const cb = createCircuitBreaker({ failureThreshold: 5, recoveryTimeMs: 30000 });
    for (let i = 0; i < 4; i++) cb.recordFailure();
    cb.recordSuccess();
    // Now 4 more failures shouldn't open it (counter was reset)
    for (let i = 0; i < 4; i++) cb.recordFailure();
    expect(cb.getState()).toBe("closed");
  });
});

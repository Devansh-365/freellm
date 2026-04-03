import type { CircuitBreakerState } from "./types.js";

interface CircuitBreakerConfig {
  failureThreshold: number;
  successThreshold: number;
  timeout: number;
}

const DEFAULT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 3,
  successThreshold: 2,
  timeout: 30_000,
};

export class CircuitBreaker {
  private state: CircuitBreakerState = "closed";
  private failureCount = 0;
  private successCount = 0;
  private nextAttemptAt: number | null = null;
  private config: CircuitBreakerConfig;

  constructor(config: Partial<CircuitBreakerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  getState(): CircuitBreakerState {
    if (this.state === "open") {
      if (Date.now() >= (this.nextAttemptAt ?? 0)) {
        this.state = "half_open";
        this.successCount = 0;
      }
    }
    return this.state;
  }

  isAllowed(): boolean {
    return this.getState() !== "open";
  }

  onSuccess(): void {
    const state = this.getState();
    if (state === "half_open") {
      this.successCount++;
      if (this.successCount >= this.config.successThreshold) {
        this.reset();
      }
    } else if (state === "closed") {
      this.failureCount = 0;
    }
  }

  onFailure(): void {
    const state = this.getState();
    if (state === "half_open") {
      this.trip();
    } else if (state === "closed") {
      this.failureCount++;
      if (this.failureCount >= this.config.failureThreshold) {
        this.trip();
      }
    }
  }

  trip(): void {
    this.state = "open";
    this.nextAttemptAt = Date.now() + this.config.timeout;
    this.failureCount = 0;
    this.successCount = 0;
  }

  reset(): void {
    this.state = "closed";
    this.failureCount = 0;
    this.successCount = 0;
    this.nextAttemptAt = null;
  }
}

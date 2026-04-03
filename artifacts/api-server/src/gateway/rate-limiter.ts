interface RateLimitEntry {
  blockedUntil: number;
  retryAfter: number;
}

const DEFAULT_COOLDOWN_MS = 60_000;

export class RateLimiter {
  private limits = new Map<string, RateLimitEntry>();

  isRateLimited(providerId: string): boolean {
    const entry = this.limits.get(providerId);
    if (!entry) return false;
    if (Date.now() >= entry.blockedUntil) {
      this.limits.delete(providerId);
      return false;
    }
    return true;
  }

  markRateLimited(providerId: string, retryAfterSeconds?: number): void {
    const cooldown = retryAfterSeconds
      ? retryAfterSeconds * 1000
      : DEFAULT_COOLDOWN_MS;
    this.limits.set(providerId, {
      blockedUntil: Date.now() + cooldown,
      retryAfter: cooldown,
    });
  }

  clearRateLimit(providerId: string): void {
    this.limits.delete(providerId);
  }

  getRetryAfterMs(providerId: string): number | null {
    const entry = this.limits.get(providerId);
    if (!entry) return null;
    const remaining = entry.blockedUntil - Date.now();
    return remaining > 0 ? remaining : null;
  }
}

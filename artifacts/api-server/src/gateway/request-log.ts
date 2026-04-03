import type { RequestLogEntry, RequestStatus } from "./types.js";
import { randomUUID } from "crypto";

const MAX_LOG_ENTRIES = 500;

export interface GatewayStats {
  totalRequests: number;
  successRequests: number;
  failedRequests: number;
}

export class RequestLog {
  private entries: RequestLogEntry[] = [];
  private stats: GatewayStats = {
    totalRequests: 0,
    successRequests: 0,
    failedRequests: 0,
  };

  add(entry: Omit<RequestLogEntry, "id" | "timestamp">): RequestLogEntry {
    const full: RequestLogEntry = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      ...entry,
    };

    this.entries.unshift(full);
    if (this.entries.length > MAX_LOG_ENTRIES) {
      this.entries.pop();
    }

    this.stats.totalRequests++;
    if (entry.status === "success") {
      this.stats.successRequests++;
    } else {
      this.stats.failedRequests++;
    }

    return full;
  }

  getRecent(limit = 50): RequestLogEntry[] {
    return this.entries.slice(0, limit);
  }

  getStats(): GatewayStats {
    return { ...this.stats };
  }
}

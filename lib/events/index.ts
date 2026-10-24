import {
  insertActivityEvent,
  createNotification,
  type ActivityEventRecord,
} from '@/lib/db';
import type { DataOrigin } from '@/lib/db/schema';

export interface StreamPacket {
  event: 'activity' | 'notification' | 'refresh' | 'heartbeat' | 'monitoring_status';
  data: unknown;
  timestamp: string;
}

type StreamListener = (packet: StreamPacket) => void;

class DevScopeEventBus {
  private listeners = new Set<StreamListener>();
  private recentHashes = new Map<string, number>();

  public subscribe(listener: StreamListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public getSubscriberCount(): number {
    return this.listeners.size;
  }

  public broadcast(event: StreamPacket['event'], data: unknown): void {
    const packet: StreamPacket = {
      event,
      data,
      timestamp: new Date().toISOString(),
    };
    for (const listener of this.listeners) {
      try {
        listener(packet);
      } catch {
        // Ignore broken listener pipe
      }
    }
  }

  /**
   * High-frequency in-memory debounce check (e.g. within 2500ms) layered ahead of SQLite deduplication.
   */
  public shouldIngest(signature: string, windowMs = 2500): boolean {
    const now = Date.now();
    const prev = this.recentHashes.get(signature);
    if (prev && now - prev < windowMs) {
      return false;
    }
    this.recentHashes.set(signature, now);
    if (this.recentHashes.size > 2000) {
      for (const [k, ts] of this.recentHashes.entries()) {
        if (now - ts > 30000) this.recentHashes.delete(k);
      }
    }
    return true;
  }
}

const globalForEvents = globalThis as unknown as {
  __devscopeEventBus?: DevScopeEventBus;
};

export const eventBus =
  globalForEvents.__devscopeEventBus ??
  (globalForEvents.__devscopeEventBus = new DevScopeEventBus());

export function ingestActivityEvent(input: {
  dedupeKey?: string;
  type: string;
  category: ActivityEventRecord['category'];
  title: string;
  detail?: string;
  source: string;
  dataOrigin?: DataOrigin;
  severity?: ActivityEventRecord['severity'];
  projectId?: string | null;
  sessionId?: string | null;
  taskId?: string | null;
  filePath?: string | null;
  metadata?: Record<string, unknown>;
  timestamp?: string;
}): { inserted: boolean; event: ActivityEventRecord } {
  const result = insertActivityEvent(input);
  if (result.inserted) {
    eventBus.broadcast('activity', result.event);

    // Trigger configurable local notifications for important failure events
    if (
      result.event.severity === 'error' ||
      result.event.type === 'build_failed' ||
      result.event.type === 'test_failed' ||
      result.event.type === 'task_failed' ||
      result.event.type === 'integration_disconnected'
    ) {
      const notification = createNotification({
        type: result.event.type,
        severity: 'error',
        title: result.event.title,
        message: result.event.detail || `Observed from ${result.event.source}`,
        projectId: result.event.projectId,
        link: result.event.projectId ? `/projects?id=${result.event.projectId}` : '/errors',
      });
      if (notification) {
        eventBus.broadcast('notification', notification);
      }
    }
  }
  return result;
}

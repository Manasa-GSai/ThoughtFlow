import { AsyncLocalStorage } from 'node:async_hooks';

export interface CorrelationContext {
  correlation_id: string;
  user_id?: string;
}

const storage = new AsyncLocalStorage<CorrelationContext>();

export function runWithCorrelation<T>(
  context: CorrelationContext,
  fn: () => T,
): T {
  return storage.run(context, fn);
}

export function getCorrelationContext(): CorrelationContext | undefined {
  return storage.getStore();
}

export function getCorrelationId(): string | undefined {
  return storage.getStore()?.correlation_id;
}

export function setUserId(user_id: string): void {
  const ctx = storage.getStore();
  if (ctx) {
    ctx.user_id = user_id;
  }
}

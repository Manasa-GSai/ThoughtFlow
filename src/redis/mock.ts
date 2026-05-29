import RedisMock from "ioredis-mock";

/**
 * Creates a mock Redis client for use in unit tests.
 * Provides the same interface as ioredis but operates in-memory.
 */
export const createMockRedisClient = (): InstanceType<typeof RedisMock> => {
  return new RedisMock();
};

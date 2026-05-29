import Redis, { RedisOptions } from "ioredis";

export interface RedisClientConfig {
  host: string;
  port: number;
  password?: string;
  tls?: boolean;
  keyPrefix?: string;
  maxRetriesPerRequest?: number;
}

const DEFAULT_CONFIG: RedisClientConfig = {
  host: process.env.REDIS_HOST || "localhost",
  port: parseInt(process.env.REDIS_PORT || "6379", 10),
  password: process.env.REDIS_PASSWORD,
  tls: process.env.REDIS_TLS === "true",
  keyPrefix: "thoughtflow:",
};

let client: Redis | null = null;
let isConnected = false;

const buildRedisOptions = (config: RedisClientConfig): RedisOptions => {
  const options: RedisOptions = {
    host: config.host,
    port: config.port,
    password: config.password,
    keyPrefix: config.keyPrefix,
    maxRetriesPerRequest: config.maxRetriesPerRequest ?? 3,
    retryStrategy: (times: number) => {
      const delay = Math.min(Math.pow(2, times - 1) * 1000, 30000);
      console.warn(
        `[Redis] Reconnection attempt ${times}, retrying in ${delay}ms`
      );
      return delay;
    },
    reconnectOnError: (err) => {
      const targetErrors = ["READONLY", "ECONNRESET", "ETIMEDOUT"];
      return targetErrors.some((e) => err.message.includes(e));
    },
    lazyConnect: true,
  };

  if (config.tls) {
    options.tls = { rejectUnauthorized: true };
  }

  return options;
};

export const getRedisClient = (config?: RedisClientConfig): Redis => {
  if (!client) {
    const resolvedConfig = config || DEFAULT_CONFIG;
    client = new Redis(buildRedisOptions(resolvedConfig));

    client.on("connect", () => {
      isConnected = true;
      console.info("[Redis] Connected successfully");
    });

    client.on("error", (err) => {
      isConnected = false;
      console.error("[Redis] Connection error:", err.message);
    });

    client.on("close", () => {
      isConnected = false;
      console.warn("[Redis] Connection closed");
    });

    client.on("reconnecting", (delay: number) => {
      console.warn(`[Redis] Reconnecting in ${delay}ms...`);
    });
  }

  return client;
};

export const isRedisConnected = (): boolean => isConnected;

export const closeRedisClient = async (): Promise<void> => {
  if (client) {
    await client.quit();
    client = null;
    isConnected = false;
  }
};

export const resetRedisClient = (): void => {
  client = null;
  isConnected = false;
};

import { Pool, PoolConfig } from "pg";

const getPoolConfig = (): PoolConfig => {
  const config: PoolConfig = {
    host: process.env.DB_HOST || "localhost",
    port: parseInt(process.env.DB_PORT || "5432", 10),
    database: process.env.DB_NAME || "thoughtflow",
    user: process.env.DB_USER || "thoughtflow_app",
    password: process.env.DB_PASSWORD || "password",
    max: parseInt(process.env.DB_POOL_MAX || "20", 10),
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  };

  if (process.env.DB_SSL === "true") {
    config.ssl = { rejectUnauthorized: true };
  }

  return config;
};

let pool: Pool | null = null;

export const getPool = (): Pool => {
  if (!pool) {
    pool = new Pool(getPoolConfig());

    pool.on("error", (err) => {
      console.error("Unexpected database pool error:", err.message);
    });
  }
  return pool;
};

export const closePool = async (): Promise<void> => {
  if (pool) {
    await pool.end();
    pool = null;
  }
};

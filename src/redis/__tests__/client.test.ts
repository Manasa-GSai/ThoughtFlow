import { resetRedisClient } from "../client";

jest.mock("ioredis", () => {
  const RedisMock = require("ioredis-mock");
  return RedisMock;
});

describe("Redis Client", () => {
  beforeEach(() => {
    resetRedisClient();
  });

  it("exports getRedisClient function", () => {
    const { getRedisClient } = require("../client");
    expect(typeof getRedisClient).toBe("function");
  });

  it("exports isRedisConnected function", () => {
    const { isRedisConnected } = require("../client");
    expect(typeof isRedisConnected).toBe("function");
  });

  it("exports closeRedisClient function", () => {
    const { closeRedisClient } = require("../client");
    expect(typeof closeRedisClient).toBe("function");
  });

  it("isRedisConnected returns false initially", () => {
    const { isRedisConnected } = require("../client");
    expect(isRedisConnected()).toBe(false);
  });

  it("getRedisClient returns the same instance on multiple calls", () => {
    const { getRedisClient } = require("../client");
    const client1 = getRedisClient();
    const client2 = getRedisClient();
    expect(client1).toBe(client2);
  });

  it("resetRedisClient clears the singleton", () => {
    const { getRedisClient, resetRedisClient: reset } = require("../client");
    const client1 = getRedisClient();
    reset();
    const client2 = getRedisClient();
    expect(client1).not.toBe(client2);
  });
});

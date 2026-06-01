import { StorageClient } from "./client";

export const createMockStorageClient = (): StorageClient & {
  getStore: () => Map<string, { body: Buffer; contentType: string }>;
  reset: () => void;
} => {
  const store = new Map<string, { body: Buffer; contentType: string }>();

  return {
    async upload(key: string, body: Buffer, contentType: string): Promise<string> {
      store.set(key, { body, contentType });
      return `s3://mock-bucket/${key}`;
    },

    async delete(key: string): Promise<void> {
      store.delete(key);
    },

    async exists(key: string): Promise<boolean> {
      return store.has(key);
    },

    getStore: () => store,
    reset: () => store.clear(),
  };
};

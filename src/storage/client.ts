import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";

export interface StorageClient {
  upload(key: string, body: Buffer, contentType: string): Promise<string>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}

const createS3StorageClient = (): StorageClient => {
  const bucket = process.env.S3_BUCKET || "thoughtflow-audio";
  const region = process.env.AWS_REGION || "us-east-1";

  const s3 = new S3Client({ region });

  return {
    async upload(key: string, body: Buffer, contentType: string): Promise<string> {
      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
          ServerSideEncryption: "AES256",
        })
      );
      return `s3://${bucket}/${key}`;
    },

    async delete(key: string): Promise<void> {
      await s3.send(
        new DeleteObjectCommand({
          Bucket: bucket,
          Key: key,
        })
      );
    },

    async exists(key: string): Promise<boolean> {
      try {
        await s3.send(
          new GetObjectCommand({
            Bucket: bucket,
            Key: key,
          })
        );
        return true;
      } catch (err: any) {
        if (err.name === "NoSuchKey" || err.$metadata?.httpStatusCode === 404) {
          return false;
        }
        throw err;
      }
    },
  };
};

export { createS3StorageClient };

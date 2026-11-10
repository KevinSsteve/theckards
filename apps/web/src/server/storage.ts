import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { env } from "./env";

const s3 = new S3Client({});

export async function getPrivateObject(key: string): Promise<Uint8Array> {
  const result = await s3.send(new GetObjectCommand({ Bucket: env().DOCUMENTS_BUCKET, Key: key }));
  if (!result.Body) throw new Error("S3 object body is missing");
  return result.Body.transformToByteArray();
}

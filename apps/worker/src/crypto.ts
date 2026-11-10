import { DecryptCommand, KMSClient } from "@aws-sdk/client-kms";

const kms = new KMSClient({});

export async function decryptText(ciphertextBase64: string | Uint8Array, purpose: string): Promise<string> {
  const ciphertext = typeof ciphertextBase64 === "string" ? Buffer.from(ciphertextBase64, "base64") : ciphertextBase64;
  const result = await kms.send(new DecryptCommand({
    CiphertextBlob: ciphertext,
    EncryptionContext: { service: "theckards", purpose },
  }));
  if (!result.Plaintext) throw new Error("KMS did not return plaintext");
  return Buffer.from(result.Plaintext).toString("utf8");
}

import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { describe, expect, it } from "vitest";
import { contentSecurityPolicy, newNonce, s3BucketOrigin } from "./csp";

const nonce = "MTIzNDU2Nzg5MDEyMzQ1Ng==";
const bucket = "theckards-prod-evidence-quarantine-116708768297";
const uploads = `https://${bucket}.s3.us-east-1.amazonaws.com`;

function directives(policy: string): Map<string, string[]> {
  return new Map(policy.split("; ").map((directive) => {
    const [name, ...sources] = directive.split(" ");
    return [name!, sources];
  }));
}

describe("the production Content-Security-Policy (R-SEC-3)", () => {
  const policy = directives(contentSecurityPolicy({ nonce, connectTo: [uploads] }));

  it("runs only scripts that carry the nonce, or that such a script loads", () => {
    expect(policy.get("script-src")).toEqual(["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", "'wasm-unsafe-eval'"]);
  });

  // ZAP rule 10055 rates each of these Medium, and any of them would undo what the nonce is for.
  it("never allows inline code, eval or a wildcard source", () => {
    const sources = [...policy.values()].flat();
    for (const unsafe of ["'unsafe-inline'", "'unsafe-eval'", "'unsafe-hashes'", "*", "https:", "data:", "blob:"]) {
      expect(sources).not.toContain(unsafe);
    }
  });

  it("takes styles from the stylesheet, plus style elements Next.js stamps with the nonce", () => {
    expect(policy.get("style-src")).toEqual(["'self'", `'nonce-${nonce}'`]);
  });

  it("states the directives that have no fallback, and closes the ones an injection would use", () => {
    expect(policy.get("default-src")).toEqual(["'self'"]);
    expect(policy.get("frame-ancestors")).toEqual(["'none'"]);
    expect(policy.get("form-action")).toEqual(["'self'"]);
    expect(policy.get("base-uri")).toEqual(["'none'"]);
    expect(policy.get("object-src")).toEqual(["'none'"]);
  });

  it("lets a page send requests to its own origin and the evidence upload bucket, nowhere else", () => {
    expect(policy.get("connect-src")).toEqual(["'self'", uploads]);
  });
});

describe("the development policy", () => {
  it("adds only what next dev needs: eval for fast refresh, and inline styles it injects without the nonce", () => {
    const policy = directives(contentSecurityPolicy({ nonce, development: true }));
    expect(policy.get("script-src")).toEqual(["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", "'wasm-unsafe-eval'", "'unsafe-eval'"]);
    expect(policy.get("style-src")).toEqual(["'self'", "'unsafe-inline'"]);
  });
});

describe("values that could rewrite the policy", () => {
  it("refuses a nonce that is not 16 bytes of base64", () => {
    for (const bad of ["", "abc", `${nonce}; script-src *`, `${nonce} 'unsafe-inline'`, "MTIzNDU2Nzg5MDEyMzQ1Njc4OQ=="]) {
      expect(() => contentSecurityPolicy({ nonce: bad }), bad).toThrow();
    }
  });

  it("refuses connect sources that are not bare https origins", () => {
    for (const bad of ["http://example.com", "https://example.com/path", "*", "https:", "https://a.example; script-src *"]) {
      expect(() => contentSecurityPolicy({ nonce, connectTo: [bad] }), bad).toThrow();
    }
  });

  it("leaves a missing or malformed bucket setting out of the policy", () => {
    expect(s3BucketOrigin(undefined, "us-east-1")).toBeUndefined();
    expect(s3BucketOrigin("", "us-east-1")).toBeUndefined();
    expect(s3BucketOrigin("Not_A_Bucket", "us-east-1")).toBeUndefined();
    expect(s3BucketOrigin(bucket, "us-east-1; script-src *")).toBeUndefined();
    expect(s3BucketOrigin(bucket, undefined)).toBeUndefined();
  });
});

describe("the evidence upload origin", () => {
  // If the SDK ever signs for another host (path style, the global endpoint, dual-stack), the browser would block
  // every upload while each server-side test still passed. This ties the policy to what the presigner produces.
  it("is the host the presigner signs uploads for, built the way the evidence module builds its client", async () => {
    const s3 = new S3Client({ region: "us-east-1", credentials: { accessKeyId: "test", secretAccessKey: "test" } });
    const url = await getSignedUrl(s3, new PutObjectCommand({ Bucket: bucket, Key: "quarantine/x", ContentType: "image/png", ContentLength: 1 }), { expiresIn: 60 });
    expect(new URL(url).origin).toBe(s3BucketOrigin(bucket, "us-east-1"));
  });
});

describe("nonces", () => {
  it("are 16 random bytes, different every time", () => {
    const nonces = new Set(Array.from({ length: 200 }, () => newNonce()));
    expect(nonces.size).toBe(200);
    for (const value of nonces) expect(atob(value)).toHaveLength(16);
  });
});

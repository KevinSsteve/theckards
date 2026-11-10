import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
let tables: { member: Row[]; parties: Row[]; existing: Row[]; row: Row[] };
const calls: { sql: string; values: unknown[] }[] = [];
const query = vi.fn(async (sql: string, values: unknown[] = []) => {
  calls.push({ sql, values });
  if (sql.includes("JOIN parties p ON p.agreement_id = a.id")) return { rows: tables.member };
  if (sql.includes("COALESCE(s.typed_name, p.display_name)")) return { rows: tables.parties };
  if (sql.includes("FROM evidence WHERE party_id = $1 AND client_key = $2")) return { rows: tables.existing };
  if (sql.includes("FROM evidence WHERE id = $1")) return { rows: tables.row };
  if (sql.includes("RETURNING id, quarantine_key, scan_status")) {
    return { rows: [{ id: "ev-1", quarantine_key: String(values[6]), scan_status: "AWAITING_UPLOAD" }], rowCount: 1 };
  }
  return { rows: [], rowCount: 1 };
});
const client = { query };
let privacy = 4;
vi.mock("./db", () => ({ getPool: () => client, inTransaction: (work: (c: typeof client) => unknown) => work(client) }));
vi.mock("./legal", () => ({
  userHasCurrentConsents: async () => true,
  currentApprovedLegal: async () => [{ documentType: "PRIVACY", version: privacy }],
}));
vi.mock("./crypto", () => ({ sha256: (v: string) => v.slice(0, 64), randomToken: () => "random-token" }));
type Presign = (client: unknown, command: { input: Record<string, unknown> }) => Promise<string>;
const presign = vi.fn<Presign>(async () => "https://s3.example/presigned");
vi.mock("@aws-sdk/s3-request-presigner", () => ({ getSignedUrl: presign }));
vi.mock("./env", () => ({ env: () => ({ EVIDENCE_QUARANTINE_BUCKET: "quarantine" }) }));
const { evidenceObject, listEvidence, requestEvidenceUpload } = await import("./evidence");

const A = "11111111-1111-1111-1111-111111111111";
const upload = { userId: "u-cp", agreementId: A, filename: "photo.jpg", contentType: "image/jpeg", bytes: 1024, idempotencyKey: "k-1234567" };
const memberRow = (state = "EXECUTED") =>
  ({ id: A, state, template_id: "purchase_sale", due_at: null, version_id: "v1", fields: {}, party_id: "p-cp", party_role: "COUNTERPARTY" });

beforeEach(() => {
  calls.length = 0; query.mockClear(); presign.mockClear(); privacy = 4;
  tables = { member: [memberRow()], parties: [{ id: "p-cp", role: "COUNTERPARTY", name: "Jamie" }], existing: [], row: [] };
});

describe("evidence access is limited to the agreement's parties (IDOR)", () => {
  it("returns 404 to an outsider for listing, uploading and downloading", async () => {
    tables.member = [];
    for (const op of [
      () => listEvidence("outsider", A),
      () => requestEvidenceUpload({ ...upload, userId: "outsider" }),
      () => evidenceObject("outsider", A, "ev-1"),
    ]) await expect(op()).rejects.toMatchObject({ status: 404 });
    expect(calls.some((c) => c.sql.includes("INSERT INTO evidence"))).toBe(false);
    expect(presign).not.toHaveBeenCalled();
  });
});

describe("a file becomes readable only after a clean scan", () => {
  it("refuses to serve a file that is pending, infected or unsupported", async () => {
    for (const status of ["AWAITING_UPLOAD", "PENDING", "INFECTED", "UNSUPPORTED", "FAILED"]) {
      tables.row = [{ stored_key: null, filename: "photo.jpg", content_type: "image/jpeg", scan_status: status }];
      await expect(evidenceObject("u-cp", A, "ev-1")).rejects.toMatchObject({ status: 409 });
    }
  });

  it("serves the stored copy once clean", async () => {
    tables.row = [{ stored_key: "agreements/x/evidence/ev-1.jpg", filename: "photo.jpg", content_type: "image/jpeg", scan_status: "CLEAN" }];
    await expect(evidenceObject("u-cp", A, "ev-1")).resolves.toEqual({
      key: "agreements/x/evidence/ev-1.jpg", filename: "photo.jpg", contentType: "image/jpeg",
    });
  });
});

describe("upload requests", () => {
  it("rejects a type we do not accept and a size over the limit, before touching the database", async () => {
    await expect(requestEvidenceUpload({ ...upload, contentType: "image/svg+xml" })).rejects.toMatchObject({ status: 422 });
    await expect(requestEvidenceUpload({ ...upload, bytes: 26 * 1024 * 1024 })).rejects.toMatchObject({ status: 422 });
    expect(calls).toHaveLength(0);
  });

  it("signs the upload for exactly the declared type and length", async () => {
    await expect(requestEvidenceUpload(upload)).resolves.toMatchObject({ id: "ev-1", uploadUrl: "https://s3.example/presigned" });
    const command = presign.mock.calls[0]![1];
    expect(command.input).toMatchObject({ Bucket: "quarantine", ContentType: "image/jpeg", ContentLength: 1024 });
    expect(String(command.input.Key)).toMatch(/^evidence\/[0-9a-f-]+\/random-token$/);
  });

  it("refuses before both parties sign", async () => {
    tables.member = [memberRow("PENDING_SIGNATURES")];
    await expect(requestEvidenceUpload(upload)).rejects.toMatchObject({ status: 409 });
  });

  it("blocks everything until Privacy v4 is approved", async () => {
    privacy = 3;
    await expect(requestEvidenceUpload(upload)).rejects.toMatchObject({ status: 503 });
    expect(calls).toHaveLength(0);
  });
});

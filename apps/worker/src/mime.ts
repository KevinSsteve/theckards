import { randomBytes } from "node:crypto";

export interface MailAttachment {
  filename: string;
  contentType: string;
  content: Uint8Array;
}

function encodeHeader(value: string): string {
  // RFC 2047 encoded-word so non-ASCII titles survive; ASCII passes through.
  return /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function wrap76(base64: string): string {
  return base64.replace(/.{1,76}/g, "$&\r\n");
}

function safeFilename(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]/g, "_");
}

/** Builds a multipart/mixed message with a text body and attachments. Header injection is prevented by rejecting CR/LF. */
export function buildMime(input: { from: string; to: string; subject: string; text: string; attachments: readonly MailAttachment[] }): Uint8Array {
  for (const value of [input.from, input.to, input.subject]) {
    if (/[\r\n]/.test(value)) throw new Error("Invalid email header value");
  }
  const boundary = `theckards-${randomBytes(12).toString("hex")}`;
  const parts = [
    `From: ${input.from}`,
    `To: ${input.to}`,
    `Subject: ${encodeHeader(input.subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    wrap76(Buffer.from(input.text, "utf8").toString("base64")),
  ];
  for (const attachment of input.attachments) {
    const filename = safeFilename(attachment.filename);
    parts.push(
      `--${boundary}`,
      `Content-Type: ${attachment.contentType}; name="${filename}"`,
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; filename="${filename}"`,
      "",
      wrap76(Buffer.from(attachment.content).toString("base64")),
    );
  }
  parts.push(`--${boundary}--`, "");
  return Buffer.from(parts.join("\r\n"), "utf8");
}

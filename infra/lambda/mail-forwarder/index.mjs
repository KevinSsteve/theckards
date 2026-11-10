// Forwards inbound mail for configured @theckards.linkealls.com addresses to external mailboxes.
// Invoked by the SES receipt rule after the raw message is stored in S3. Uses only the AWS SDK bundled in the runtime.
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { SendEmailCommand, SESv2Client } from "@aws-sdk/client-sesv2";

const s3 = new S3Client({});
const ses = new SESv2Client({});
const FORWARDS = JSON.parse(process.env.FORWARDS ?? "{}");
const BUCKET = process.env.BUCKET;
const PREFIX = process.env.PREFIX ?? "";
const FROM = process.env.FROM_ADDRESS;
const CONFIG_SET = process.env.CONFIG_SET;
const MAX_BYTES = 30 * 1024 * 1024;
const DROP = new Set(["from", "reply-to", "return-path", "sender", "message-id", "dkim-signature", "domainkey-signature", "x-ses-dkim-signature"]);

function rewrite(raw) {
  const text = raw.toString("latin1");
  let index = text.indexOf("\r\n\r\n");
  if (index < 0) index = text.indexOf("\n\n");
  if (index < 0) return null;
  const headers = [];
  for (const line of text.slice(0, index).split(/\r?\n/)) {
    if (/^[ \t]/.test(line) && headers.length) headers[headers.length - 1].raw += `\r\n${line}`;
    else headers.push({ name: line.slice(0, Math.max(0, line.indexOf(":"))).trim().toLowerCase(), raw: line });
  }
  const value = (name) => {
    const header = headers.find((h) => h.name === name);
    return header ? header.raw.slice(header.raw.indexOf(":") + 1).replace(/\r?\n[ \t]+/g, " ").trim() : "";
  };
  if (value("x-theckards-forwarded")) return null; // loop protection
  const originalFrom = value("from");
  const replyTo = value("reply-to") || originalFrom;
  const display = originalFrom.replace(/<[^>]*>/g, "").replace(/[()<>@,;:\\".[\]\r\n]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60) || "Unknown sender";
  const out = [`From: ${display} via Theckards <${FROM}>`, "X-Theckards-Forwarded: 1"];
  if (replyTo) out.push(`Reply-To: ${replyTo.replace(/[\r\n]/g, " ")}`);
  for (const header of headers) if (header.name && !DROP.has(header.name)) out.push(header.raw);
  return Buffer.from(out.join("\r\n") + text.slice(index), "latin1");
}

export const handler = async (event) => {
  for (const record of event.Records ?? []) {
    const { mail, receipt } = record.ses;
    if (receipt.spamVerdict?.status === "FAIL" || receipt.virusVerdict?.status === "FAIL") {
      console.log(JSON.stringify({ msg: "dropped", reason: "spam-or-virus", messageId: mail.messageId }));
      continue;
    }
    const targets = [...new Set(receipt.recipients.map((r) => FORWARDS[r.toLowerCase()]).filter(Boolean))];
    if (targets.length === 0) continue;
    const object = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: `${PREFIX}${mail.messageId}` }));
    const raw = Buffer.from(await object.Body.transformToByteArray());
    if (raw.length > MAX_BYTES) { console.log(JSON.stringify({ msg: "dropped", reason: "too-large", messageId: mail.messageId })); continue; }
    const message = rewrite(raw);
    if (!message) { console.log(JSON.stringify({ msg: "skipped", reason: "loop-or-malformed", messageId: mail.messageId })); continue; }
    await ses.send(new SendEmailCommand({
      FromEmailAddress: FROM, Destination: { ToAddresses: targets }, ConfigurationSetName: CONFIG_SET, Content: { Raw: { Data: message } },
    }));
    console.log(JSON.stringify({ msg: "forwarded", messageId: mail.messageId, targets: targets.length }));
  }
};

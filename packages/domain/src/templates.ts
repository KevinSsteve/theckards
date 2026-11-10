import { z } from "zod";

export const TemplateIdSchema = z.enum(["purchase_sale", "services", "general"]);
export type TemplateId = z.infer<typeof TemplateIdSchema>;

export interface TemplateField {
  key: string;
  label: string;
  type: "text" | "textarea" | "date" | "money" | "select";
  required: boolean;
  options?: readonly { value: string; label: string }[];
  maxLength?: number;
}

export interface AgreementSection {
  heading: string;
  paragraphs: readonly string[];
}

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
/** Accepts "400", "400.5" or "400.50"; stores the canonical two-decimal form so hashes stay stable. */
export function normalizeMoney(value: string): string {
  const [whole = "0", cents = ""] = value.split(".");
  return `${BigInt(whole).toString()}.${cents.padEnd(2, "0")}`;
}
const money = z.string().trim()
  .regex(/^\d{1,9}(?:\.\d{1,2})?$/, "Use an amount such as 400 or 400.00")
  .transform(normalizeMoney);
const paymentMethod = z.enum(["cash", "bank_transfer", "payment_app", "other"]);
const shortText = z.string().trim().min(2).max(200);
const longText = z.string().trim().min(3).max(2_000);

export const PurchaseSaleFieldsSchema = z.object({
  itemDescription: longText,
  price: money,
  paymentMethod,
  deliveryDate: date,
  deliveryMethod: shortText,
  serialNumber: z.string().trim().max(200).optional().default(""),
}).strict();

export const ServicesFieldsSchema = z.object({
  serviceDescription: longText,
  amount: money,
  paymentMethod,
  startDate: date,
  completionDate: date,
  deliverables: longText,
}).strict().refine((fields) => fields.completionDate >= fields.startDate, { message: "Completion date must not precede start date", path: ["completionDate"] });

export const GeneralFieldsSchema = z.object({
  purpose: longText,
  creatorCommitment: longText,
  counterpartyCommitment: longText,
  effectiveDate: date,
  dueDate: date.optional().or(z.literal("")),
  additionalDetails: z.string().trim().max(2_000).optional().default(""),
}).strict().refine((fields) => !fields.dueDate || fields.dueDate >= fields.effectiveDate, { message: "Due date must not precede effective date", path: ["dueDate"] });

export type PurchaseSaleFields = z.infer<typeof PurchaseSaleFieldsSchema>;
export type ServicesFields = z.infer<typeof ServicesFieldsSchema>;
export type GeneralFields = z.infer<typeof GeneralFieldsSchema>;
export type TemplateFields = PurchaseSaleFields | ServicesFields | GeneralFields;

const paymentOptions = [
  { value: "cash", label: "Cash paid directly between the parties" },
  { value: "bank_transfer", label: "Bank transfer directly between the parties" },
  { value: "payment_app", label: "Payment app used directly by the parties" },
  { value: "other", label: "Other direct method" },
] as const;

export interface TemplateDefinition {
  id: TemplateId;
  version: number;
  title: string;
  summary: string;
  fields: readonly TemplateField[];
}

export const templateDefinitions: Readonly<Record<TemplateId, TemplateDefinition>> = {
  purchase_sale: {
    id: "purchase_sale", version: 1, title: "Purchase and sale", summary: "Record the sale and delivery of an item.",
    fields: [
      { key: "itemDescription", label: "Item description", type: "textarea", required: true, maxLength: 2_000 },
      { key: "price", label: "Price (USD)", type: "money", required: true },
      { key: "paymentMethod", label: "Payment method", type: "select", required: true, options: paymentOptions },
      { key: "deliveryDate", label: "Delivery date", type: "date", required: true },
      { key: "deliveryMethod", label: "Delivery method or place", type: "text", required: true, maxLength: 200 },
      { key: "serialNumber", label: "Serial number or identifier (optional)", type: "text", required: false, maxLength: 200 },
    ],
  },
  services: {
    id: "services", version: 1, title: "Services", summary: "Record a service, deliverables, dates and direct payment terms.",
    fields: [
      { key: "serviceDescription", label: "Service description", type: "textarea", required: true, maxLength: 2_000 },
      { key: "amount", label: "Fee (USD)", type: "money", required: true },
      { key: "paymentMethod", label: "Payment method", type: "select", required: true, options: paymentOptions },
      { key: "startDate", label: "Start date", type: "date", required: true },
      { key: "completionDate", label: "Completion date", type: "date", required: true },
      { key: "deliverables", label: "Deliverables", type: "textarea", required: true, maxLength: 2_000 },
    ],
  },
  general: {
    id: "general", version: 1, title: "General agreement", summary: "Record mutual commitments without a specialized template.",
    fields: [
      { key: "purpose", label: "Purpose", type: "textarea", required: true, maxLength: 2_000 },
      { key: "creatorCommitment", label: "Your commitment", type: "textarea", required: true, maxLength: 2_000 },
      { key: "counterpartyCommitment", label: "Counterparty commitment", type: "textarea", required: true, maxLength: 2_000 },
      { key: "effectiveDate", label: "Effective date", type: "date", required: true },
      { key: "dueDate", label: "Due date (optional)", type: "date", required: false },
      { key: "additionalDetails", label: "Additional factual details (optional)", type: "textarea", required: false, maxLength: 2_000 },
    ],
  },
};

/** Field-level messages safe to show to the user (no values echoed back). */
export function templateFieldErrors(templateId: TemplateId, fields: unknown): Record<string, string> {
  const schema = templateId === "purchase_sale" ? PurchaseSaleFieldsSchema : templateId === "services" ? ServicesFieldsSchema : GeneralFieldsSchema;
  const result = schema.safeParse(fields);
  if (result.success) return {};
  const errors: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = String(issue.path[0] ?? "fields");
    errors[key] ??= issue.message;
  }
  return errors;
}

export function validateTemplateFields(templateId: TemplateId, fields: unknown): TemplateFields {
  switch (templateId) {
    case "purchase_sale": return PurchaseSaleFieldsSchema.parse(fields);
    case "services": return ServicesFieldsSchema.parse(fields);
    case "general": return GeneralFieldsSchema.parse(fields);
  }
}

function paymentLabel(value: string): string {
  return paymentOptions.find((option) => option.value === value)?.label ?? "Other direct method";
}

export function renderAgreement(templateId: TemplateId, fields: unknown): AgreementSection[] {
  const data = validateTemplateFields(templateId, fields);
  const notice: AgreementSection = {
    heading: "Important notice",
    paragraphs: ["This document records terms supplied and accepted by the parties. Theckards does not provide legal advice, certify identity, guarantee payment, hold funds or decide disputes."],
  };
  if (templateId === "purchase_sale") {
    const value = data as PurchaseSaleFields;
    return [
      { heading: "Item", paragraphs: [`The seller agrees to sell, and the buyer agrees to purchase, the following item: ${value.itemDescription}${value.serialNumber ? ` Identifier: ${value.serialNumber}.` : ""}`] },
      { heading: "Price and payment", paragraphs: [`The agreed price is USD ${value.price}. Payment will be made by ${paymentLabel(value.paymentMethod).toLowerCase()}. Payment takes place directly between the parties; Theckards does not receive or process it.`] },
      { heading: "Delivery", paragraphs: [`The item is to be delivered on ${value.deliveryDate} by or at: ${value.deliveryMethod}.`] },
      notice,
    ];
  }
  if (templateId === "services") {
    const value = data as ServicesFields;
    return [
      { heading: "Services", paragraphs: [`The provider agrees to perform: ${value.serviceDescription}`] },
      { heading: "Deliverables and dates", paragraphs: [`Work begins on ${value.startDate} and is due on ${value.completionDate}. Deliverables: ${value.deliverables}`] },
      { heading: "Fee and payment", paragraphs: [`The agreed fee is USD ${value.amount}, paid by ${paymentLabel(value.paymentMethod).toLowerCase()} directly between the parties. Theckards does not receive or process it.`] },
      notice,
    ];
  }
  const value = data as GeneralFields;
  return [
    { heading: "Purpose", paragraphs: [value.purpose] },
    { heading: "Commitments", paragraphs: [`Creator: ${value.creatorCommitment}`, `Counterparty: ${value.counterpartyCommitment}`] },
    { heading: "Dates", paragraphs: [`This agreement takes effect on ${value.effectiveDate}.${value.dueDate ? ` The commitments are due by ${value.dueDate}.` : ""}`] },
    ...(value.additionalDetails ? [{ heading: "Additional factual details", paragraphs: [value.additionalDetails] }] : []),
    notice,
  ];
}

export const CreateAgreementSchema = z.object({
  templateId: TemplateIdSchema,
  title: z.string().trim().min(3).max(120),
  fields: z.record(z.string(), z.unknown()),
  dueAt: z.string().datetime({ offset: true }).nullable().optional(),
});

export const UpdateAgreementSchema = CreateAgreementSchema.omit({ templateId: true });

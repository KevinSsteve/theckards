import type { TemplateId } from "./templates.js";

export const CONFIRMATION_KINDS = [
  "ITEM_DELIVERED", "ITEM_RECEIVED", "SERVICE_DONE", "SERVICE_ACCEPTED",
  "PAYMENT_SENT", "PAYMENT_RECEIVED", "FULFILLED",
] as const;
export type ConfirmationKind = (typeof CONFIRMATION_KINDS)[number];

export type PartyRole = "SELLER" | "BUYER" | "PROVIDER" | "CLIENT" | "CREATOR" | "COUNTERPARTY";

export interface Slot { kind: ConfirmationKind; role: PartyRole }
export interface Confirmation { kind: ConfirmationKind; role: PartyRole }

/** Expected confirmations (both sides of every pair). Payment pairs only when money is involved. */
export function expectedSlots(template: TemplateId, hasPayment: boolean): Slot[] {
  switch (template) {
    case "purchase_sale": {
      const s: Slot[] = [
        { kind: "ITEM_DELIVERED", role: "SELLER" },
        { kind: "ITEM_RECEIVED", role: "BUYER" },
      ];
      if (hasPayment) s.push({ kind: "PAYMENT_SENT", role: "BUYER" }, { kind: "PAYMENT_RECEIVED", role: "SELLER" });
      return s;
    }
    case "services": {
      const s: Slot[] = [
        { kind: "SERVICE_DONE", role: "PROVIDER" },
        { kind: "SERVICE_ACCEPTED", role: "CLIENT" },
      ];
      if (hasPayment) s.push({ kind: "PAYMENT_SENT", role: "CLIENT" }, { kind: "PAYMENT_RECEIVED", role: "PROVIDER" });
      return s;
    }
    case "general":
      return [
        { kind: "FULFILLED", role: "CREATOR" },
        { kind: "FULFILLED", role: "COUNTERPARTY" },
      ];
  }
}

export type Outcome = "MUTUAL" | "ONE_SIDED" | "NONE" | "PENDING";
export const NONE_GRACE_DAYS = 14;

const key = (s: Slot) => `${s.kind}:${s.role}`;

/**
 * Derived, never stored. Silence never counts as confirmation nor as breach:
 * absence is only reported as NONE (after due date + grace) or PENDING.
 */
export function outcome(
  slots: readonly Slot[],
  confirmations: readonly Confirmation[],
  dueAt: Date | null,
  now: Date,
  graceDays = NONE_GRACE_DAYS,
): Outcome {
  const have = new Set(confirmations.map(key));
  const present = slots.filter((s) => have.has(key(s))).length;
  if (slots.length > 0 && present === slots.length) return "MUTUAL";
  if (present > 0) return "ONE_SIDED";
  const deadline = dueAt ? dueAt.getTime() + graceDays * 86_400_000 : null;
  return deadline !== null && now.getTime() > deadline ? "NONE" : "PENDING";
}

/** Maps the signing party to its role in the template. Legacy versions without a role default to seller/provider. */
export function confirmationRole(template: TemplateId, party: "CREATOR" | "COUNTERPARTY", fields: Record<string, unknown>): PartyRole {
  const creatorRole = typeof fields.creatorRole === "string" ? fields.creatorRole : undefined;
  if (template === "purchase_sale") {
    const creatorIsBuyer = creatorRole === "buyer";
    return (party === "CREATOR") !== creatorIsBuyer ? "SELLER" : "BUYER";
  }
  if (template === "services") {
    const creatorIsClient = creatorRole === "client";
    return (party === "CREATOR") !== creatorIsClient ? "PROVIDER" : "CLIENT";
  }
  return party;
}

/** Payment pairs are expected only when the agreed amount is greater than zero. */
export function involvesPayment(template: TemplateId, fields: Record<string, unknown>): boolean {
  const amount = template === "purchase_sale" ? fields.price : template === "services" ? fields.amount : undefined;
  return typeof amount === "string" && Number(amount) > 0;
}

export function kindsForRole(slots: readonly Slot[], role: PartyRole): ConfirmationKind[] {
  return slots.filter((slot) => slot.role === role).map((slot) => slot.kind);
}

/** Neutral wording: declarations by a party, never verified by Theckards (G1, G3, G5). */
export const CONFIRMATION_LABELS: Readonly<Record<ConfirmationKind, string>> = {
  ITEM_DELIVERED: "Item delivered",
  ITEM_RECEIVED: "Item received",
  SERVICE_DONE: "Service completed",
  SERVICE_ACCEPTED: "Service accepted",
  PAYMENT_SENT: "Payment sent (declared)",
  PAYMENT_RECEIVED: "Payment received (declared)",
  FULFILLED: "Commitment fulfilled",
};

export const OUTCOME_LABELS: Readonly<Record<Outcome, string>> = {
  MUTUAL: "Every expected confirmation was declared by the responsible party.",
  ONE_SIDED: "Some expected confirmations are still waiting for a party.",
  PENDING: "Pending. No confirmation recorded yet.",
  NONE: "No confirmation recorded.",
};

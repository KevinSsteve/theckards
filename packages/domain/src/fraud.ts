/**
 * Deterministic rules that decide which agreements are excluded from the numbers on a public profile (S10,
 * F1–F5).
 *
 * Three principles, all of them consequences of G11.
 *
 * The rules judge *agreements*, never people. There is no score, no reputation and no label attached to an
 * account; a rule either excludes a record from a count or it does not.
 *
 * They are deterministic and explainable. Every exclusion carries the rule that caused it, the account holder
 * can read it, and nobody else can. A judgement that cannot be explained to the person affected has no business
 * shaping what others see.
 *
 * They are pure. The caller supplies the facts from the database; nothing here reads a clock or a connection, so
 * the same records always produce the same exclusions and the reasoning is testable.
 */

export const FRAUD_RULES = ["F1_SAME_PERSON", "F2_SAME_PAIR", "F3_BURST", "F5_IMMEDIATE_CONFIRMATIONS"] as const;
export type FraudRule = (typeof FRAUD_RULES)[number];

/** Why an agreement is not counted, in words the account holder reads about their own record. */
export const FRAUD_RULE_REASONS: Readonly<Record<FraudRule, string>> = {
  F1_SAME_PERSON: "Both sides of this agreement use the same email address, so it is not counted.",
  F2_SAME_PAIR: "You have several agreements with this same counterparty. Beyond the first few, they are not counted.",
  F3_BURST: "This agreement was created in a short burst of many agreements, so it is not counted.",
  F5_IMMEDIATE_CONFIRMATIONS: "The confirmations on this agreement were declared within seconds of signing, so it is not counted.",
};

export interface FraudThresholds {
  /** Agreements with the same counterparty that still count. Beyond this, the extra ones are excluded. */
  samePairAgreements: number;
  /** Agreements one account may create in 24 hours before the burst rule applies. */
  dailyAgreements: number;
  /** Confirmations declared inside `immediateSeconds` that trigger the immediacy rule. */
  immediateConfirmations: number;
  immediateSeconds: number;
  /** Accounts younger than this are shown as "New account" instead of with numbers. */
  newAccountDays: number;
}

export const DEFAULT_FRAUD_THRESHOLDS: FraudThresholds = {
  samePairAgreements: 3,
  dailyAgreements: 10,
  immediateConfirmations: 5,
  immediateSeconds: 60,
  newAccountDays: 7,
};

/**
 * The form of an address used to decide whether both sides of an agreement are the same person (F1).
 *
 * Tags and dots are provider conventions, not different people: `a.b+x@gmail.com` and `ab@gmail.com` reach the
 * same inbox. Dot-stripping applies only to the providers that actually behave that way, because elsewhere
 * `a.b@` and `ab@` can be two different people and collapsing them would block a legitimate agreement.
 */
const DOT_INSENSITIVE_DOMAINS = new Set(["gmail.com", "googlemail.com"]);

export function normalizeEmail(email: string): string {
  const trimmed = email.trim().toLowerCase();
  const at = trimmed.lastIndexOf("@");
  if (at <= 0 || at === trimmed.length - 1) return trimmed;
  const domain = trimmed.slice(at + 1);
  let local = trimmed.slice(0, at);
  const plus = local.indexOf("+");
  if (plus > 0) local = local.slice(0, plus);
  if (DOT_INSENSITIVE_DOMAINS.has(domain)) local = local.replaceAll(".", "");
  return `${local}@${domain}`;
}

/** F1, applied when an agreement is created: the two sides must not be the same mailbox. */
export function isSamePerson(creatorEmail: string, counterpartyEmail: string): boolean {
  return normalizeEmail(creatorEmail) === normalizeEmail(counterpartyEmail);
}

export interface AgreementFact {
  id: string;
  /** Stable identity of the other side: the linked account when there is one, otherwise the normalized email. */
  counterpartyKey: string | null;
  createdAt: Date;
  /** When the agreement became signed by both parties, or null if it never did. */
  executedAt: Date | null;
  /** Times at which confirmations were declared on this agreement. */
  confirmedAt: readonly Date[];
  /** True when both sides resolve to the same mailbox (F1). */
  samePerson: boolean;
}

/**
 * Which agreements are excluded, and why.
 *
 * Order matters for F2 and F3 only in the sense that the *oldest* agreements are the ones kept: a person who
 * deals with the same counterparty repeatedly keeps their first few, and a burst keeps nothing beyond the limit.
 * Ties are broken by id so the result never depends on the order rows arrive in.
 */
export function fraudFlags(
  facts: readonly AgreementFact[],
  thresholds: FraudThresholds = DEFAULT_FRAUD_THRESHOLDS,
): Map<string, FraudRule[]> {
  const flags = new Map<string, FraudRule[]>();
  const add = (id: string, rule: FraudRule): void => {
    const existing = flags.get(id);
    if (existing) { if (!existing.includes(rule)) existing.push(rule); } else flags.set(id, [rule]);
  };
  const ordered = [...facts].sort((left, right) =>
    left.createdAt.getTime() - right.createdAt.getTime() || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));

  // F1: the same mailbox on both sides.
  for (const fact of ordered) if (fact.samePerson) add(fact.id, "F1_SAME_PERSON");

  // F2: beyond the first few agreements with one counterparty, the extras stop counting.
  const perPair = new Map<string, number>();
  for (const fact of ordered) {
    if (!fact.counterpartyKey) continue;
    const seen = (perPair.get(fact.counterpartyKey) ?? 0) + 1;
    perPair.set(fact.counterpartyKey, seen);
    if (seen > thresholds.samePairAgreements) add(fact.id, "F2_SAME_PAIR");
  }

  // F3: more agreements in any 24 hours than the limit allows; the ones over the limit are excluded.
  for (const [index, fact] of ordered.entries()) {
    const windowStart = fact.createdAt.getTime() - 86_400_000;
    let inWindow = 0;
    for (let back = index; back >= 0; back -= 1) {
      if (ordered[back]!.createdAt.getTime() <= windowStart) break;
      inWindow += 1;
    }
    if (inWindow > thresholds.dailyAgreements) add(fact.id, "F3_BURST");
  }

  // F5: confirmations declared within seconds of signing are a formality, not evidence that anything happened.
  for (const fact of ordered) {
    if (!fact.executedAt) continue;
    const limit = fact.executedAt.getTime() + thresholds.immediateSeconds * 1_000;
    const immediate = fact.confirmedAt.filter((at) => at.getTime() <= limit).length;
    if (immediate >= thresholds.immediateConfirmations) add(fact.id, "F5_IMMEDIATE_CONFIRMATIONS");
  }

  return flags;
}

/** F4 is a note on the profile, not an exclusion: a new account has too little history to read anything into. */
export function isNewAccount(memberSince: Date, now: Date, thresholds: FraudThresholds = DEFAULT_FRAUD_THRESHOLDS): boolean {
  return now.getTime() - memberSince.getTime() < thresholds.newAccountDays * 86_400_000;
}

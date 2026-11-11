import type { Outcome } from "./confirmations.js";

/**
 * The public trust profile (S10): five counts, each with its definition, and nothing else.
 *
 * G11 forbids scores, stars, rankings and labels about people. What is left is deliberately plain: counts of
 * records, where each number says what it counted and where it came from. A reader can disagree with the
 * conclusion they draw, but they cannot be misled about what the figure is.
 *
 * The counts are not designed to add up. An agreement signed by both parties may have no confirmations yet, so
 * it appears in the first number and in none of the three outcome numbers. Making them reconcile would mean
 * inventing a category for silence, and silence is exactly what Theckards refuses to interpret.
 */

export const PROFILE_HANDLE_PATTERN = /^[a-z0-9_]{3,30}$/;
export const PROFILE_DISPLAY_NAME_MAX = 60;

export function isProfileHandle(value: string): boolean {
  return PROFILE_HANDLE_PATTERN.test(value);
}

/** Shown on every profile, never omitted, never reworded. */
export const PROFILE_DISCLAIMER =
  "These numbers come from records made on Theckards. They are not a guarantee, a rating or a verification of identity.";

export const PROFILE_FLAGGED_NOTE =
  "Agreements that automatic rules flagged are not counted. Theckards does not publish which agreements those are.";

export const NEW_ACCOUNT_NOTE = "New account. There is not enough history here to show numbers yet.";

export interface ProfileCounts {
  agreementsSignedByBoth: number;
  confirmedByBoth: number;
  oneSidedConfirmation: number;
  noConfirmationRecorded: number;
  differentCounterparties: number;
}

export interface ProfileNumber {
  key: keyof ProfileCounts;
  label: string;
  definition: string;
}

/** R-PROF-2 and R-PROF-3: exactly these five, each with the definition shown beside it. */
export const PROFILE_NUMBERS: readonly ProfileNumber[] = [
  {
    key: "agreementsSignedByBoth",
    label: "Agreements signed by both parties",
    definition: "Agreements where both parties signed. Drafts, invitations that were never signed and cancelled agreements are not included.",
  },
  {
    key: "confirmedByBoth",
    label: "Confirmed by both parties",
    definition: "Of those agreements, the ones where every confirmation the agreement expected was declared by the party responsible for it.",
  },
  {
    key: "oneSidedConfirmation",
    label: "One-sided confirmation",
    definition: "Agreements where one party declared a confirmation and the other has not. It does not mean anything went wrong.",
  },
  {
    key: "noConfirmationRecorded",
    label: "No confirmation recorded",
    definition: "Agreements past their date where no party declared anything. Silence is not a confirmation and not a dispute; it is only the absence of a record.",
  },
  {
    key: "differentCounterparties",
    label: "Different counterparties",
    definition: "How many distinct people are on the other side of the counted agreements.",
  },
] as const;

export interface ProfileRecord {
  /** Stable identity of the other side, used only to count distinct people. Never published. */
  counterpartyKey: string | null;
  signedByBoth: boolean;
  outcome: Outcome;
  /** True when an automatic rule excluded this agreement (S10 F1–F5). */
  flagged: boolean;
}

/**
 * Counts the records. A flagged agreement is not counted anywhere, including in the distinct-counterparty
 * number, so a flagged record cannot inflate any figure on the page.
 */
export function profileCounts(records: readonly ProfileRecord[]): ProfileCounts {
  const counted = records.filter((record) => record.signedByBoth && !record.flagged);
  const counterparties = new Set(counted.map((record) => record.counterpartyKey).filter((key): key is string => !!key));
  return {
    agreementsSignedByBoth: counted.length,
    confirmedByBoth: counted.filter((record) => record.outcome === "MUTUAL").length,
    oneSidedConfirmation: counted.filter((record) => record.outcome === "ONE_SIDED").length,
    noConfirmationRecorded: counted.filter((record) => record.outcome === "NONE").length,
    differentCounterparties: counterparties.size,
  };
}

/**
 * Words that must never appear in anything a profile shows (R-PROF-6).
 *
 * The risk is not that someone writes "5 stars"; it is the slow drift from "records" to "reputation", which is
 * how a counting system turns into a rating system. A test scans the profile surface for these.
 */
export const FORBIDDEN_PROFILE_PHRASES: readonly string[] = [
  "rating", "rated", "score", "scored", "star", "rank", "ranking", "reputation", "reliable", "reliability",
  "trustworthy", "trust level", "trusted", "badge", "tier", "endorsed", "recommended", "vouch",
  "good standing", "verified seller", "verified buyer", "successful transaction", "completed transaction",
] as const;

/**
 * Returns the forbidden phrases found, so a failing test can name them.
 *
 * The mandated disclaimer is removed before scanning, because it has to contain the very words it denies: "not a
 * guarantee, a rating or a verification of identity" is the sentence that keeps the page honest. Matching is on
 * whole words, so "started" is not read as "star".
 */
export function forbiddenProfileWording(text: string): string[] {
  const haystack = [PROFILE_DISCLAIMER, PROFILE_FLAGGED_NOTE]
    .reduce((rest, mandated) => rest.replaceAll(mandated, " "), text)
    .toLowerCase();
  // A trailing plural is matched too, so listing "star" also catches "stars" without catching "started".
  return FORBIDDEN_PROFILE_PHRASES.filter((phrase) => new RegExp(`\\b${phrase.replaceAll(" ", "\\s+")}s?\\b`).test(haystack));
}

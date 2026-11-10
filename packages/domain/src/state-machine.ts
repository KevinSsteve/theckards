export const AGREEMENT_STATES = [
  "DRAFT", "PENDING_SIGNATURES", "REVISION_REQUESTED", "EXECUTED",
  "COMPLETED", "IN_CASE", "RESOLVED", "EXPIRED", "CANCELLED",
] as const;
export type AgreementState = (typeof AGREEMENT_STATES)[number];

export const TRANSITIONS: Readonly<Record<AgreementState, readonly AgreementState[]>> = {
  DRAFT: ["PENDING_SIGNATURES", "CANCELLED"],
  PENDING_SIGNATURES: ["EXECUTED", "REVISION_REQUESTED", "EXPIRED", "CANCELLED"],
  REVISION_REQUESTED: ["DRAFT", "CANCELLED"],
  EXECUTED: ["COMPLETED", "IN_CASE"],
  IN_CASE: ["RESOLVED", "EXECUTED"],
  COMPLETED: [],
  RESOLVED: [],
  EXPIRED: [],
  CANCELLED: [],
};

export class InvalidTransitionError extends Error {
  readonly code = "INVALID_TRANSITION";
  constructor(readonly from: AgreementState, readonly to: AgreementState) {
    super(`Invalid agreement transition: ${from} -> ${to}`);
    this.name = "InvalidTransitionError";
  }
}

export function canTransition(from: AgreementState, to: AgreementState): boolean {
  return TRANSITIONS[from].includes(to);
}

export function transition(from: AgreementState, to: AgreementState): AgreementState {
  if (!canTransition(from, to)) throw new InvalidTransitionError(from, to);
  return to;
}

export function isTerminal(state: AgreementState): boolean {
  return TRANSITIONS[state].length === 0;
}

/** SQL CHECK constraint generated from the domain enum (single source of truth). */
export function agreementStateCheckSql(column = "state"): string {
  return `CHECK (${column} IN (${AGREEMENT_STATES.map((s) => `'${s}'`).join(", ")}))`;
}

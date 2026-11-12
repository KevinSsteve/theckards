export interface QueueEnvelope {
  id: string;
  topic: string;
  payload: Record<string, unknown>;
  /** Database time when the outbox event became eligible; absent on envelopes made before R-OPS-2. */
  queuedAt?: string;
}

export interface OutboxEnvelopeRow {
  id: string;
  topic: string;
  payload: Record<string, unknown>;
  created_at: Date;
}

/** Carries the database start time without changing the payload every job handler already consumes. */
export function queueEnvelopeFromOutbox(row: OutboxEnvelopeRow): QueueEnvelope {
  return { id: row.id, topic: row.topic, payload: row.payload, queuedAt: row.created_at.toISOString() };
}

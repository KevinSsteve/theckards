/**
 * The seal impression: a wax-seal mark pressed from a seal identifier.
 *
 * Resurrection of the signet ring. A wax seal did three things: it showed tampering when broken, it could only be
 * pressed by whoever held the signet, and anyone could recognise the mark. Theckards keeps all three — SHA-256,
 * a private key inside AWS KMS, and a published public key — and this gives the seal a face a person can compare.
 *
 * The geometry is derived only from the seal identifier, so the same seal always presses the same mark, and the
 * same function drives both the sealed PDF and the public verification page.
 */
export const SEAL_MARK_SIZE = 100;
const CENTER = SEAL_MARK_SIZE / 2;
const OUTER_RING = 48;
const INNER_RING = 41;
const TEETH = 24;
const MIN_RADIUS = 15;
const MAX_RADIUS = 34;

export interface SealMark {
  /** Square viewBox side: `0 0 size size`. */
  size: number;
  center: number;
  outerRing: number;
  innerRing: number;
  /** Closed SVG path of the pressed impression. Straight lines only, so every renderer draws it identically. */
  impression: string;
  /** Short, human-comparable form of the identifier. */
  code: string;
}

function nibbles(sealId: string): number[] {
  const hex = sealId.toLowerCase().replace(/[^0-9a-f]/g, "");
  if (hex.length === 0) return Array.from({ length: TEETH }, () => 0);
  return Array.from({ length: TEETH }, (_, index) => parseInt(hex[index % hex.length]!, 16));
}

export function sealMark(sealId: string): SealMark {
  const values = nibbles(sealId);
  const points = values.map((value, index) => {
    const angle = ((index / TEETH) * 2 * Math.PI) - Math.PI / 2;
    const radius = MIN_RADIUS + (value / 15) * (MAX_RADIUS - MIN_RADIUS);
    return `${(CENTER + radius * Math.cos(angle)).toFixed(2)},${(CENTER + radius * Math.sin(angle)).toFixed(2)}`;
  });
  const hex = sealId.replace(/[^0-9a-fA-F]/g, "").toUpperCase();
  return {
    size: SEAL_MARK_SIZE,
    center: CENTER,
    outerRing: OUTER_RING,
    innerRing: INNER_RING,
    impression: `M${points[0]}${points.slice(1).map((point) => `L${point}`).join("")}Z`,
    code: `${hex.slice(0, 4)} ${hex.slice(4, 8)}`,
  };
}

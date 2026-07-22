/**
 * Attachment Decay — Fluxer-style size-based file expiry with access renewal.
 *
 * Smaller files live longer; larger files expire sooner.
 * Accessing a file near its expiry extends its lifetime.
 */

// ── Constants ────────────────────────────────────────────────────────────────

export const DECAY_CONSTANTS = {
  /** Files at or below this size get the maximum lifetime. */
  MIN_MB: 5,
  /** Files at or above this size get the minimum lifetime. */
  MAX_MB: 500,
  /** Shortest possible lifetime (days). */
  MIN_DAYS: 14,
  /** Longest possible lifetime (days) — ~3 years. */
  MAX_DAYS: 365 * 3,
  /** Hard upload cap (MB). Files above this are rejected. */
  PLAN_MAX_MB: 500,
  /** Blend factor: 0 = pure linear, 1 = pure logarithmic. */
  CURVE: 0.5,
  /** Estimated storage cost in $/TB/month (for cost tracking). */
  PRICE_PER_TB_PER_MONTH: 0.0081103 * 1000,
} as const

export const RENEWAL_CONSTANTS = {
  /** Max renewal window for small files (days). */
  MAX_WINDOW_DAYS: 30,
  /** Min renewal window for large files (days). */
  MIN_WINDOW_DAYS: 7,
  /** Max threshold — how close to expiry before renewal kicks in (days). */
  MAX_THRESHOLD_DAYS: 14,
  /** Min threshold for large files (days). */
  MIN_THRESHOLD_DAYS: 3,
} as const

// ── Types ────────────────────────────────────────────────────────────────────

export interface DecayInput {
  sizeBytes: number
  uploadedAt: Date
  curve?: number
  pricePerTBPerMonth?: number
}

export interface DecayResult {
  expiresAt: Date
  days: number
  cost: number
}

// ── Core decay calculation ───────────────────────────────────────────────────

function toMb(sizeBytes: number): number {
  return sizeBytes / 1024 / 1024
}

/**
 * Compute the expiry date and estimated storage cost for an attachment.
 * Returns `null` if the file exceeds the plan limit.
 */
export function computeDecay({
  sizeBytes,
  uploadedAt,
  curve = DECAY_CONSTANTS.CURVE,
  pricePerTBPerMonth = DECAY_CONSTANTS.PRICE_PER_TB_PER_MONTH,
}: DecayInput): DecayResult | null {
  const sizeMB = toMb(sizeBytes)

  if (sizeMB > DECAY_CONSTANTS.PLAN_MAX_MB) return null

  let lifetimeDays: number
  if (sizeMB <= DECAY_CONSTANTS.MIN_MB) {
    lifetimeDays = DECAY_CONSTANTS.MAX_DAYS
  } else if (sizeMB >= DECAY_CONSTANTS.MAX_MB) {
    lifetimeDays = DECAY_CONSTANTS.MIN_DAYS
  } else {
    // Blend linear and logarithmic interpolation for a smoother curve
    // that favours smaller files with longer lifetimes.
    const linearFrac =
      (sizeMB - DECAY_CONSTANTS.MIN_MB) /
      (DECAY_CONSTANTS.MAX_MB - DECAY_CONSTANTS.MIN_MB)
    const logFrac =
      Math.log(sizeMB / DECAY_CONSTANTS.MIN_MB) /
      Math.log(DECAY_CONSTANTS.MAX_MB / DECAY_CONSTANTS.MIN_MB)
    const blend = (1 - curve) * linearFrac + curve * logFrac
    lifetimeDays = Math.round(
      DECAY_CONSTANTS.MAX_DAYS -
      blend * (DECAY_CONSTANTS.MAX_DAYS - DECAY_CONSTANTS.MIN_DAYS)
    )
  }

  const expiresAt = new Date(uploadedAt)
  expiresAt.setUTCDate(expiresAt.getUTCDate() + lifetimeDays)

  const sizeTB = sizeBytes / 1024 / 1024 / 1024 / 1024
  const lifetimeMonths = lifetimeDays / 30
  const cost = sizeTB * pricePerTBPerMonth * lifetimeMonths

  return {
    expiresAt,
    cost,
    days: lifetimeDays,
  }
}

// ── Renewal helpers ──────────────────────────────────────────────────────────

const MS_PER_DAY = 1000 * 60 * 60 * 24

/**
 * Compute how many days a renewal extends the expiry, based on file size.
 * Smaller files get a longer renewal window (up to 30 days).
 */
export function computeRenewalWindowDays(sizeMB: number): number {
  const { MIN_MB, MAX_MB } = DECAY_CONSTANTS
  const { MIN_WINDOW_DAYS, MAX_WINDOW_DAYS } = RENEWAL_CONSTANTS

  if (sizeMB <= MIN_MB) return MAX_WINDOW_DAYS
  if (sizeMB >= MAX_MB) return MIN_WINDOW_DAYS

  const frac = Math.log(sizeMB / MIN_MB) / Math.log(MAX_MB / MIN_MB)
  return Math.round(MAX_WINDOW_DAYS - frac * (MAX_WINDOW_DAYS - MIN_WINDOW_DAYS))
}

/**
 * Compute the threshold (days remaining) at which renewal becomes eligible.
 * Derived from the window: threshold ≈ window / 2, clamped to [3, 14].
 */
export function computeRenewalThresholdDays(windowDays: number): number {
  const { MIN_THRESHOLD_DAYS, MAX_THRESHOLD_DAYS } = RENEWAL_CONSTANTS
  const threshold = Math.round(windowDays / 2)
  return Math.max(MIN_THRESHOLD_DAYS, Math.min(MAX_THRESHOLD_DAYS, threshold))
}

/**
 * If the attachment is close enough to expiry, compute a new expiry date
 * pushed forward by the renewal window. Returns `null` if no renewal needed.
 */
export function maybeRenewExpiry({
  currentExpiry,
  now,
  sizeMB,
}: {
  currentExpiry: Date
  now: Date
  sizeMB: number
}): Date | null {
  const windowDays = computeRenewalWindowDays(sizeMB)
  const thresholdDays = computeRenewalThresholdDays(windowDays)

  const remainingMs = currentExpiry.getTime() - now.getTime()

  // Not close enough to expiry — no renewal
  if (remainingMs > thresholdDays * MS_PER_DAY) return null

  // Already expired — no renewal
  if (remainingMs <= 0) return null

  const newExpiry = new Date(now.getTime() + windowDays * MS_PER_DAY)

  // Only extend, never shorten
  if (newExpiry.getTime() <= currentExpiry.getTime()) return null

  return newExpiry
}

/**
 * Pick the later of two expiry dates (never shorten an existing expiry).
 */
export function extendExpiry(
  currentExpiry: Date | null,
  newlyComputed: Date
): Date {
  if (!currentExpiry) return newlyComputed
  return currentExpiry > newlyComputed ? currentExpiry : newlyComputed
}

/**
 * Compute estimated storage cost for a given size and lifetime.
 */
export function computeCost({
  sizeBytes,
  lifetimeDays,
  pricePerTBPerMonth = DECAY_CONSTANTS.PRICE_PER_TB_PER_MONTH,
}: {
  sizeBytes: number
  lifetimeDays: number
  pricePerTBPerMonth?: number
}): number {
  const sizeTB = sizeBytes / 1024 / 1024 / 1024 / 1024
  const lifetimeMonths = lifetimeDays / 30
  return sizeTB * pricePerTBPerMonth * lifetimeMonths
}

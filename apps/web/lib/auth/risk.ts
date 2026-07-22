export interface LoginFingerprint {
  userId: string
  ipAddress: string | null
  userAgent: string | null
  locationHint: string | null
}

export interface PreviousLoginFingerprint {
  ipAddress: string | null
  userAgent: string | null
  locationHint: string | null
}

/** Enforcement action based on risk score */
export type RiskAction = "allow" | "challenge_mfa" | "lock_and_verify"

export interface LoginRiskResult {
  riskScore: number
  suspicious: boolean
  reasons: string[]
  /** Enforcement action:
   *  - "allow": score < 60, proceed normally
   *  - "challenge_mfa": score 60-79, require MFA or email verification before completing login
   *  - "lock_and_verify": score >= 80, sign out immediately and require email verification */
  action: RiskAction
}

function subnet(ip: string | null): string | null {
  if (!ip) return null
  if (ip.includes(":")) return ip.split(":").slice(0, 4).join(":")
  const p = ip.split(".")
  if (p.length !== 4) return ip
  return `${p[0]}.${p[1]}.${p[2]}`
}

function actionForScore(score: number): RiskAction {
  if (score >= 80) return "lock_and_verify"
  if (score >= 60) return "challenge_mfa"
  return "allow"
}

export function computeLoginRisk(current: LoginFingerprint, previous: PreviousLoginFingerprint | null): LoginRiskResult {
  if (!previous) {
    return { riskScore: 25, suspicious: false, reasons: ["first_seen_login"], action: "allow" }
  }

  const reasons: string[] = []
  let score = 0

  if (subnet(current.ipAddress) && subnet(current.ipAddress) !== subnet(previous.ipAddress)) {
    score += 45
    reasons.push("new_ip_subnet")
  }

  if (current.locationHint && previous.locationHint && current.locationHint !== previous.locationHint) {
    score += 25
    reasons.push("new_location")
  }

  if (current.userAgent && previous.userAgent && current.userAgent !== previous.userAgent) {
    score += 30
    reasons.push("new_device_signature")
  }

  const capped = Math.min(score, 100)
  return { riskScore: capped, suspicious: capped >= 60, reasons, action: actionForScore(capped) }
}

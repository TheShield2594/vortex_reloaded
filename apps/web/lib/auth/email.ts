import nodemailer from "nodemailer"
import { createLogger } from "@/lib/logger"

const log = createLogger("auth-email")

let transporter: ReturnType<typeof nodemailer.createTransport> | null | undefined

/**
 * Lazily builds the SMTP transport from env vars. Returns `null` (not an
 * error) when SMTP isn't configured — local dev doesn't need real email
 * delivery, so callers log-and-skip instead of failing the auth flow that
 * triggered the send.
 */
function getTransporter() {
  if (transporter !== undefined) return transporter

  const host = process.env.SMTP_HOST
  const port = process.env.SMTP_PORT
  if (!host || !port) {
    transporter = null
    return transporter
  }

  transporter = nodemailer.createTransport({
    host,
    port: Number(port),
    secure: Number(port) === 465,
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
      : undefined,
  })
  return transporter
}

/**
 * Sends a transactional auth email (verification, password reset, email
 * change confirmation). Supabase Auth previously handled all of this via its
 * own managed SMTP — self-hosting Better Auth means the app now owns
 * delivery. Best-effort: logs and returns rather than throwing, so a
 * misconfigured/down SMTP server degrades to "no email sent" instead of
 * breaking sign-up/sign-in/reset requests outright (mirrors the fail-soft
 * pattern used elsewhere for non-critical side effects, e.g. audit logging).
 */
export async function sendAuthEmail(params: { to: string; subject: string; text: string; html?: string }) {
  const smtp = getTransporter()
  if (!smtp) {
    log.warn({ to: params.to, subject: params.subject }, "SMTP not configured — skipping auth email send")
    return
  }

  try {
    await smtp.sendMail({
      from: process.env.EMAIL_FROM || "Vortex <no-reply@localhost>",
      to: params.to,
      subject: params.subject,
      text: params.text,
      html: params.html || `<p>${params.text}</p>`,
    })
  } catch (err) {
    log.error({ to: params.to, subject: params.subject, err: err instanceof Error ? err.message : String(err) }, "Failed to send auth email")
  }
}

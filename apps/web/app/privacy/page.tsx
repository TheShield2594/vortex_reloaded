import Link from "next/link"
import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Privacy Policy — Vortex",
}

export default function PrivacyPage() {
  return (
    <div
      className="min-h-[100dvh] px-6 py-16"
      style={{ background: "var(--theme-bg-primary)", color: "var(--theme-text-primary)" }}
    >
      <article className="mx-auto max-w-2xl space-y-6 text-sm leading-relaxed">
        <Link
          href="/"
          className="text-xs hover:underline"
          style={{ color: "var(--theme-accent)" }}
        >
          &larr; Back to Vortex
        </Link>

        <h1
          className="text-3xl font-bold font-display"
          style={{ color: "var(--theme-text-bright)" }}
        >
          Privacy Policy
        </h1>
        <p style={{ color: "var(--theme-text-faint)" }}>
          Effective date: March 13, 2026
        </p>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold" style={{ color: "var(--theme-text-bright)" }}>
            1. Information We Collect
          </h2>
          <p>
            <strong>Account information:</strong> When you register, we collect your email address,
            username, and display name. Passwords are hashed and never stored in plain text.
          </p>
          <p>
            <strong>Content you provide:</strong> Messages, files, images, and other content you
            post on the Service.
          </p>
          <p>
            <strong>Usage data:</strong> We collect information about how you use Vortex, including
            IP addresses, browser type, device information, and pages visited. This is used for
            security monitoring (login risk detection) and service improvement.
          </p>
          <p>
            <strong>Cookies:</strong> We use essential cookies for authentication and session
            management. We do not use third-party advertising cookies.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold" style={{ color: "var(--theme-text-bright)" }}>
            2. How We Use Your Information
          </h2>
          <ul className="list-disc list-inside space-y-1 pl-2">
            <li>To provide, maintain, and improve the Service</li>
            <li>To authenticate you and secure your account</li>
            <li>To detect suspicious login activity and prevent abuse</li>
            <li>To send essential service communications (verification emails, security alerts)</li>
            <li>To enforce our Terms of Service and moderate content</li>
            <li>To diagnose errors via our crash reporting service (Sentry)</li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold" style={{ color: "var(--theme-text-bright)" }}>
            3. Information Sharing
          </h2>
          <p>
            We do not sell your personal information. We may share data with:
          </p>
          <ul className="list-disc list-inside space-y-1 pl-2">
            <li>
              <strong>Service providers:</strong> Infrastructure partners (Supabase, Vercel,
              Railway) that help us operate the Service, under contractual obligations to protect
              your data
            </li>
            <li>
              <strong>Error tracking:</strong> Sentry receives crash reports that may include
              anonymized usage context
            </li>
            <li>
              <strong>Legal requirements:</strong> When required by law, regulation, or legal
              process
            </li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold" style={{ color: "var(--theme-text-bright)" }}>
            4. Data Retention
          </h2>
          <p>
            We retain your account data for as long as your account is active. Messages are stored
            until deleted by you or a server moderator. When you delete your account, we remove
            your personal data within 30 days, except where retention is required by law.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold" style={{ color: "var(--theme-text-bright)" }}>
            5. Your Rights
          </h2>
          <p>Depending on your jurisdiction, you may have the right to:</p>
          <ul className="list-disc list-inside space-y-1 pl-2">
            <li>Access and download your personal data</li>
            <li>Correct inaccurate data</li>
            <li>Delete your account and associated data</li>
            <li>Object to or restrict certain processing</li>
            <li>Data portability</li>
          </ul>
          <p>
            You can delete your account at any time from your account settings. For other requests,
            contact us at the address below.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold" style={{ color: "var(--theme-text-bright)" }}>
            6. Security
          </h2>
          <p>
            We implement industry-standard security measures including encryption in transit (TLS),
            row-level security on our database, brute-force login protection, and support for
            passkeys and two-factor authentication. No system is 100% secure, and we cannot
            guarantee absolute security.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold" style={{ color: "var(--theme-text-bright)" }}>
            7. Children&apos;s Privacy
          </h2>
          <p>
            Vortex is not intended for users under 13. We do not knowingly collect personal
            information from children under 13. If we learn we have collected such information,
            we will delete it promptly.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold" style={{ color: "var(--theme-text-bright)" }}>
            8. Changes to This Policy
          </h2>
          <p>
            We may update this Privacy Policy from time to time. We will notify you of material
            changes via in-app notification or email. Your continued use of the Service after
            changes constitutes acceptance.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold" style={{ color: "var(--theme-text-bright)" }}>
            9. Contact
          </h2>
          <p>
            Questions about this Privacy Policy? Contact us at{" "}
            <span className="font-medium" style={{ color: "var(--theme-accent)" }}>
              privacy@vortexchat.app
            </span>
            .
          </p>
        </section>
      </article>
    </div>
  )
}

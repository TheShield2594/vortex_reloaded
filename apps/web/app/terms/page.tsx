import Link from "next/link"
import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Terms of Service — Vortex",
}

export default function TermsPage() {
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
          Terms of Service
        </h1>
        <p style={{ color: "var(--theme-text-faint)" }}>
          Effective date: March 13, 2026
        </p>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold" style={{ color: "var(--theme-text-bright)" }}>
            1. Acceptance of Terms
          </h2>
          <p>
            By creating an account or using Vortex (&quot;the Service&quot;), you agree to these
            Terms of Service and our{" "}
            <Link href="/privacy" className="underline" style={{ color: "var(--theme-accent)" }}>
              Privacy Policy
            </Link>
            . If you do not agree, do not use the Service.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold" style={{ color: "var(--theme-text-bright)" }}>
            2. Eligibility
          </h2>
          <p>
            You must be at least 13 years old (or the minimum age required in your jurisdiction) to
            use Vortex. By registering, you represent that you meet this requirement.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold" style={{ color: "var(--theme-text-bright)" }}>
            3. Your Account
          </h2>
          <p>
            You are responsible for maintaining the security of your account credentials. You must
            not share your account or allow others to access it. You are responsible for all
            activity that occurs under your account.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold" style={{ color: "var(--theme-text-bright)" }}>
            4. User Content
          </h2>
          <p>
            You retain ownership of content you post on Vortex. By posting content, you grant
            Vortex a non-exclusive, worldwide, royalty-free license to store, display, and
            distribute that content as necessary to operate the Service.
          </p>
          <p>
            You must not post content that is illegal, harmful, threatening, abusive, harassing,
            defamatory, obscene, or otherwise objectionable. Vortex reserves the right to remove
            any content that violates these Terms.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold" style={{ color: "var(--theme-text-bright)" }}>
            5. Prohibited Conduct
          </h2>
          <p>You agree not to:</p>
          <ul className="list-disc list-inside space-y-1 pl-2">
            <li>Use the Service for any unlawful purpose</li>
            <li>Harass, bully, or intimidate other users</li>
            <li>Distribute spam, malware, or phishing content</li>
            <li>Attempt to gain unauthorized access to other accounts or systems</li>
            <li>Scrape, crawl, or use automated tools to extract data from the Service</li>
            <li>Circumvent moderation tools, bans, or rate limits</li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold" style={{ color: "var(--theme-text-bright)" }}>
            6. Moderation &amp; Enforcement
          </h2>
          <p>
            Server owners and moderators may set and enforce rules within their servers. Vortex may
            also take action, including content removal, account suspension, or permanent bans, for
            violations of these Terms.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold" style={{ color: "var(--theme-text-bright)" }}>
            7. Termination
          </h2>
          <p>
            You may delete your account at any time from your account settings. Vortex may
            suspend or terminate your account for violations of these Terms. Upon termination,
            your right to use the Service ceases immediately.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold" style={{ color: "var(--theme-text-bright)" }}>
            8. Disclaimers
          </h2>
          <p>
            The Service is provided &quot;as is&quot; without warranties of any kind, either
            express or implied. Vortex does not guarantee uninterrupted or error-free operation.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold" style={{ color: "var(--theme-text-bright)" }}>
            9. Limitation of Liability
          </h2>
          <p>
            To the maximum extent permitted by law, Vortex shall not be liable for any indirect,
            incidental, special, consequential, or punitive damages arising from your use of the
            Service.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold" style={{ color: "var(--theme-text-bright)" }}>
            10. Changes to These Terms
          </h2>
          <p>
            We may update these Terms from time to time. We will notify users of material changes
            via in-app notification or email. Continued use after changes constitutes acceptance.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold" style={{ color: "var(--theme-text-bright)" }}>
            11. Contact
          </h2>
          <p>
            Questions about these Terms? Contact us at{" "}
            <span className="font-medium" style={{ color: "var(--theme-accent)" }}>
              legal@vortexchat.app
            </span>
            .
          </p>
        </section>
      </article>
    </div>
  )
}

"use client"

import { Component, type ErrorInfo, type ReactNode } from "react"
import * as Sentry from "@sentry/nextjs"

interface ErrorBoundaryProps {
  children: ReactNode
  fallback?: ReactNode
  onError?: (error: Error, errorInfo: ErrorInfo) => void
}

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    Sentry.captureException(error, {
      contexts: { react: { componentStack: errorInfo.componentStack ?? "" } },
    })
    this.props.onError?.(error, errorInfo)
  }

  private handleReset = (): void => {
    this.setState({ hasError: false, error: null })
  }

  render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children
    }

    if (this.props.fallback !== undefined) {
      return this.props.fallback
    }

    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "12px",
          padding: "24px",
          backgroundColor: "var(--theme-bg-primary)",
          color: "var(--theme-text-primary)",
          borderRadius: "8px",
          textAlign: "center",
        }}
      >
        <p style={{ margin: 0, fontSize: "15px", fontWeight: 600 }}>
          Something went wrong
        </p>
        <p style={{ margin: 0, fontSize: "13px", color: "var(--theme-text-secondary)" }}>
          An unexpected error occurred in this section.
        </p>
        <button
          type="button"
          onClick={this.handleReset}
          style={{
            marginTop: "4px",
            padding: "6px 16px",
            fontSize: "13px",
            fontWeight: 500,
            color: "#fff",
            backgroundColor: "var(--theme-accent)",
            border: "none",
            borderRadius: "6px",
            cursor: "pointer",
          }}
        >
          Try again
        </button>
      </div>
    )
  }
}

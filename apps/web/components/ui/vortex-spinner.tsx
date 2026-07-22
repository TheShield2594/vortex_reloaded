import type { JSX } from "react"

interface VortexSpinnerProps {
  /** Pixel size for width and height. Default 40. */
  size?: number
  className?: string
  /** Color of the spiral arms. Defaults to theme accent. */
  color?: string
}

/**
 * Vortex spiral loading animation — the branded Vortex motif.
 *
 * Renders an SVG spiral that rotates, replacing generic spinners
 * throughout the app with the Vortex brand identity.
 */
export function VortexSpinner({ size = 40, className, color }: VortexSpinnerProps): JSX.Element {
  const armColor = color ?? "var(--theme-accent, #00e5ff)"

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      className={className}
      role="status"
      aria-label="Loading"
    >
      <title>Loading</title>
      {/* Outer spiral arm — thicker, lower opacity */}
      <path
        d="M24 4C13 4 4 13 4 24c0 7 3.6 13.2 9 16.8"
        stroke={armColor}
        strokeWidth="3"
        strokeLinecap="round"
        opacity="0.3"
      >
        <animateTransform
          attributeName="transform"
          type="rotate"
          from="0 24 24"
          to="360 24 24"
          dur="1.4s"
          repeatCount="indefinite"
        />
      </path>

      {/* Middle spiral arm */}
      <path
        d="M24 10C16.3 10 10 16.3 10 24c0 4.8 2.4 9 6 11.6"
        stroke={armColor}
        strokeWidth="2.5"
        strokeLinecap="round"
        opacity="0.55"
      >
        <animateTransform
          attributeName="transform"
          type="rotate"
          from="120 24 24"
          to="480 24 24"
          dur="1.1s"
          repeatCount="indefinite"
        />
      </path>

      {/* Inner spiral arm — thinnest, full opacity */}
      <path
        d="M24 16C19.6 16 16 19.6 16 24c0 2.7 1.3 5.1 3.4 6.6"
        stroke={armColor}
        strokeWidth="2"
        strokeLinecap="round"
        opacity="0.85"
      >
        <animateTransform
          attributeName="transform"
          type="rotate"
          from="240 24 24"
          to="600 24 24"
          dur="0.9s"
          repeatCount="indefinite"
        />
      </path>

      {/* Center dot */}
      <circle cx="24" cy="24" r="2.5" fill={armColor} opacity="0.9">
        <animate
          attributeName="opacity"
          values="0.9;0.4;0.9"
          dur="1.4s"
          repeatCount="indefinite"
        />
      </circle>
    </svg>
  )
}

/**
 * Static Vortex spiral motif — used as a background decorative element.
 * Does not animate. Good for backgrounds, watermarks, and section dividers.
 */
export function VortexMotif({ size = 120, className, color }: VortexSpinnerProps): JSX.Element {
  const armColor = color ?? "var(--theme-accent, #00e5ff)"

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      {/* Outer spiral */}
      <path
        d="M60 10C32.4 10 10 32.4 10 60s22.4 50 50 50"
        stroke={armColor}
        strokeWidth="2"
        strokeLinecap="round"
        opacity="0.12"
      />
      {/* Middle spiral */}
      <path
        d="M60 25C40.7 25 25 40.7 25 60s15.7 35 35 35"
        stroke={armColor}
        strokeWidth="1.5"
        strokeLinecap="round"
        opacity="0.18"
      />
      {/* Inner spiral */}
      <path
        d="M60 40C48.9 40 40 48.9 40 60s8.9 20 20 20"
        stroke={armColor}
        strokeWidth="1.5"
        strokeLinecap="round"
        opacity="0.25"
      />
      {/* Core spiral */}
      <path
        d="M60 50C54.5 50 50 54.5 50 60s4.5 10 10 10"
        stroke={armColor}
        strokeWidth="1"
        strokeLinecap="round"
        opacity="0.35"
      />
      {/* Center */}
      <circle cx="60" cy="60" r="3" fill={armColor} opacity="0.2" />
    </svg>
  )
}

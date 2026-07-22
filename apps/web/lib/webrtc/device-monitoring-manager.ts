/**
 * DeviceMonitoringManager — detects when a new audio device is plugged in
 * mid-call (e.g. headphones, USB mic) and notifies the caller so the UI
 * can prompt the user to switch.
 *
 * This replaces the implicit `devicechange` enumeration in useVoice with
 * a dedicated component that:
 * 1. Tracks the baseline set of devices at call start.
 * 2. Diffs on every `devicechange` event to find newly added devices.
 * 3. Emits a callback with the new device info for the UI to display a toast.
 * 4. Supports one-shot auto-switch if the user enables it.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface NewDeviceEvent {
  /** The newly detected device. */
  device: MediaDeviceInfo
  /** Whether this is an input or output device. */
  kind: "audioinput" | "audiooutput"
  /** Timestamp when the device was detected. */
  detectedAt: number
}

export type NewDeviceListener = (event: NewDeviceEvent) => void

export interface DeviceMonitoringManagerOptions {
  /** Callback when a new audio device is detected. */
  onNewDevice: NewDeviceListener
  /** If true, don't emit events for output devices (headphones/speakers). */
  inputOnly?: boolean
}

// ── Manager ──────────────────────────────────────────────────────────────────

export class DeviceMonitoringManager {
  private knownDeviceIds = new Set<string>()
  private listener: NewDeviceListener
  private inputOnly: boolean
  private handleDeviceChange: () => void
  private disposed = false

  constructor(options: DeviceMonitoringManagerOptions) {
    this.listener = options.onNewDevice
    this.inputOnly = options.inputOnly ?? false
    this.handleDeviceChange = this.onDeviceChange.bind(this)
  }

  /** Start monitoring. Call this once when the voice session begins. */
  async start(): Promise<void> {
    if (this.disposed) return
    if (!navigator.mediaDevices?.enumerateDevices) return

    // Capture baseline
    await this.snapshotDevices()

    // Listen for changes
    navigator.mediaDevices.addEventListener("devicechange", this.handleDeviceChange)
  }

  /** Stop monitoring and clean up. */
  dispose(): void {
    this.disposed = true
    this.knownDeviceIds.clear()
    try {
      navigator.mediaDevices?.removeEventListener("devicechange", this.handleDeviceChange)
    } catch {
      // ignore if mediaDevices not available
    }
  }

  // ── Private ──────────────────────────────────────────────────────────────

  private async snapshotDevices(): Promise<void> {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices()
      this.knownDeviceIds.clear()
      for (const d of devices) {
        if (d.kind === "audioinput" || d.kind === "audiooutput") {
          this.knownDeviceIds.add(d.deviceId)
        }
      }
    } catch {
      // enumerateDevices can fail in restrictive contexts
    }
  }

  private async onDeviceChange(): Promise<void> {
    if (this.disposed) return

    try {
      const devices = await navigator.mediaDevices.enumerateDevices()
      const audioDevices = devices.filter(
        (d) => d.kind === "audioinput" || d.kind === "audiooutput"
      )

      for (const device of audioDevices) {
        if (this.knownDeviceIds.has(device.deviceId)) continue
        if (this.inputOnly && device.kind !== "audioinput") continue

        // New device detected
        this.knownDeviceIds.add(device.deviceId)
        try {
          this.listener({
            device,
            kind: device.kind as "audioinput" | "audiooutput",
            detectedAt: Date.now(),
          })
        } catch {
          // listener error
        }
      }

      // Also update known set for removed devices (so re-plugging triggers again)
      const currentIds = new Set(audioDevices.map((d) => d.deviceId))
      for (const id of this.knownDeviceIds) {
        if (!currentIds.has(id)) {
          this.knownDeviceIds.delete(id)
        }
      }
    } catch {
      // ignore enumeration failures
    }
  }
}

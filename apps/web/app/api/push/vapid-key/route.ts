import { NextResponse } from "next/server"

/**
 * Returns the public VAPID key for push subscription.
 * Used by the service worker during pushsubscriptionchange events
 * when the original subscription options are unavailable.
 */
export async function GET(): Promise<NextResponse> {
  try {
    const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
    if (!key) {
      return NextResponse.json({ error: "VAPID key not configured" }, { status: 500 })
    }
    return NextResponse.json({ key })
  } catch (err) {
    console.error("[api/push/vapid-key] Failed to retrieve VAPID key:", err)
    return NextResponse.json({ error: "Failed to retrieve VAPID key" }, { status: 500 })
  }
}

import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/utils/api-helpers"
import type { Json } from "@/types/database"

export async function PATCH(request: Request): Promise<NextResponse> {
  try {
    const { supabase, user, error: authError } = await requireAuth()
    if (authError) return authError

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: "Malformed JSON" }, { status: 400 })
    }

    if (
      typeof body !== "object" ||
      body === null ||
      !("appearance_settings" in body)
    ) {
      return NextResponse.json(
        { error: "Missing required field: appearance_settings" },
        { status: 400 }
      )
    }

    const { appearance_settings } = body as {
      appearance_settings: Json
    }

    if (
      appearance_settings !== null &&
      (typeof appearance_settings !== "object" ||
        Array.isArray(appearance_settings) ||
        appearance_settings === undefined)
    ) {
      return NextResponse.json(
        { error: "appearance_settings must be an object or null" },
        { status: 400 }
      )
    }

    // Validate known fields if present
    if (appearance_settings !== null && typeof appearance_settings === "object") {
      const settings = appearance_settings as Record<string, unknown>
      const allowedMessageDisplay = ["cozy", "compact"]
      const allowedFontScale = ["small", "normal", "large"]
      const allowedSaturation = ["normal", "reduced"]

      if (settings.messageDisplay !== undefined && !allowedMessageDisplay.includes(settings.messageDisplay as string)) {
        return NextResponse.json({ error: "Invalid messageDisplay value" }, { status: 400 })
      }
      if (settings.fontScale !== undefined && !allowedFontScale.includes(settings.fontScale as string)) {
        return NextResponse.json({ error: "Invalid fontScale value" }, { status: 400 })
      }
      if (settings.saturation !== undefined && !allowedSaturation.includes(settings.saturation as string)) {
        return NextResponse.json({ error: "Invalid saturation value" }, { status: 400 })
      }
      if (settings.customCss !== undefined && typeof settings.customCss === "string" && settings.customCss.length > 50000) {
        return NextResponse.json({ error: "customCss exceeds 50,000 character limit" }, { status: 400 })
      }
    }

    const { data, error: updateError } = await supabase
      .from("users")
      .update({ appearance_settings })
      .eq("id", user.id)
      .select()
      .single()

    if (updateError) {
      console.error("[PATCH /api/users/appearance]", {
        userId: user.id,
        message: updateError.message,
      })
      return NextResponse.json(
        { error: "Failed to update appearance settings" },
        { status: 500 }
      )
    }

    if (!data) {
      return NextResponse.json({ error: "User not found" }, { status: 404 })
    }

    return NextResponse.json(data)
  } catch (err) {
    console.error("[PATCH /api/users/appearance] Unhandled error:", err)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}

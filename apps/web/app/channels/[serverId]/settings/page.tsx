import { redirect } from "next/navigation"

export default async function ServerSettingsPage({ params: paramsPromise }: { params: Promise<{ serverId: string }> }) {
  const { serverId } = await paramsPromise
  redirect(`/channels/${serverId}`)
}

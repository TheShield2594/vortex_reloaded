import { redirect } from "next/navigation"
import { getAuthUser } from "@/lib/supabase/server"
import { DMChannelArea } from "@/components/dm/dm-channel-area"

interface Props {
  params: Promise<{ channelId: string }>
}

export default async function DMChannelPage({ params }: Props) {
  const { channelId } = await params
  const { data: { user } } = await getAuthUser()
  if (!user) redirect("/login")

  return <DMChannelArea channelId={channelId} currentUserId={user.id} />
}

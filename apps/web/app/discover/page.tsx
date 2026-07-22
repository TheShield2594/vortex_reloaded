import { redirect } from "next/navigation"

/** Redirect the public /discover URL to the authenticated discover page. */
export default function DiscoverRedirect() {
  redirect("/channels/discover")
}

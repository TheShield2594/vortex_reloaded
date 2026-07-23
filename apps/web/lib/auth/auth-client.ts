import { createAuthClient } from "better-auth/react"
import { inferAdditionalFields, magicLinkClient, twoFactorClient } from "better-auth/client/plugins"
import { passkeyClient } from "@better-auth/passkey/client"
import type { auth } from "@/lib/auth/better-auth"

export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_APP_ORIGIN ?? process.env.NEXT_PUBLIC_APP_URL,
  plugins: [
    twoFactorClient(),
    passkeyClient(),
    magicLinkClient(),
    inferAdditionalFields<typeof auth>(),
  ],
})

export const { signIn, signOut, signUp, useSession, getSession } = authClient

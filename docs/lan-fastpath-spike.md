# Spike: LAN/Tailscale fast-path for DM delivery

Design notes for the second half of [#38](https://github.com/TheShield2594/vortex_reloaded/issues/38):
*"when both users are on the same Tailscale network or home LAN, skip the
relay server entirely for lower latency and zero metadata trail."* The
first half of #38 (self-hosted push via ntfy) shipped in the same PR this
doc landed with — see `apps/web/lib/ntfy.ts` and the `ntfy` service in
`docker-compose.yml`. This half is **not implemented** — this is a design
doc plus a punch list for a follow-up issue, not working code, because it
needs validation against two real devices on a real LAN/tailnet, which
isn't reproducible in this sandbox (no second host, no Tailscale
coordination server reachable, no way to assert two browser contexts are
actually on the same L2 segment).

## What "skip the relay" can and can't mean here

Today, a DM message's journey is:

1. Sender POSTs to `apps/web/app/api/dm/channels/[channelId]/messages/route.ts`
   → written to SQLite.
2. That route publishes a `VortexEvent` through `RedisEventBus`
   (`apps/signal/src/event-bus.ts`).
3. `apps/signal/src/gateway.ts`'s `eventBus.subscribe()` fans it out to every
   socket in the `gateway:{channelId}` room.

Step 1 can't be skipped by any P2P scheme — the message has to reach
durable storage so the recipient sees it on reconnect, on another device,
or after being offline (and so push/ntfy notifications in step 3's
consumers have something to read). So "zero metadata trail" is achievable
for the *live-delivery* hop (step 2→3) but not for the message's existence
being known to the self-hosted server itself — that server is *yours* in
this deployment model, which is a materially different privacy claim than
"a third party sees who's messaging whom." Worth stating explicitly so a
future implementation isn't sold as more than it is: this is a
latency/relay-load optimization with a *modest* metadata benefit (the
central relay stops seeing live-typing/delivery timing for LAN-local
pairs), not a route to fully peer-to-peer chat.

## Proposed approach: WebRTC DataChannel, relay-negotiated

Reuse the pattern already proven in this codebase for calls
(`apps/web/lib/webrtc/` before the LiveKit migration, and the current
`gateway:call-signal` handshake in `apps/signal/src/gateway.ts`): use the
existing Socket.IO gateway purely as a **signaling** channel — SDP
offer/answer and ICE candidates, a few KB exchanged once per session — and
open an `RTCDataChannel` for the actual message delivery once connected.
The relay never sees message content either way (it's already
end-to-end-encrypted via the Olm protocol — `apps/web/lib/olm-protocol.ts`
— so this isn't a confidentiality change, only a "does the relay see
delivery *timing*" change).

Concretely:

- New gateway events, mirroring `gateway:call-signal`'s shape: `gateway:p2p-offer`,
  `gateway:p2p-answer`, `gateway:p2p-ice`, scoped to a DM channel's two
  members (this only makes sense for 1:1 DMs, not group DMs with 3+
  members — a full mesh isn't worth the complexity for what's meant to be
  a narrow optimization).
- On both ends, `RTCPeerConnection` with `iceServers: []` (no STUN/TURN —
  deliberately, since the whole point is to *only* succeed when a direct
  host-candidate path exists; falling back to srflx/relay candidates would
  reintroduce a third party, defeating the purpose).
- Once `connectionState === "connected"`, inspect the selected candidate
  pair (`RTCPeerConnection.getStats()` → `candidate-pair` with
  `nominated: true`) and confirm both local and remote candidates are
  `host` type. A `host`/`host` pair only means *a direct ICE path was
  found* — it is not proof of L2 LAN adjacency or of being on the same
  Tailscale tailnet (a `host` candidate is just any address bound to a
  local/logical interface, tailnet or otherwise), so treat this purely as
  "skip the relay for this connection," not as a claim about network
  topology or privacy guarantees beyond "the relay didn't see this
  traffic." Anything else (no connection, or connected via a candidate
  type that implies a relay) means fall back to the normal
  gateway-relayed path silently.
- Detection is **outcome-based, not pre-checked**. There's no reliable way
  to ask "are we on the same LAN/tailnet?" from browser JS before
  attempting a connection — you find out by trying. This also naturally
  covers Tailscale: a tailnet address is just a regular interface IP in
  the CGNAT range `100.64.0.0/10`, so it surfaces as an ordinary `host`
  ICE candidate with no special-casing needed, *as long as* mDNS candidate
  obfuscation is disabled or bypassed (see risks below).

## Where this plugs into the existing message path

`apps/web/hooks/use-gateway.ts` / the DM message send path in
`apps/web/components/dm/dm-channel-area.tsx` would gain a check: if a
live DataChannel exists for this recipient, send a small "message X was
just written, id=..." ping over it in addition to the normal REST POST +
gateway fan-out. The receiving client, on seeing that ping, can skip
waiting for the `gateway:event` socket round-trip and fetch/render
immediately — the durability path is unchanged, only the "you have a new
message" wake-up gets a second, faster, more private route. This also
sidesteps a duplicate-delivery/ordering problem: the DataChannel message
is purely a hint ("go refetch"), not a parallel source of truth, so a
lost or out-of-order P2P ping just means falling back to the gateway
event that's coming anyway.

## Risks / open questions for whoever picks this up

1. **mDNS candidate obfuscation.** Chrome/Firefox hide a host candidate's
   real IP behind a random `.local` mDNS name by default (privacy
   feature) — resolvable only by another instance of the same browser on
   the same LAN, and typically *not* resolvable across a Tailscale
   tailnet at all (mDNS doesn't route over WireGuard the way Tailscale
   tunnels traffic). This likely kills the Tailscale case entirely for
   any client with mDNS obfuscation on, and there is no *application*-level
   fix: `RTCIceTransportPolicy` only has two values, `"all"` and
   `"relay"` — there is no "host, but skip mDNS" mode, and filtering out
   `.local` candidates client-side doesn't recover the real IP behind
   them, it just removes the candidate. Given that, treat mDNS-enabled
   browsers/deployments as **unsupported** for this feature rather than
   something to work around, and require a real two-device trial on an
   actual Tailscale tailnet (not just a LAN) before this is ever
   considered for default-on — don't assume it works from this write-up
   alone.
2. **No second machine to test against in this environment.** Everything
   above is derived from reading spec/API behavior and this repo's
   existing WebRTC code, not from an actual two-host LAN/tailnet trial.
   Treat it as a hypothesis to validate, not a verified design.
3. **Group DMs.** Scope to 1:1 DMs only, or accept an O(n²) mesh for small
   groups — needs a product decision, not just an engineering one.
4. **Peer identity and revocation.** The DataChannel is opened between two
   sockets that already passed `validateSession`/channel-membership
   checks during *signaling* — but that only authorizes the handshake,
   not the lifetime of the resulting connection. Gateway auth doesn't
   automatically tear down an already-established `RTCDataChannel` when a
   member is later removed from the channel. This has to be a hard
   protocol requirement, not an optional test to add later:
   `revokeChannelAccess()` (`apps/signal/src/gateway.ts`) must explicitly
   close any live peer connection for the revoked member, and each side
   must reject/ignore a DataChannel tied to a session it no longer
   considers valid — matching, not weakening, the guarantee the relayed
   path already gives for free.
5. **Value check before building.** Cheapest first step: add telemetry to
   the *existing* LiveKit call path (it already runs ICE negotiation for
   every DM call) logging the selected candidate-pair type. If host-host
   connections between real users' devices turn out to be rare in
   practice (most home networks sit behind CGNAT/symmetric NAT even
   without Tailscale involved), this whole feature has a much smaller
   addressable case than the issue implies, and that's worth knowing
   *before* building the DataChannel plumbing above.

## Suggested follow-up

Tracked as [#47](https://github.com/TheShield2594/vortex_reloaded/issues/47)
rather than folded into this PR. Suggested sequencing: telemetry first (#5
above), then a feature-flagged DataChannel prototype for 1:1 DMs only,
validated manually on a real LAN and a real Tailscale tailnet before it's
considered for default-on.

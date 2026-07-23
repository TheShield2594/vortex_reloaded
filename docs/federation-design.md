# Federation Design (RFC) — Issue #37

## Goals

- Let a user on one self-hosted VortexChat instance DM and call a user on a
  friend's instance, without either operator depending on a shared central
  server.
- Trust is explicit and instance-scoped: an operator decides which other
  instances to federate with, one at a time — a web-of-trust, not an open
  directory.
- Preserve the current single-instance experience unchanged when federation
  is off (default) or unconfigured. Federation is additive, not a rewrite of
  DMs/friends/auth.
- Keep the operator's blast radius small: a compromised or malicious peer
  instance can affect federated conversations with its own users, not the
  whole deployment.

## Non-Goals (this phase)

- Open/public federation directories or discovery (à la Mastodon instance
  lists). Peers are added by an operator, out of band, by exchanging a
  connection string.
- Multi-hop relay/store-and-forward through untrusted third instances.
  Federation here is direct instance-to-instance only: A talks to B only if
  A and B have each explicitly trusted each other. No A→B→C forwarding.
- Federated voice/video (LiveKit/coturn) — out of scope for this RFC;
  revisit once federated signaling exists, since LiveKit SFU federation is
  its own project.
- E2EE ratchet redesign — reuses the existing per-channel wrapped-key model
  (`docs/dm-e2ee-threat-model.md`) with straightforward extension, not a new
  crypto scheme.
- Replacing SQLite/moving to a distributed DB. This RFC works within the
  existing single-host SQLite constraint per instance (`deploy/SELF-HOSTING.md`).

## Why Not X

- **Full ActivityPub/Matrix**: both are general-purpose federation protocols
  with much larger surface area (server discovery, arbitrary object types,
  multi-hop relay, room state resolution) than a DM-and-friends app needs.
  Adopting either wholesale means implementing most of a spec VortexChat
  won't use. This RFC borrows the parts that fit — signed envelopes,
  per-domain identity, explicit instance ACLs — without adopting the full
  protocol or a new dependency.
- **Central directory/relay server**: reintroduces the single point of
  failure/control issue #37 explicitly asks to avoid.

## Trust Model

An **instance** is one VortexChat deployment, identified by its public
origin (e.g. `https://chat.alice.example`) plus a long-lived Ed25519
**instance signing keypair** generated once at first boot (analogous to a
Matrix server key or an SSH host key).

Federation trust is a directed, per-instance allowlist — **not** transitive:

- Instance operator A adds instance B as a trusted peer via an admin action
  (Settings → Federation → Add Peer), supplying B's origin + the fingerprint
  of B's public signing key (exchanged out of band — Signal-style safety
  number comparison, not auto-discovered).
- This is symmetric in effect but asymmetric in storage: both A and B must
  independently add each other before any federated traffic between their
  users is accepted. Either side can revoke unilaterally at any time.
- A user-level friend request across instances additionally requires both
  *users* to accept, same as local friend requests today
  (`friendships` table) — instance trust is necessary but not sufficient;
  it only makes cross-instance friend requests deliverable, it doesn't
  auto-friend anyone.
- Revoking instance trust (either side) immediately halts new federated
  messages in both directions and is surfaced in-conversation ("Alice's
  instance is no longer federated — messages will not be delivered").
  Existing local message history is retained; nothing is deleted.

This mirrors the existing invite-gated registration model
(`registrationInvites` in `packages/db/src/schema/auth.ts`, described
in-repo as "server-issued keys + a short invite code, like a mini Matrix")
— federation trust is the same shape one level up: explicit, operator-
issued, instance-scoped.

## Identity

- A federated user identity is `@localname@instance-origin`
  (e.g. `@alice@chat.alice.example`), matching the Matrix/ActivityPub
  convention users are likely already familiar with.
- Locally, `users.id` stays the existing local primary key. A new
  `remote_users` table caches known remote identities (see Data Model)
  keyed by `(instance_id, remote_user_id)`, so local friendships, DM
  channels, and messages can reference a remote participant through a
  normal foreign key without duplicating the whole `users` schema.
- No global user directory. A remote user only becomes locally known when
  (a) an admin-trusted peer instance sends a friend request referencing
  them, or (b) a local user sends an outbound friend request to a fully
  qualified `@user@instance` handle on an already-trusted peer.

## Protocol

### Transport

HTTPS only, server-to-server. Each instance exposes a small federation API
under `/api/federation/*` (new route group alongside the existing
`apps/web/app/api/*` domains) — no new network service, no new port, so
`deploy/SELF-HOSTING.md`'s single-Docker-host topology is unaffected.

### Message envelope

Every federation request body is a signed envelope, not raw JSON:

```jsonc
{
  "type": "dm.message" | "dm.channel.invite" | "friend.request" | "friend.response" | "receipt" | "typing" | "revoke",
  "from": "chat.alice.example",
  "to": "chat.bob.example",
  "sentAt": "2026-07-23T18:31:33Z",
  "nonce": "…",              // replay protection
  "payload": { /* type-specific */ },
  "signature": "…"            // Ed25519 sig over (type, from, to, sentAt, nonce, payload) using the sender instance's key
}
```

Receiving side verifies:

1. `from` is on the local trusted-peer allowlist (else `403`, log + surface
   as an untrusted-peer attempt in admin audit log).
2. Signature verifies against the *pinned* fingerprint recorded when the
   peer was added — not a key fetched fresh from the wire, so a
   compromised-in-transit or spoofed key can't slip in.
3. `nonce` hasn't been seen before (small rolling window table,
   `federation_seen_nonces`, pruned by `apps/cron`) — replay protection,
   same spirit as the existing `loginAttempts`/`loginRiskEvents` rate-limit
   pattern in `packages/db/src/schema/auth.ts`.
4. `sentAt` within a clock-skew tolerance (~5 min).

### Delivery semantics

- Federated DM delivery is **at-least-once with client-side dedupe**,
  reusing the existing idempotent-replay design already in place for the
  local outbox (`docs/message-consistency-model.md`): the message's
  client-generated UUID is the federated envelope's dedupe key too, so a
  retried federated POST is a no-op PK-conflict on the receiving instance,
  exactly like a replayed local outbox entry.
- No multi-hop queueing. If the peer instance is unreachable, the sending
  instance retries with backoff (mirrors `apps/cron` job patterns) and
  surfaces `queued → failed` state in the sender's UI, same vocabulary as
  the existing offline-outbox states. There is no forwarding through a
  third party while the peer is down.
- Realtime/typing/presence events federate as best-effort, fire-and-forget
  envelopes (no retry) — same "advisory, not durable" semantics Socket.IO
  presence already has locally.

### Why HTTP push instead of extending the Socket.IO gateway

`apps/signal` is a trusted-network Socket.IO gateway that assumes direct DB
access to verify session/membership per `deploy/SELF-HOSTING.md`
("`signal` verifies session/membership on socket events without
round-tripping to `web`"). Exposing that trust boundary to arbitrary peer
instances would require a parallel authn/authz path for a service that
currently has none. A stateless, signed-envelope HTTP endpoint keeps peer
instances firmly on the far side of the same boundary `apps/web`'s REST
API already enforces for local clients. Once an inbound federated message
lands in the local DB, it fans out to local Socket.IO clients through the
existing `RedisEventBus` unchanged — federation only replaces "how a
message enters this instance's DB," not the realtime fan-out.

## Data Model (new tables, additive only)

```
federation_instances
  id, origin (unique), display_name,
  public_key_fingerprint, public_key,       -- pinned at trust time
  status ('pending' | 'trusted' | 'revoked'),
  added_by (-> users.id), created_at, updated_at

federation_instance_keypair                 -- this instance's own identity, singleton row
  id, public_key, private_key (encrypted at rest), created_at

remote_users
  id, instance_id (-> federation_instances), remote_user_id (their local id),
  handle, display_name, avatar_url, cached_at

federation_seen_nonces
  id, instance_id, nonce, seen_at            -- pruned by apps/cron after TTL

federation_audit_log
  id, instance_id, event_type, direction ('in'|'out'), status, detail, created_at
```

Existing tables extend rather than fork:

- `dm_channels`: add nullable `is_federated boolean` +
  `federation_instance_id` so a DM channel with a remote participant is
  still one row in the existing table, not a parallel schema.
- `dm_channel_members` / `friendships`: member/party rows can point at a
  `remote_users.id` instead of `users.id` — requires loosening the FK to a
  polymorphic reference (`participant_type: 'local' | 'remote'` +
  matching id), the one non-additive schema change this RFC needs. Full
  migration shape to be worked out in implementation, not this doc.

## Phased Rollout

1. **Phase 0 — Instance identity + admin UI (no network effect).**
   Generate/display instance keypair and fingerprint. Add/remove peer
   admin screen, stored as `pending` until the peer reciprocates (verified
   via a mutual challenge-response handshake at `/api/federation/handshake`).
   No message traffic yet. Fully behind a `FEDERATION_ENABLED` env flag,
   default off — zero risk to existing single-instance deployments.
2. **Phase 1 — Federated friend requests.** Resolve `@user@instance`
   handles on trusted peers, exchange `friend.request`/`friend.response`
   envelopes, populate `remote_users`. Still no DM content flowing.
3. **Phase 2 — Federated DMs (plaintext).** Extend `dm_channels` as above;
   route `dm.message` envelopes; reuse existing outbox/dedupe/read-receipt
   client logic against the federated channel type.
4. **Phase 3 — Federated E2EE.** Extend the existing wrapped-key model
   (`dm_channel_keys`, `user_device_keys`) so device key wrapping happens
   per remote participant device, fetched via a federation key-exchange
   envelope type. Until this phase ships, federated DMs are clearly marked
   unencrypted in the UI (same as any non-E2EE DM today).
5. **Phase 4 (stretch)** — federated presence/typing, federated voice
   signaling. Deliberately deferred; each is its own design problem
   (LiveKit federation in particular).

Each phase is independently shippable and reversible (disable the flag,
existing local-only behavior is untouched) — this is meant to avoid a
big-bang federation rewrite landing in one PR.

## Threat Model / Open Risks

- **Malicious trusted peer**: since trust is per-instance and explicit, a
  peer an operator has trusted can spam/impersonate its own users toward
  the local instance. Mitigated by scoping blast radius to conversations
  involving that peer's users (revocable instantly) and rate-limiting
  inbound federation traffic per `federation_instances.id`, reusing the
  `loginRiskEvents`-style suspicious-activity pattern.
- **Key compromise**: if an instance's signing key leaks, every peer that
  trusts it is exposed until they revoke. No automatic key rotation
  protocol in this phase (mirrors the `dm-e2ee-threat-model.md` precedent
  of shipping without full forward-secrecy first, then hardening).
- **Metadata leakage**: federated envelopes reveal sender/recipient
  instance origins and timing to both instances by construction — same
  metadata-visible-to-server tradeoff already accepted for local E2EE DMs.
- **Availability**: no store-and-forward through third parties means a
  federated conversation stalls if either instance is offline, same as any
  two-party system without a relay. Explicitly acceptable per the
  "no central dependency" goal in issue #37 — the alternative is
  reintroducing a relay, which reintroduces the single point of failure/
  control the issue is asking to avoid.

## Open Questions for Implementation

- Exact shape of the polymorphic local/remote FK on `dm_channel_members`
  and `friendships` — needs a migration design pass, not decided here.
- Handshake UX for exchanging instance fingerprints out-of-band (QR code?
  paste a connection string? reuse the existing invite QR flow's UI
  patterns from `apps/web/lib/auth/invites.ts`?).
- Whether `federation_instance_keypair.private_key` should be encrypted
  with a KMS-style envelope or an operator-supplied passphrase, given
  there's no existing secrets-management pattern in this single-host
  deployment beyond `.env`.

# DM End-to-End Encryption Threat Model (Initial Rollout)

## Goals

- Keep the server blind to DM plaintext for encrypted DM channels.
- Use **client-managed** device keys and per-conversation symmetric keys.
- Rotate conversation key versions when DM membership changes.
- Preserve legacy plaintext DM behavior and existing realtime delivery.

## Architecture Summary

- `dm_channels.is_encrypted` marks encrypted conversations.
- Clients generate a device ECDH keypair and publish only public keys (`user_device_keys`).
- Device private keys are persisted as non-extractable `CryptoKey` entries in IndexedDB (not localStorage) to reduce trivial export risk.
- Each encrypted DM channel uses a per-version symmetric AES-GCM key.
- The symmetric key is wrapped for each participant device via ECDH-derived AES-GCM and stored as `dm_channel_keys`.
- Messages remain on `direct_messages.content`, but encrypted channels store a ciphertext envelope JSON (`kind: dm-e2ee`) instead of plaintext.

## Key Rotation

- Membership inserts/deletes on `dm_channel_members` bump:
  - `dm_channels.encryption_key_version`
  - `dm_channels.encryption_membership_epoch`
- Clients detect new key versions and publish wrapped keys for active participant devices.

## Search Behavior

- Encrypted DM channels do not support server-side content search.
- The DM client only supports local, on-device search across successfully decrypted message content.

## Verified Device / Fingerprint UX

- Client computes SHA-256 fingerprint of its device public key.
- DM header surfaces encrypted state + local device fingerprint as a first-step verification UX.

## Backward Compatibility / Migration

- Existing plaintext DMs remain readable and writable.
- New DMs can be created with `encrypted: true`.
- Non-encrypted DMs are unaffected (send, read, push, realtime).

## Limitations

- Attachments are not end-to-end encrypted in this phase (links are encrypted in message body, file object remains server-readable).
- No out-of-band identity proof yet; fingerprint verification is manual.
- Multi-device bootstrap depends on online wrapped-key publication.
- Metadata (sender, timestamp, channel membership, message size patterns) remains visible to server.
- Conversation keys and device private keys are persisted in IndexedDB on this rollout; this reduces trivial key scraping from localStorage but still does **not** protect against active XSS running in-origin.
- Earlier designs that stored key material in localStorage would be critically vulnerable to XSS exfiltration; current mitigation keeps private keys out of localStorage, but robust protection still requires strong XSS prevention and platform key stores/secure enclaves where possible.
- This rollout does not implement forward secrecy per-message ratchets.

## Non-Goals (Current)

- Protecting against compromised client endpoints.
- Hiding traffic-analysis metadata.
- Full deniability or ratcheting protocol semantics.

# 25 — Edge Cases & Error Handling

> Covers: network failures, concurrent operations, race conditions, boundary values, error boundaries, graceful degradation, retry logic, empty states.

---

## 25.1 Network Failure Handling

### `network-failures.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should show error toast on API failure | Intercept API → 500 | Error toast displayed |
| 2 | should not crash on network timeout | Simulate slow response | Loading state → timeout message |
| 3 | should retry failed message send | Message send fails → retry | Message sent on retry |
| 4 | should handle Supabase connection loss | Kill Supabase connection | Connection banner shown |
| 5 | should recover after Supabase reconnect | Restore connection | App resumes normally |
| 6 | should handle simultaneous API failures | Multiple endpoints fail | Each shows appropriate error |
| 7 | should not show duplicate error toasts | Same error fires 3 times | Single toast shown |

---

## 25.2 Concurrent Operations

### `concurrent-operations.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should handle rapid channel switching | Click 10 channels in 2 seconds | Final channel loads correctly |
| 2 | should handle rapid message sending | Send 20 messages in 5 seconds | All messages arrive in order |
| 3 | should handle simultaneous reactions | 5 users react at once | All reactions shown correctly |
| 4 | should handle concurrent edits | 2 users edit different messages | Both edits apply |
| 5 | should handle join during server delete | User joins while owner deletes | Clean error handling |

---

## 25.3 Race Conditions

### `race-conditions.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should not duplicate messages on slow network | Send → receive own via realtime | Single message shown |
| 2 | should handle stale data after navigation | Navigate away and back quickly | Fresh data loaded |
| 3 | should handle auth token refresh during API call | Token expires mid-request | Request retries with new token |
| 4 | should handle deleted channel navigation | Click channel → gets deleted | 404 or redirect |
| 5 | should handle deleted server navigation | Click server → gets deleted | Redirect to `/channels` |

---

## 25.4 Boundary Values

### `boundary-values.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should handle message at max length | Send 4000-char message | Sent successfully |
| 2 | should reject message at max+1 length | Send 4001-char message | 400 validation error; message not created |
| 3 | should reject empty server name | Submit "" | 400 `{ error: "Server name is required" }` |
| 4 | should reject channel creation at server limit | Create channel beyond max | 400 `{ error: "Channel limit reached" }` |
| 5 | should reject role creation at server limit | Create role beyond max | 400 `{ error: "Role limit reached" }` |
| 6 | should reject 0-byte file upload | Upload empty file | 400 `{ error: "Empty file" }` |
| 7 | should accept exactly 10 MB upload | Upload 10 MB | 200/201; file stored |
| 8 | should reject 10 MB + 1 byte upload | Upload 10MB+1 | 413 Payload Too Large |
| 9 | should handle unicode in all text fields | Enter emoji/CJK/RTL text | Stored and displayed correctly |
| 10 | should handle very long URLs in messages | Send 2000-char URL | Displayed (possibly truncated) |

---

## 25.5 Error Boundaries

### `error-boundaries.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should catch rendering error in message item | Corrupt message data → render | Error boundary catches; other messages visible |
| 2 | should catch error in emoji picker | Mock picker crash | Fallback UI shown |
| 3 | should catch error in voice component | Mock WebRTC error | Error state shown |
| 4 | should not crash entire app on component error | Trigger component error | App continues; only affected component shows error |
| 5 | should provide recovery action | View error boundary | "Retry" or "Refresh" button |

---

## 25.6 Empty & Loading States

### `empty-loading-states.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should show loading skeleton for channels | Navigate to server | Skeleton shown while loading |
| 2 | should show loading skeleton for messages | Navigate to channel | Skeleton shown |
| 3 | should show empty state for new channel | Navigate to channel with no messages | "No messages yet" |
| 4 | should show empty state for no search results | Search with no matches | "No results found" |
| 5 | should show empty state for no friends | New user → friends page | "No friends yet" + suggestions |
| 6 | should show empty state for no notifications | View notifications | "All caught up" |
| 7 | should show empty state for no DMs | New user → DM list | "Find People" CTA |
| 8 | should show empty state for no servers | New user → sidebar | "No servers yet" + pulsing create |
| 9 | should show loading state for file upload | Upload file | Progress indicator |
| 10 | should show loading state for API calls | Slow API → observe | Loading spinner/skeleton |

---

## 25.7 Browser-Specific Edge Cases

### `browser-edge-cases.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should handle localStorage full | Fill localStorage → try to save | Graceful fallback |
| 2 | should handle cookies disabled | Disable cookies → use app | Appropriate error message |
| 3 | should handle WebSocket not supported | Block WebSocket | Fallback or error |
| 4 | should handle clipboard API not available | Try to copy without permission | Fallback copy method |
| 5 | should handle notification API not available | Non-supporting browser | Push options hidden |
| 6 | should handle WebRTC not available | Non-supporting browser | Voice disabled with message |

---

## 25.8 Data Integrity

### `data-integrity.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should preserve message order | Send messages A, B, C | Displayed in order A, B, C |
| 2 | should handle message with deleted author | Author account deleted | "Deleted User" shown |
| 3 | should handle reaction on deleted message | Message deleted after reaction | No crash |
| 4 | should handle mention of deleted user | View message mentioning deleted user | Graceful display |
| 5 | should handle channel with deleted parent category | Category deleted | Channel still accessible |

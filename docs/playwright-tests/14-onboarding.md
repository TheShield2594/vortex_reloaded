# 14 — Onboarding & First-Time Experience

> Covers: welcome screen, server creation flow, template selector, onboarding gate, system welcome message, invite surfacing, skip option, empty states.

**Components under test:**
- `onboarding-flow.tsx`, `onboarding-gate.tsx`
- API: `/api/onboarding/complete`, `/api/onboarding/welcome-message`
- `dm-list.tsx` (empty state CTAs), `server-sidebar.tsx` (empty state)

---

## 14.1 Welcome Screen

### `welcome-screen.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should show welcome screen for new users | Register → first login (no servers, `onboarding_completed_at` null) | `OnboardingFlow` displayed |
| 2 | should not show for returning users | Login with `onboarding_completed_at` set | Directly to `/channels` |
| 3 | should show two CTAs | View welcome screen | "Create a Server" + "Browse Servers" buttons |
| 4 | should navigate to server creation | Click "Create a Server" | Create server flow with templates |
| 5 | should navigate to discover | Click "Browse Servers" | Navigates to `/channels/discover` |
| 6 | should show server template selector prominently | View creation flow | Gaming, Study, Startup, Creator templates |
| 7 | should allow server name + icon upload | Fill in server details | Name and icon input fields |
| 8 | should show "Skip for now" link | View welcome screen | Skip link visible |
| 9 | should skip onboarding | Click "Skip for now" | `onboarding_completed_at` set; redirects |

---

## 14.2 Server Creation via Onboarding

### `onboarding-server-creation.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should create server during onboarding | Select template → name → create | Server created |
| 2 | should auto-join owner | Create server | Owner is member |
| 3 | should post system welcome message | Create server | AutoMod posts in first text channel |
| 4 | should surface invite link post-creation | Server created | Invite step with URL + copy button |
| 5 | should copy invite link | Click copy | URL copied to clipboard |
| 6 | should mark onboarding complete | Finish flow | `onboarding_completed_at` set |

---

## 14.3 Empty States

### `empty-states.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should show DM empty state | Login with no DMs | "Find People" + "New Message" buttons in `dm-list` |
| 2 | should show server sidebar empty state | Login with no servers | "No servers yet" label + pulsing "Create" button |
| 3 | should navigate from DM empty state to find people | Click "Find People" | User search opens |
| 4 | should navigate from DM empty state to new message | Click "New Message" | New DM flow starts |
| 5 | should navigate from sidebar empty state to create | Click pulsing "Create" | Create server modal |

---

## 14.4 Onboarding Routing Gate (layout/page-level)

### `onboarding-gate.spec.ts`

> Note: `onboarding-gate.tsx` is a lazy-loading wrapper. Route gating is enforced at the layout/page decision point. Tests target the redirect behavior at that level.

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should gate app until onboarding complete or skipped | New user navigates to `/channels` | Layout/page redirects to onboarding flow |
| 2 | should allow access after completion | Complete onboarding → navigate | Access granted |
| 3 | should allow access after skip | Skip onboarding → navigate | Access granted |
| 4 | should handle `onboarding_completed_at` timestamp | Check DB value | Timestamp correctly stored |

# 10 — User Settings

> Covers: profile settings, appearance/theme, accessibility, keybinds, voice settings, notification settings (see also 09), security settings (see also 01).

**Components under test:**
- `settings-sidebar.tsx`, `settings-responsive-content.tsx`, `settings-mobile-wrapper.tsx`
- `profile-settings-page.tsx`, `profile-settings-modal.tsx`
- `appearance-settings-page.tsx`, `appearance-tab.tsx`, `settings-appearance-provider.tsx`
- `accessibility-settings-page.tsx`, `keybinds-settings-page.tsx`
- `voice-settings-page.tsx`, `notifications-settings-page.tsx`
- `security-settings-page.tsx` and sub-sections
- Pages: `settings/page.tsx`, `settings/profile/page.tsx`, `settings/appearance/page.tsx`
- Pages: `settings/accessibility/page.tsx`, `settings/keybinds/page.tsx`
- Pages: `settings/voice/page.tsx`, `settings/notifications/page.tsx`, `settings/security/page.tsx`
- API: `/api/users/profile`, `/api/users/avatar`, `/api/users/appearance`
- API: `/api/users/interests`, `/api/users/connections/*`
- Hooks: `use-apply-appearance.ts`, `use-auto-sync-appearance.ts`

---

## 10.1 Settings Navigation

### `settings-navigation.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should open settings page | Click gear icon / navigate to `/settings` | Settings page loads |
| 2 | should show settings sidebar with all sections | View settings | Profile, Appearance, Notifications, Security, Voice, Accessibility, Keybinds visible |
| 3 | should navigate between sections | Click each sidebar item | Correct section loads |
| 4 | should highlight active section | Click section | Active item highlighted |
| 5 | should work on mobile (responsive) | Mobile viewport → open settings | Mobile-friendly layout |
| 6 | should close settings | Click back/close | Returns to previous page |

---

## 10.2 Profile Settings

### `profile-settings.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should display current profile info | View profile settings | Username, email, avatar shown |
| 2 | should update display name | Change name → save | Name updated everywhere |
| 3 | should update bio/about me | Enter bio → save | Bio saved; shown on profile |
| 4 | should upload avatar | Click avatar → upload image | Avatar updated |
| 5 | should remove avatar | Click remove | Avatar reset to default |
| 6 | should update interests/tags | Add/remove interest tags | Tags saved |
| 7 | should preview profile changes | Make changes | Live preview shown |
| 8 | should validate display name length | Enter very long name | Validation error |
| 9 | should handle avatar upload errors | Upload invalid file | Error message |

---

## 10.3 Appearance Settings

### `appearance-settings.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should show theme options | View appearance settings | Dark, Light, System options |
| 2 | should switch to dark theme | Select dark | Dark theme applied |
| 3 | should switch to light theme | Select light | Light theme applied |
| 4 | should follow system preference | Select system → change OS theme | Theme follows |
| 5 | should set font size | Adjust font size slider | Font size changes |
| 6 | should set message density | Select compact/cozy/comfortable | Layout changes |
| 7 | should persist appearance across reload | Set dark → reload | Dark theme still applied |
| 8 | should sync appearance across tabs | Change in tab A → check tab B | Both updated |
| 9 | should apply appearance immediately (no reload) | Change theme | Instant update |

---

## 10.4 Accessibility Settings

### `accessibility-settings.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should show accessibility options | Navigate to accessibility | Options listed |
| 2 | should toggle reduced motion | Enable reduced motion | Animations disabled |
| 3 | should toggle high contrast mode | Enable high contrast | Contrast increased |
| 4 | should set font scaling | Adjust scale | Text scales |
| 5 | should persist accessibility settings | Set → reload | Settings retained |
| 6 | should respect `prefers-reduced-motion` | OS setting = reduce | Auto-applied |

---

## 10.5 Keybind Settings

### `keybind-settings.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should show all keybinds | View keybinds page | All shortcuts listed |
| 2 | should show default keybind values | View list | Default keys shown |
| 3 | should allow rebinding a shortcut | Click keybind → press new key | Keybind updated |
| 4 | should detect conflicts | Set same key for two actions | Conflict warning |
| 5 | should reset to defaults | Click reset | All keybinds restored |

---

## 10.6 Connections

### `user-connections.spec.ts`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | should show connections section | Settings → Security → Connections | Available platforms listed |
| 2 | should initiate OAuth connection (GitHub, etc.) | Click connect → OAuth flow | Connection established |
| 3 | should show connected accounts | View connections | Connected accounts listed |
| 4 | should disconnect an account | Click disconnect | Connection removed |
| 5 | should connect YouTube | Click YouTube → OAuth | YouTube connected |
| 6 | should connect Steam | Click Steam → OAuth | Steam connected |
| 7 | should show connections on public profile | View profile | Connected accounts visible |

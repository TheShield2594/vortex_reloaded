"use client"

import { create } from "zustand"
import { persist } from "zustand/middleware"
import {
  applyPresetToSettings,
  createDefaultAudioSettings,
  withEqBandGain,
  type AudioPreset,
  type VoiceAudioSettings,
} from "@/lib/voice/audio-settings"

export type ParticipantAudio = {
  volume: number
  pan: number | null
}

interface VoiceAudioState {
  profilesByUser: Record<string, VoiceAudioSettings>
  serverOverridesByUser: Record<string, Record<string, VoiceAudioSettings>>
  participantMixByServer: Record<string, Record<string, ParticipantAudio>>
  getEffectiveSettings: (userId: string, serverId?: string | null) => VoiceAudioSettings
  setProfileSettings: (userId: string, settings: VoiceAudioSettings) => void
  setServerOverride: (userId: string, serverId: string, settings: VoiceAudioSettings) => void
  clearServerOverride: (userId: string, serverId: string) => void
  applyPreset: (userId: string, preset: AudioPreset, serverId?: string | null) => void
  setEqBandGain: (userId: string, serverId: string | null | undefined, index: number, gain: number) => void
  resetSettings: (userId: string, serverId?: string | null) => void
  setParticipantVolume: (serverId: string, participantUserId: string, volume: number) => void
  setParticipantPan: (serverId: string, participantUserId: string, pan: number) => void
  getParticipantMix: (serverId: string, participantUserId: string) => ParticipantAudio
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const defaultAudioSettings = createDefaultAudioSettings()
const DEFAULT_MIX: ParticipantAudio = { volume: 1, pan: null }

/** Resolve the effective audio settings for a user, falling back from server override to profile to defaults. */
function resolveSettings(
  state: Pick<VoiceAudioState, "profilesByUser" | "serverOverridesByUser">,
  userId: string,
  serverId?: string | null
): VoiceAudioSettings {
  const profile = state.profilesByUser[userId] ?? defaultAudioSettings
  if (!serverId) return profile
  return state.serverOverridesByUser[userId]?.[serverId] ?? profile
}

/** Persisted Zustand store for per-user audio processing settings and per-participant volume/pan mix. */
export const useVoiceAudioStore = create<VoiceAudioState>()(
  persist(
    (set, get) => ({
      profilesByUser: {},
      serverOverridesByUser: {},
      participantMixByServer: {},
      getEffectiveSettings: (userId, serverId) => resolveSettings(get(), userId, serverId),
      setProfileSettings: (userId, settings) => {
        set((state) => ({
          profilesByUser: { ...state.profilesByUser, [userId]: settings },
        }))
      },
      setServerOverride: (userId, serverId, settings) => {
        set((state) => ({
          serverOverridesByUser: {
            ...state.serverOverridesByUser,
            [userId]: {
              ...(state.serverOverridesByUser[userId] ?? {}),
              [serverId]: settings,
            },
          },
        }))
      },
      clearServerOverride: (userId, serverId) => {
        set((state) => {
          const userOverrides = { ...(state.serverOverridesByUser[userId] ?? {}) }
          delete userOverrides[serverId]
          return {
            serverOverridesByUser: {
              ...state.serverOverridesByUser,
              [userId]: userOverrides,
            },
          }
        })
      },
      applyPreset: (userId, preset, serverId) => {
        const current = resolveSettings(get(), userId, serverId)
        const updated = applyPresetToSettings(preset, current)
        if (serverId) get().setServerOverride(userId, serverId, updated)
        else get().setProfileSettings(userId, updated)
      },
      setEqBandGain: (userId, serverId, index, gain) => {
        const current = resolveSettings(get(), userId, serverId)
        const updated = withEqBandGain(current, index, clamp(gain, -12, 12))
        if (serverId) get().setServerOverride(userId, serverId, updated)
        else get().setProfileSettings(userId, updated)
      },
      resetSettings: (userId, serverId) => {
        if (serverId) get().clearServerOverride(userId, serverId)
        else {
          const defaults = createDefaultAudioSettings()
          get().setProfileSettings(userId, defaults)
        }
      },
      setParticipantVolume: (serverId, participantUserId, volume) => {
        set((state) => ({
          participantMixByServer: {
            ...state.participantMixByServer,
            [serverId]: {
              ...(state.participantMixByServer[serverId] ?? {}),
              [participantUserId]: {
                ...(state.participantMixByServer[serverId]?.[participantUserId] ?? { volume: 1, pan: null }),
                volume: clamp(volume, 0, 2),
              },
            },
          },
        }))
      },
      setParticipantPan: (serverId, participantUserId, pan) => {
        set((state) => ({
          participantMixByServer: {
            ...state.participantMixByServer,
            [serverId]: {
              ...(state.participantMixByServer[serverId] ?? {}),
              [participantUserId]: {
                ...(state.participantMixByServer[serverId]?.[participantUserId] ?? { volume: 1, pan: null }),
                pan: clamp(pan, -1, 1),
              },
            },
          },
        }))
      },
      getParticipantMix: (serverId, participantUserId) =>
        get().participantMixByServer[serverId]?.[participantUserId] ?? DEFAULT_MIX,
    }),
    {
      name: "vortex:voice-audio",
      version: 1,
      migrate: (state, version) => {
        if (!state) return state
        if (version < 1) {
          return state
        }
        return state
      },
    }
  )
)

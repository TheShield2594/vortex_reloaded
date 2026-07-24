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
  participantMixByChannel: Record<string, Record<string, ParticipantAudio>>
  getEffectiveSettings: (userId: string) => VoiceAudioSettings
  setProfileSettings: (userId: string, settings: VoiceAudioSettings) => void
  applyPreset: (userId: string, preset: AudioPreset) => void
  setEqBandGain: (userId: string, index: number, gain: number) => void
  resetSettings: (userId: string) => void
  setParticipantVolume: (channelId: string, participantUserId: string, volume: number) => void
  setParticipantPan: (channelId: string, participantUserId: string, pan: number) => void
  getParticipantMix: (channelId: string, participantUserId: string) => ParticipantAudio
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const defaultAudioSettings = createDefaultAudioSettings()
const DEFAULT_MIX: ParticipantAudio = { volume: 1, pan: null }

/** Resolve the effective audio settings for a user, falling back to defaults. */
function resolveSettings(
  state: Pick<VoiceAudioState, "profilesByUser">,
  userId: string
): VoiceAudioSettings {
  return state.profilesByUser[userId] ?? defaultAudioSettings
}

/** Persisted Zustand store for per-user audio processing settings and per-participant volume/pan mix. */
export const useVoiceAudioStore = create<VoiceAudioState>()(
  persist(
    (set, get) => ({
      profilesByUser: {},
      participantMixByChannel: {},
      getEffectiveSettings: (userId) => resolveSettings(get(), userId),
      setProfileSettings: (userId, settings) => {
        set((state) => ({
          profilesByUser: { ...state.profilesByUser, [userId]: settings },
        }))
      },
      applyPreset: (userId, preset) => {
        const current = resolveSettings(get(), userId)
        const updated = applyPresetToSettings(preset, current)
        get().setProfileSettings(userId, updated)
      },
      setEqBandGain: (userId, index, gain) => {
        const current = resolveSettings(get(), userId)
        const updated = withEqBandGain(current, index, clamp(gain, -12, 12))
        get().setProfileSettings(userId, updated)
      },
      resetSettings: (userId) => {
        get().setProfileSettings(userId, createDefaultAudioSettings())
      },
      setParticipantVolume: (channelId, participantUserId, volume) => {
        set((state) => ({
          participantMixByChannel: {
            ...state.participantMixByChannel,
            [channelId]: {
              ...(state.participantMixByChannel[channelId] ?? {}),
              [participantUserId]: {
                ...(state.participantMixByChannel[channelId]?.[participantUserId] ?? { volume: 1, pan: null }),
                volume: clamp(volume, 0, 2),
              },
            },
          },
        }))
      },
      setParticipantPan: (channelId, participantUserId, pan) => {
        set((state) => ({
          participantMixByChannel: {
            ...state.participantMixByChannel,
            [channelId]: {
              ...(state.participantMixByChannel[channelId] ?? {}),
              [participantUserId]: {
                ...(state.participantMixByChannel[channelId]?.[participantUserId] ?? { volume: 1, pan: null }),
                pan: clamp(pan, -1, 1),
              },
            },
          },
        }))
      },
      getParticipantMix: (channelId, participantUserId) =>
        get().participantMixByChannel[channelId]?.[participantUserId] ?? DEFAULT_MIX,
    }),
    {
      name: "vortex:voice-audio",
      version: 2,
      migrate: (state, version) => {
        if (!state) return state
        // v2 dropped the never-populated per-server EQ overrides and renamed
        // the participant mix map from server-scoped to channel-scoped keys
        // (the values were already keyed by channelId).
        if (version < 2) {
          const legacy = state as Record<string, unknown>
          delete legacy.serverOverridesByUser
          if (legacy.participantMixByServer && !legacy.participantMixByChannel) {
            legacy.participantMixByChannel = legacy.participantMixByServer
          }
          delete legacy.participantMixByServer
        }
        return state
      },
    }
  )
)

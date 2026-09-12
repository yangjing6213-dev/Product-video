// SPDX-License-Identifier: Apache-2.0

export type DeliveryMode = 'natural' | 'presenter';
export type VoicePace = 'slower' | 'steady' | 'brisk';
export type VoicePause = 'connected' | 'balanced' | 'deliberate';

export interface VoiceDirection {
  purpose: string;
  attitude: string;
  emphasis: string[];
  pace: VoicePace;
  pause: VoicePause;
  visualEvent: string;
}

export interface VoiceControlBaseline {
  speed: number;
  sentencePauseSec: number;
  clausePauseSec: number;
}

export const VOICE_DIRECTION_MAPPING_VERSION = 'kokoro-zh-direction-v1' as const;
export const VOICE_DIRECTION_METADATA_ONLY = ['purpose', 'attitude', 'emphasis', 'visualEvent'] as const;
export const KOKORO_UNSUPPORTED_EXPRESSION = ['emotion', 'pitch', 'energy', 'word-level-emphasis'] as const;

const PACE_FACTOR: Record<DeliveryMode, Record<VoicePace, number>> = {
  natural: { slower: 0.96, steady: 1, brisk: 1.04 },
  presenter: { slower: 0.92, steady: 0.98, brisk: 1.08 },
};
const PAUSE_FACTOR: Record<DeliveryMode, Record<VoicePause, number>> = {
  natural: { connected: 0.8, balanced: 1, deliberate: 1.2 },
  presenter: { connected: 0.65, balanced: 0.9, deliberate: 1.4 },
};

const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const round = (value: number) => Number(value.toFixed(3));

export function validateDeliveryMode(value: unknown): DeliveryMode {
  if (value !== 'natural' && value !== 'presenter') throw new Error('Invalid voice delivery mode');
  return value;
}

export function validateVoiceDirection(value: unknown, displayText?: string): VoiceDirection {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid voice direction');
  const row = value as Partial<VoiceDirection>;
  if (!text(row.purpose) || !text(row.attitude) || !text(row.visualEvent) ||
      !['slower', 'steady', 'brisk'].includes(row.pace ?? '') ||
      !['connected', 'balanced', 'deliberate'].includes(row.pause ?? '') ||
      !Array.isArray(row.emphasis) || row.emphasis.some(item => !text(item)) ||
      new Set(row.emphasis).size !== row.emphasis.length) throw new Error('Invalid voice direction');
  if (displayText !== undefined && row.emphasis.some(item => !displayText.includes(item))) {
    throw new Error('Voice direction emphasis must occur in display text');
  }
  return {
    purpose: row.purpose.trim(), attitude: row.attitude.trim(), emphasis: row.emphasis.map(item => item.trim()),
    pace: row.pace as VoicePace, pause: row.pause as VoicePause, visualEvent: row.visualEvent.trim(),
  };
}

export function resolveVoiceDirection(
  baseline: VoiceControlBaseline,
  modeValue: unknown,
  directionValue: unknown,
  displayText?: string,
) {
  const mode = validateDeliveryMode(modeValue);
  const direction = validateVoiceDirection(directionValue, displayText);
  if (![baseline.speed, baseline.sentencePauseSec, baseline.clausePauseSec].every(Number.isFinite)) {
    throw new Error('Invalid voice control baseline');
  }
  const speed = round(baseline.speed * PACE_FACTOR[mode][direction.pace]);
  const pauseFactor = PAUSE_FACTOR[mode][direction.pause];
  const sentencePauseSec = round(baseline.sentencePauseSec * pauseFactor);
  const clausePauseSec = round(baseline.clausePauseSec * pauseFactor);
  if (speed < 0.75 || speed > 1.3 || sentencePauseSec < 0 || sentencePauseSec > 2 || clausePauseSec < 0 || clausePauseSec > 1) {
    throw new Error('Effective voice controls exceed the supported project range');
  }
  return {
    mappingVersion: VOICE_DIRECTION_MAPPING_VERSION,
    deliveryMode: mode,
    speed,
    sentencePauseSec,
    clausePauseSec,
    metadataOnly: [...VOICE_DIRECTION_METADATA_ONLY],
    unsupported: [...KOKORO_UNSUPPORTED_EXPRESSION],
  };
}

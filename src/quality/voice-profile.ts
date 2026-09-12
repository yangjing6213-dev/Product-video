// SPDX-License-Identifier: Apache-2.0
import { digest } from '../pipeline/stage-state.ts';
import {
  VOICE_DIRECTION_MAPPING_VERSION,
  resolveVoiceDirection,
  validateDeliveryMode,
  validateVoiceDirection,
  type DeliveryMode,
  type VoiceDirection,
} from './voice-direction.ts';

export interface KokoroVoiceProfile {
  provider: 'kokoro-onnx';
  modelId: 'kokoro-v1.1-zh';
  voiceId: string;
  locale: 'zh-CN';
  speed: number;
  sentencePauseSec: number;
  clausePauseSec: number;
}

export interface QwenVoiceProfile {
  provider: 'qwen3-tts';
  modelId: 'Qwen3-TTS-12Hz-1.7B-Base';
  voiceId: string;
  locale: 'zh-CN';
  selectionPath: string;
  selectionSha256: string;
  referenceAudioSha256: string;
}

export type VoiceProfile = KokoroVoiceProfile | QwenVoiceProfile;
export const QWEN_DIRECTION_MAPPING_VERSION = 'qwen3-reference-v1';

export function qwenReferenceControls(profile: QwenVoiceProfile, deliveryMode: unknown) {
  return { mappingVersion: QWEN_DIRECTION_MAPPING_VERSION, deliveryMode: validateDeliveryMode(deliveryMode),
    referenceAudioSha256: profile.referenceAudioSha256,
    metadataOnly: ['purpose', 'attitude', 'emphasis', 'pace', 'pause', 'visualEvent'],
    unsupported: ['instruct', 'per-scene-prosody'] };
}

export interface VoiceProfilePolicy {
  availableVoiceIds?: readonly string[];
  rejectedVoiceIds?: readonly string[];
}

export interface VoiceSynthesisInput {
  profile: VoiceProfile;
  spokenTextSha256: string;
  pronunciationMapSha256: string;
  orderedSegments: readonly string[];
  segmentationVersion: string;
  modelSha256: string;
  voicesSha256: string;
  backendVersion: string;
  frontendVersion: string;
  frontendModelVersion: string;
  synthesisScriptVersion: string;
  contextHash: string;
  deliveryMode?: DeliveryMode;
  orderedDirections?: readonly VoiceDirection[];
}

export interface VoiceApproval {
  status: 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED';
  profileHash: string;
  sampleAudioHash: string;
}

const SHA = /^[0-9a-f]{64}$/;
const MALE_MANDARIN_VOICE = /^zm_\d{3}$/;
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

function canonical(value: unknown): string {
  const sorted = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(sorted);
    if (item && typeof item === 'object') return Object.fromEntries(Object.entries(item as Record<string, unknown>)
      .filter(([, child]) => child !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, sorted(child)]));
    return item;
  };
  return JSON.stringify(sorted(value));
}

export function validateVoiceProfile(value: unknown, policy: VoiceProfilePolicy = {}): VoiceProfile {
  if (!value || typeof value !== 'object') throw new Error('Invalid voice profile');
  if ((value as { provider?: unknown }).provider === 'qwen3-tts') {
    const row = value as QwenVoiceProfile;
    if (row.modelId !== 'Qwen3-TTS-12Hz-1.7B-Base' || !/^enhe-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(row.voiceId) || row.locale !== 'zh-CN'
        || !text(row.selectionPath) || /^(?:[A-Za-z]:|[\\/])|\.\.|[\\]/.test(row.selectionPath)
        || !SHA.test(row.selectionSha256) || !SHA.test(row.referenceAudioSha256)
        || Object.keys(row).some(key => !['provider', 'modelId', 'voiceId', 'locale', 'selectionPath', 'selectionSha256', 'referenceAudioSha256'].includes(key))) {
      throw new Error('Invalid Qwen voice profile or selected reference identity');
    }
    return { provider: row.provider, modelId: row.modelId, voiceId: row.voiceId, locale: row.locale,
      selectionPath: row.selectionPath, selectionSha256: row.selectionSha256, referenceAudioSha256: row.referenceAudioSha256 };
  }
  const row = value as Partial<KokoroVoiceProfile>;
  if (row.provider !== 'kokoro-onnx' || row.modelId !== 'kokoro-v1.1-zh' || row.locale !== 'zh-CN' ||
      !text(row.voiceId) || !MALE_MANDARIN_VOICE.test(row.voiceId) ||
      typeof row.speed !== 'number' || !Number.isFinite(row.speed) || row.speed < 0.75 || row.speed > 1.3 ||
      typeof row.sentencePauseSec !== 'number' || !Number.isFinite(row.sentencePauseSec) || row.sentencePauseSec < 0 || row.sentencePauseSec > 2 ||
      typeof row.clausePauseSec !== 'number' || !Number.isFinite(row.clausePauseSec) || row.clausePauseSec < 0 || row.clausePauseSec > 1) {
    throw new Error('Invalid voice profile for local Mandarin synthesis');
  }
  if (policy.rejectedVoiceIds?.includes(row.voiceId)) throw new Error(`Voice profile is rejected by current policy: ${row.voiceId}`);
  if (policy.availableVoiceIds && !policy.availableVoiceIds.includes(row.voiceId)) throw new Error(`Voice profile is unavailable: ${row.voiceId}`);
  return { provider: row.provider, modelId: row.modelId, voiceId: row.voiceId, locale: row.locale,
    speed: row.speed, sentencePauseSec: row.sentencePauseSec, clausePauseSec: row.clausePauseSec };
}

export function voiceProfileHash(profile: VoiceProfile): string {
  return digest(canonical(validateVoiceProfile(profile)));
}

export function spokenTextHash(orderedSegments: readonly string[]): string {
  if (!Array.isArray(orderedSegments) || !orderedSegments.length || orderedSegments.some(segment => !text(segment))) throw new Error('Ordered semantic speech segments are required');
  return digest(orderedSegments.join(''));
}

export function applyPronunciationMap(displayText: string, value: unknown): string {
  if (typeof displayText !== 'string') throw new Error('Display speech text must be a string');
  if (value === undefined) return displayText;
  const map = object(value, 'Pronunciation map');
  let spoken = displayText;
  for (const [display, replacement] of Object.entries(map)) {
    if (!text(display) || !text(replacement)) throw new Error('Pronunciation map requires non-empty string replacements');
    spoken = spoken.replaceAll(display, replacement);
  }
  return spoken;
}

export function pronunciationMapHash(value: unknown): string {
  const map = value === undefined ? {} : object(value, 'Pronunciation map');
  const replacements = Object.entries(map).map(([display, spoken]) => {
    if (!text(display) || !text(spoken)) throw new Error('Pronunciation map requires non-empty string replacements');
    return { display, spoken };
  });
  return digest(`${JSON.stringify({ replacements }, null, 2)}\n`);
}

export function createVoiceSynthesisIdentity(input: VoiceSynthesisInput) {
  const profile = validateVoiceProfile(input.profile);
  if (profile.provider !== 'kokoro-onnx') throw new Error('Kokoro synthesis identity requires its original provider');
  for (const [name, value] of Object.entries({ spokenTextSha256: input.spokenTextSha256,
    pronunciationMapSha256: input.pronunciationMapSha256, modelSha256: input.modelSha256,
    voicesSha256: input.voicesSha256, contextHash: input.contextHash })) {
    if (!SHA.test(value)) throw new Error(`Invalid ${name}`);
  }
  if (!Array.isArray(input.orderedSegments) || !input.orderedSegments.length || input.orderedSegments.some(segment => !text(segment))) throw new Error('Ordered semantic speech segments are required');
  for (const [name, value] of Object.entries({ segmentationVersion: input.segmentationVersion,
    backendVersion: input.backendVersion, frontendVersion: input.frontendVersion,
    frontendModelVersion: input.frontendModelVersion, synthesisScriptVersion: input.synthesisScriptVersion })) {
    if (!text(value)) throw new Error(`Invalid ${name}`);
  }
  const hasDirection = input.deliveryMode !== undefined || input.orderedDirections !== undefined;
  const directionIdentity: {
    deliveryMode?: DeliveryMode;
    orderedDirections?: VoiceDirection[];
    orderedEffectiveControls?: ReturnType<typeof resolveVoiceDirection>[];
    directionMappingVersion?: typeof VOICE_DIRECTION_MAPPING_VERSION;
  } = {};
  if (hasDirection) {
    const deliveryMode = validateDeliveryMode(input.deliveryMode);
    if (!Array.isArray(input.orderedDirections) || input.orderedDirections.length !== input.orderedSegments.length) {
      throw new Error('Ordered voice directions must match ordered semantic speech segments');
    }
    const orderedDirections = input.orderedDirections.map(direction => validateVoiceDirection(direction));
    directionIdentity.deliveryMode = deliveryMode;
    directionIdentity.orderedDirections = orderedDirections;
    directionIdentity.orderedEffectiveControls = orderedDirections.map(direction => resolveVoiceDirection(profile, deliveryMode, direction));
    directionIdentity.directionMappingVersion = VOICE_DIRECTION_MAPPING_VERSION;
  }
  return { schemaVersion: '1.0' as const, profile, profileHash: voiceProfileHash(profile),
    spokenTextSha256: input.spokenTextSha256, pronunciationMapSha256: input.pronunciationMapSha256,
    orderedSegments: [...input.orderedSegments], segmentationVersion: input.segmentationVersion,
    modelSha256: input.modelSha256, voicesSha256: input.voicesSha256,
    backendVersion: input.backendVersion, frontendVersion: input.frontendVersion,
    frontendModelVersion: input.frontendModelVersion, synthesisScriptVersion: input.synthesisScriptVersion,
    contextHash: input.contextHash, ...directionIdentity };
}

export function voiceCacheKey(identity: ReturnType<typeof createVoiceSynthesisIdentity>): string {
  return digest(canonical(identity));
}

export function validateVoiceApproval(profile: VoiceProfile, value: unknown): VoiceApproval {
  if (!value || typeof value !== 'object') throw new Error('Invalid voice approval');
  const approval = value as Partial<VoiceApproval>;
  if (!['PENDING_REVIEW', 'APPROVED', 'REJECTED'].includes(approval.status ?? '') ||
      !SHA.test(approval.profileHash ?? '') || !SHA.test(approval.sampleAudioHash ?? '')) throw new Error('Invalid voice approval');
  if (approval.profileHash !== voiceProfileHash(profile)) throw new Error('Voice approval binds another profile');
  return approval as VoiceApproval;
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

export function assertNarrationProfile(profileValue: unknown, evidenceValue: unknown, contextHash: string, deliveryModeValue?: unknown): void {
  if (!SHA.test(contextHash)) throw new Error('Invalid narration contextHash');
  const profile = validateVoiceProfile(profileValue, { rejectedVoiceIds: ['zm_011'] });
  const evidence = object(evidenceValue, 'Narration profile evidence');
  if (evidence.qualityRulesSha256 !== contextHash) throw new Error('Narration qualityRulesSha256 does not match current context');
  if (evidence.contextHash !== contextHash) throw new Error('Narration contextHash does not match current context');
  const generator = object(evidence.generator, 'Narration generator');
  if (deliveryModeValue !== undefined) {
    const deliveryMode = validateDeliveryMode(deliveryModeValue);
    if (generator.deliveryMode !== deliveryMode) throw new Error('Narration generator.deliveryMode does not match audio delivery mode');
    if (generator.directionMappingVersion !== (profile.provider === 'qwen3-tts' ? QWEN_DIRECTION_MAPPING_VERSION : VOICE_DIRECTION_MAPPING_VERSION)) throw new Error('Narration generator.directionMappingVersion is invalid');
  }
  const expected = {
    provider: profile.provider,
    backend: profile.provider,
    ...(profile.provider === 'qwen3-tts' ? { configuredModel: profile.modelId } : { model: profile.modelId }),
    voice: profile.voiceId,
    locale: profile.locale,
    profileHash: voiceProfileHash(profile),
  };
  for (const [field, value] of Object.entries(expected)) {
    if (generator[field] !== value) throw new Error(`Narration generator.${field} does not match voice profile`);
  }
  const settings = object(generator.settings, 'Narration generator.settings');
  if (profile.provider === 'qwen3-tts') {
    const model = generator.sourceMode === 'reuse-approved-audio' && ['Qwen3-TTS-12Hz-1.7B-VoiceDesign', profile.modelId].includes(String(generator.model)) ? generator.model
      : generator.sourceMode === 'reference-synthesis' ? profile.modelId : undefined;
    if (!model || generator.model !== model) throw new Error('Qwen actual model must match its sourceMode');
    const expectedSettings = { referenceAudioSha256: profile.referenceAudioSha256, selectionSha256: profile.selectionSha256,
      instructApplied: false, speed: 1, pitchSemitones: 0 };
    if (canonical(settings) !== canonical(expectedSettings)) throw new Error('Qwen generator.settings must describe actual reference controls');
    return;
  }
  const expectedSettings = {
    speed: profile.speed,
    sentencePauseSec: profile.sentencePauseSec,
    clausePauseSec: profile.clausePauseSec,
    trim: true,
    continuous: false,
    isPhonemes: true,
  };
  for (const [field, value] of Object.entries(expectedSettings)) {
    if (settings[field] !== value) throw new Error(`Narration generator.settings.${field} does not match voice profile`);
  }
}

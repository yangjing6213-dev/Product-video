# SPDX-License-Identifier: Apache-2.0
"""Shared, model-truthful expression mapping for the local Mandarin scripts."""

VOICE_DIRECTION_MAPPING_VERSION = "kokoro-zh-direction-v1"
VOICE_DIRECTION_METADATA_ONLY = ["purpose", "attitude", "emphasis", "visualEvent"]
KOKORO_UNSUPPORTED_EXPRESSION = ["emotion", "pitch", "energy", "word-level-emphasis"]
PACE_FACTOR = {
    "natural": {"slower": 0.96, "steady": 1.0, "brisk": 1.04},
    "presenter": {"slower": 0.92, "steady": 0.98, "brisk": 1.08},
}
PAUSE_FACTOR = {
    "natural": {"connected": 0.8, "balanced": 1.0, "deliberate": 1.2},
    "presenter": {"connected": 0.65, "balanced": 0.9, "deliberate": 1.4},
}


def validate_voice_direction(value, display_text=None):
    if (not isinstance(value, dict)
            or any(not isinstance(value.get(key), str) or not value[key].strip()
                   for key in ("purpose", "attitude", "visualEvent"))
            or value.get("pace") not in ("slower", "steady", "brisk")
            or value.get("pause") not in ("connected", "balanced", "deliberate")
            or not isinstance(value.get("emphasis"), list)
            or any(not isinstance(item, str) or not item.strip() for item in value["emphasis"])
            or len(set(value["emphasis"])) != len(value["emphasis"])):
        raise ValueError("Invalid voice direction")
    if display_text is not None and any(item not in display_text for item in value["emphasis"]):
        raise ValueError("Voice direction emphasis must occur in display text")
    return {"purpose": value["purpose"].strip(), "attitude": value["attitude"].strip(),
            "emphasis": [item.strip() for item in value["emphasis"]], "pace": value["pace"],
            "pause": value["pause"], "visualEvent": value["visualEvent"].strip()}


def resolve_voice_direction(profile, delivery_mode, value, display_text=None):
    if delivery_mode not in PACE_FACTOR:
        raise ValueError("Invalid voice delivery mode")
    direction = validate_voice_direction(value, display_text)
    speed = round(profile["speed"] * PACE_FACTOR[delivery_mode][direction["pace"]], 3)
    pause_factor = PAUSE_FACTOR[delivery_mode][direction["pause"]]
    sentence_pause = round(profile["sentencePauseSec"] * pause_factor, 3)
    clause_pause = round(profile["clausePauseSec"] * pause_factor, 3)
    if not 0.75 <= speed <= 1.3 or not 0 <= sentence_pause <= 2 or not 0 <= clause_pause <= 1:
        raise ValueError("Effective voice controls exceed the supported project range")
    return {"mappingVersion": VOICE_DIRECTION_MAPPING_VERSION, "deliveryMode": delivery_mode,
            "speed": speed, "sentencePauseSec": sentence_pause, "clausePauseSec": clause_pause,
            "metadataOnly": VOICE_DIRECTION_METADATA_ONLY.copy(),
            "unsupported": KOKORO_UNSUPPORTED_EXPRESSION.copy()}


def direction_identity_fields(delivery_mode, directions, controls):
    if (delivery_mode not in PACE_FACTOR or not isinstance(directions, list) or not directions
            or not isinstance(controls, list) or len(directions) != len(controls)):
        raise ValueError("Ordered voice directions must match semantic speech segments")
    return {"deliveryMode": delivery_mode, "orderedDirections": directions,
            "orderedEffectiveControls": controls, "directionMappingVersion": VOICE_DIRECTION_MAPPING_VERSION}

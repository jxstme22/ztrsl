import type { AudioSourceConfig, SourceConfigs } from "./model";
import { SUGGESTED_TAG_MAX } from "./model";

/**
 * Validation for editable source fields. Per ADR-015 the presentation fields
 * are validated (bounded, no control characters) but never used as keys.
 */

export type SourceValidationResult = {
  /** Hard errors — the config must not be saved as-is. */
  errors: string[];
  /** Soft warnings — saveable, but the user should see them. */
  warnings: string[];
};

function hasControlCharacters(text: string): boolean {
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) {
      return true;
    }
  }
  return false;
}

export function validateName(displayName: string): string | null {
  if (displayName.trim().length === 0) {
    return "Name is required.";
  }
  if (displayName.trim().length > 48) {
    return "Name must be 48 characters or fewer.";
  }
  if (hasControlCharacters(displayName)) {
    return "Name must not contain control characters.";
  }
  return null;
}

export function validateTag(captionTag: string): string | null {
  if (captionTag.trim().length === 0) {
    return "Tag is required.";
  }
  if (captionTag.trim().length > 32) {
    return "Tag must be 32 characters or fewer.";
  }
  if (hasControlCharacters(captionTag)) {
    return "Tag must not contain control characters.";
  }
  return null;
}

export function tagLengthWarning(captionTag: string): string | null {
  if (captionTag.trim().length > SUGGESTED_TAG_MAX) {
    return `Tags longer than ${String(SUGGESTED_TAG_MAX)} characters may wrap in the overlay.`;
  }
  return null;
}

export type ValidateSourcesInput = {
  configs: SourceConfigs;
  /** Persisted configs (if any) used only to detect duplicate tags. */
  otherSources?: readonly AudioSourceConfig[];
};

export function validateSource(
  source: AudioSourceConfig,
  siblings: readonly AudioSourceConfig[],
): SourceValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const nameError = validateName(source.displayName);
  if (nameError) {
    errors.push(nameError);
  }

  const tagError = validateTag(source.captionTag);
  if (tagError) {
    errors.push(tagError);
  } else {
    const lengthWarning = tagLengthWarning(source.captionTag);
    if (lengthWarning) {
      warnings.push(lengthWarning);
    }
  }

  const duplicate = siblings.some(
    (other) =>
      other.sourceId !== source.sourceId &&
      other.captionTag.trim().toUpperCase() ===
        source.captionTag.trim().toUpperCase(),
  );
  if (duplicate) {
    warnings.push(
      `Tag "${source.captionTag.trim().toUpperCase()}" is also used by another source — captions may look identical.`,
    );
  }

  if (
    source.monitoring.enabled &&
    source.monitoring.headphoneEndpointId === null
  ) {
    errors.push("Monitoring is enabled but no headphone endpoint is selected.");
  }

  return { errors, warnings };
}

export function validateSources(
  configs: SourceConfigs,
  siblings: readonly AudioSourceConfig[] = configs.sources,
): SourceValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  for (const source of configs.sources) {
    const result = validateSource(source, siblings);
    errors.push(...result.errors);
    warnings.push(...result.warnings);
  }
  return { errors, warnings };
}

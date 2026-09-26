// JSON import utilities for OP-XY preset files
import { deepMerge, internalToPercent } from './valueConversions';
import type { AppState } from '../context/AppContext';

// Types for imported JSON structures
interface ImportedEngineSettings {
  playmode?: string;
  transpose?: number;
  'velocity.sensitivity'?: number;
  volume?: number;
  width?: number;
  highpass?: number;
  'portamento.amount'?: number;
  'portamento.type'?: number;
  'tuning.root'?: number;
}

interface ImportedPresetJson {
  engine?: ImportedEngineSettings;
  envelope?: any;
  fx?: any;
  lfo?: any;
  octave?: number;
  name?: string;
  type?: string;
}

// Import drum preset JSON and convert to UI state
export function importDrumPresetJson(
  jsonContent: string,
  currentState: AppState
): Partial<AppState> {
  try {
    const importedJson: ImportedPresetJson = JSON.parse(jsonContent);
    
    if (importedJson.type !== 'drum') {
      throw new Error('Invalid preset type: expected drum preset');
    }

    const updates: Partial<AppState> = {
      drumSettings: { ...currentState.drumSettings }
    };

    // Import preset name if available
    if (importedJson.name) {
      updates.drumSettings!.presetName = importedJson.name;
    }

    // Import engine settings and convert to UI format (0-100%)
    if (importedJson.engine) {
      const engine = importedJson.engine;
      const presetSettings = { ...currentState.drumSettings.presetSettings };

      if (engine.playmode) {
        presetSettings.playmode = engine.playmode as any;
      }
      if (typeof engine.transpose === 'number') {
        presetSettings.transpose = engine.transpose;
      }
      if (typeof engine['velocity.sensitivity'] === 'number') {
        presetSettings.velocity = internalToPercent(engine['velocity.sensitivity']);
      }
      if (typeof engine.volume === 'number') {
        presetSettings.volume = internalToPercent(engine.volume);
      }
      if (typeof engine.width === 'number') {
        presetSettings.width = internalToPercent(engine.width);
      }

      updates.drumSettings!.presetSettings = presetSettings;
    }

    // Store the full imported JSON for later merging during patch generation
    (updates as any).importedDrumPresetJson = importedJson;

    return updates;
  } catch (error) {
    throw new Error(`Failed to import drum preset: ${error instanceof Error ? error.message : 'Invalid JSON'}`);
  }
}

// Import multisample preset JSON and convert to UI state
export function importMultisamplePresetJson(
  jsonContent: string,
  currentState: AppState
): Partial<AppState> {
  try {
    const importedJson: ImportedPresetJson = JSON.parse(jsonContent);
    
    if (importedJson.type !== 'multisampler') {
      throw new Error('Invalid preset type: expected multisample preset');
    }

    const updates: Partial<AppState> = {
      multisampleSettings: { ...currentState.multisampleSettings }
    };

    // Import preset name if available
    if (importedJson.name) {
      updates.multisampleSettings!.presetName = importedJson.name;
    }

    // TODO: Import multisample advanced settings when implemented
    // For now, just store the imported JSON for later merging

    // Store the full imported JSON for later merging during patch generation
    (updates as any).importedMultisamplePresetJson = importedJson;

    return updates;
  } catch (error) {
    throw new Error(`Failed to import multisample preset: ${error instanceof Error ? error.message : 'Invalid JSON'}`);
  }
}

/**
 * Merge an imported preset's settings into the base patch JSON.
 *
 * There were two of these — `mergeImportedDrumSettings` and
 * `mergeImportedMultisampleSettings` — byte-for-byte identical apart from their names. Both
 * base patches carry exactly the same sections, so there was never a drum/multisample
 * difference to express. Keeping two copies is how a fix reaches one caller and not the
 * other, which is precisely what happened to `validatePresetJson` in this same file: the copy
 * that received the improvement turned out to be the one nothing called.
 *
 * `deepMerge` is what refuses `__proto__` and friends, so the untrusted-input guarding lives
 * one level down and applies to every caller of this.
 */
export function mergeImportedSettings(baseJson: any, importedJson?: ImportedPresetJson): void {
  if (!importedJson) return;

  // The sections a preset may carry over. Both base patches have all of them, so the
  // `baseJson[section] = {}` below is a guard rather than a path taken in practice.
  const sectionsToMerge = ['engine', 'envelope', 'fx', 'lfo', 'octave'] as const;

  for (const section of sectionsToMerge) {
    const incoming = importedJson[section as keyof ImportedPresetJson];
    if (!incoming) continue;
    if (!baseJson[section]) baseJson[section] = {};
    deepMerge(baseJson[section], incoming);
  }
}

// Preset validation lives in `presetImport.ts`, which is the path the UI actually uses:
// `importPresetFromFile` reads the file, parses it and validates in one place. A second
// `validatePresetJson` used to sit here, reachable only from its own test — so it gave the
// appearance of coverage for a path no user could reach. The live one keeps the parse
// position in its message, which is what makes a hand-edited patch.json fixable.

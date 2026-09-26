import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateDrumPatch, generateMultisamplePatch } from '../../utils/patchGeneration';
import type { AppState } from '../../context/AppContext';
import JSZip from 'jszip';

// Mock JSZip
vi.mock('jszip', () => {
  let mockTransposeValue = 12; // Default value

  // This canned answer is a trap: `zip.file('patch.json').async('string')` returns it
  // whatever the generator actually wrote, so any test reading the zip back this way
  // asserts the fixture rather than the code. Two transpose tests did exactly that and
  // stayed green when the transpose write was deleted outright. Every test here now
  // inspects `file.mock.calls` instead; this remains only so `loadAsync` does not throw.
  const mockJSZipInstance = {
    file: vi.fn().mockReturnValue({
      async: vi.fn().mockImplementation(() => Promise.resolve(`{"engine":{"transpose":${mockTransposeValue}}}`))
    }),
    generateAsync: vi.fn().mockResolvedValue(new Blob(['mock zip'], { type: 'application/zip' }))
  };

  const mockJSZip = vi.fn().mockImplementation(() => mockJSZipInstance) as any;
  mockJSZip.loadAsync = vi.fn().mockResolvedValue(mockJSZipInstance);
  
  // Allow setting the transpose value for different tests
  mockJSZip.setTransposeValue = (value: number) => {
    mockTransposeValue = value;
  };

  return {
    default: mockJSZip
  };
});

// Mock audio utilities
vi.mock('../../utils/audio', () => ({
  audioBufferToWav: vi.fn().mockResolvedValue(new Blob(['mock wav'], { type: 'audio/wav' })),
  sanitizeName: vi.fn().mockImplementation((name) => name.replace(/[^a-zA-Z0-9.]/g, '')),
  generateFilename: vi.fn().mockImplementation((presetName: string, separator: string, _type: string, index: number, _originalName: string, _mapping: string, extension: string) => {
    const drumShortLabels = [
      'KD1', 'KD2', 'SD1', 'SD2', 'RIM', 'CLP', 'TB', 'SH', 'CH', 'CL1', 'OH', 'CAB',
      'LT1', 'RC', 'MT', 'CC', 'HT', 'COW', 'TRI', 'LT2', 'LC', 'WS', 'HC', 'GUI'
    ];
    const drumLabel = drumShortLabels[index] || `DRUM${index + 1}`;
    return `${presetName}${separator}${drumLabel}.${extension}`;
  }),
  getAudioFileExtension: vi.fn(() => 'wav'),
  percentToInternal: vi.fn((percent: number) => Math.round(percent * 327.67))
}));

// Mock convertAudioFormat
vi.mock('../../utils/audioFormats', () => ({
  convertAudioFormat: vi.fn().mockImplementation(async (buffer: any) => buffer)
}));

/** The fields every `AppState` literal in this file repeats, so the fixtures below need not. */
const baseState = {
  currentTab: 'multisample' as const,
  drumSamples: [],
  multisampleFiles: [],
  selectedMultisample: null,
  isLoading: false,
  error: null,
  isDrumKeyboardPinned: false,
  isMultisampleKeyboardPinned: false,
  notifications: [],
  importedDrumPreset: null,
  importedMultisamplePreset: null,
  isSessionRestorationModalOpen: false,
  sessionInfo: null,
  midiNoteMapping: 'C3' as const,
  tauriDevice: null,
  tauriPresets: [],
  tauriSamples: [],
  tauriStorageInfo: null,
  tauriProjects: [],
  tauriConnecting: false,
  drumSettings: {
    sampleRate: 44100, bitDepth: 16, channels: 2, presetName: 'Kit', normalize: false,
    normalizeLevel: -6, autoZeroCrossing: true, renameFiles: false,
    filenameSeparator: ' ' as const, audioFormat: 'wav' as const,
    presetSettings: { playmode: 'poly' as const, transpose: 0, velocity: 100, volume: 100, width: 100 },
  },
  multisampleSettings: {
    sampleRate: 44100, bitDepth: 16, channels: 2, presetName: 'Pads', normalize: false,
    normalizeLevel: -6, autoZeroCrossing: true, cutAtLoopEnd: false, gain: 0,
    loopEnabled: true, loopOnRelease: true, renameFiles: false,
    filenameSeparator: ' ' as const, audioFormat: 'wav' as const,
    transpose: 0, velocitySensitivity: 20, volume: 69, width: 0, highpass: 0,
    portamentoType: 'linear' as const, portamentoAmount: 0, tuningRoot: 0,
    ampEnvelope: { attack: 0, decay: 0, sustain: 32767, release: 0 },
    filterEnvelope: { attack: 0, decay: 0, sustain: 32767, release: 0 },
  },
};

/** One multisample zone with known loop points, for the conversion tests below. */
function multisampleStateWithLoop(): AppState {
  const audioBuffer = {
    duration: 2,
    length: 88_200,
    sampleRate: 44_100,
    numberOfChannels: 1,
    getChannelData: () => new Float32Array(88_200),
  } as unknown as AudioBuffer;
  return {
    ...baseState,
    currentTab: 'multisample',
    multisampleFiles: [{
      file: new File([new Uint8Array([1])], 'pad.wav'),
      audioBuffer,
      name: 'pad.wav',
      isLoaded: true,
      rootNote: 60,
      inPoint: 0,
      outPoint: 2,
      loopStart: 0.5,
      loopEnd: 1.5,
      originalBitDepth: 16,
      originalSampleRate: 44_100,
      originalChannels: 1,
      fileSize: 1024,
      duration: 2,
    }],
  } as unknown as AppState;
}

describe('patchGeneration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * These two tests were `expect(true).toBe(true)` with comments claiming to verify the
   * behaviour their names describe. That is worse than no test: they counted towards the
   * suite and their names asserted coverage of the export extension and of loop-point
   * conversion — the latter being the one thing `docs/hardware-test-guide.md` singles out as
   * unsettleable by reading. Anyone scanning the file would have believed it was covered.
   *
   * They read what the generator actually wrote now, using the same `file.mock.calls`
   * inspection the honest tests in this file use rather than the canned `loadAsync` fixture.
   */
  describe('format conversion', () => {
    it('names every exported sample with the extension the chosen format uses', async () => {
      const mockZip = { file: vi.fn(), generateAsync: vi.fn().mockResolvedValue(new Blob(['z'])) };
      const JSZip = (await import('jszip')).default;
      vi.mocked(JSZip).mockImplementation(() => mockZip as unknown as JSZip);

      await generateMultisamplePatch(multisampleStateWithLoop(), 'Loops', undefined, undefined, undefined, 0, 'aiff');
      const written = vi.mocked(mockZip.file).mock.calls.map(call => String(call[0]));
      const audio = written.filter(name => name !== 'patch.json');
      expect(audio.length, 'no sample was written, so this proves nothing').toBeGreaterThan(0);
      // The name says `.wav`; the truth is that it matches the requested format.
      for (const name of audio) expect(name.toLowerCase()).toMatch(/\.aif$/);

      vi.mocked(mockZip.file).mockClear();
      await generateMultisamplePatch(multisampleStateWithLoop(), 'Loops', undefined, undefined, undefined, 0, 'wav');
      for (const name of vi.mocked(mockZip.file).mock.calls.map(call => String(call[0])).filter(n => n !== 'patch.json')) {
        expect(name.toLowerCase()).toMatch(/\.wav$/);
      }
    });
  });

  describe('AIF loop points conversion', () => {
    it('converts loop points from seconds to frames, with an inclusive end', async () => {
      const mockZip = { file: vi.fn(), generateAsync: vi.fn().mockResolvedValue(new Blob(['z'])) };
      const JSZip = (await import('jszip')).default;
      vi.mocked(JSZip).mockImplementation(() => mockZip as unknown as JSZip);

      // A two-second sample at 44.1 kHz, looping from 0.5 s to 1.5 s.
      await generateMultisamplePatch(multisampleStateWithLoop(), 'Loops', undefined, undefined, undefined, 0, 'aiff');
      const patchCall = vi.mocked(mockZip.file).mock.calls.find(call => call[0] === 'patch.json');
      expect(patchCall, 'no patch.json was written').toBeDefined();
      const region = JSON.parse(String(patchCall![1])).regions[0];

      // 0.5 s x 44100 = 22050, and 1.5 s x 44100 = 66150 — but the writers want the last
      // frame rather than one past it, so the end is 66149.
      expect(region['loop.start']).toBe(22050);
      expect(region['loop.end']).toBe(66149);
      expect(region['loop.end'], 'the loop end must stay inside the sample').toBeLessThan(region.framecount);
    });
  });

  describe('drum patch generation with unassigned samples', () => {
    it('should include unassigned samples in ZIP but exclude from patch.json', async () => {
      // Create a mock state with both assigned and unassigned samples
      const mockState: AppState = {
        currentTab: 'drum',
        drumSettings: {
          sampleRate: 44100,
          bitDepth: 16,
          channels: 2,
          presetName: 'Test Kit',
          normalize: false,
          normalizeLevel: -6.0,
          autoZeroCrossing: true,
          presetSettings: {
            playmode: 'poly',
            transpose: 0,
            velocity: 100,
            volume: 100,
            width: 100
          },
          renameFiles: false,
          filenameSeparator: ' ',
          audioFormat: 'wav' as const
        },
                 multisampleSettings: {
           sampleRate: 44100,
           bitDepth: 16,
           channels: 2,
           presetName: 'Test Multisample',
           normalize: false,
           normalizeLevel: -6.0,
           autoZeroCrossing: true,
           renameFiles: false,
           filenameSeparator: ' ',
           audioFormat: 'wav' as const,
           cutAtLoopEnd: false,
           gain: 0,
           loopEnabled: true,
           loopOnRelease: false,
           playmode: 'poly',
           transpose: 0,
           velocitySensitivity: 100,
           volume: 100,
           width: 100,
           highpass: 0,
           portamentoType: 'linear',
           portamentoAmount: 0,
           tuningRoot: 60,
           ampEnvelope: { attack: 0, decay: 0, sustain: 32767, release: 1000 },
           filterEnvelope: { attack: 0, decay: 3276, sustain: 983, release: 23757 }
         },
        drumSamples: [
          // Assigned sample (should be in both ZIP and patch.json)
          {
            file: new File(['assigned1'], 'assigned1.wav', { type: 'audio/wav' }),
            audioBuffer: new AudioContext().createBuffer(1, 44100, 44100),
            name: 'assigned1.wav',
            isLoaded: true,
            inPoint: 0,
            outPoint: 1.0,
            playmode: 'oneshot',
            reverse: false,
            transpose: 0,
            pan: 0,
            gain: 0,
            hasBeenEdited: false,
            isAssigned: true,
            assignedKey: 0,
            originalBitDepth: 16,
            originalSampleRate: 44100,
            originalChannels: 2,
            fileSize: 1024,
            duration: 1.0
          },
          // Unassigned sample (should be in ZIP but NOT in patch.json)
          {
            file: new File(['unassigned1'], 'unassigned1.wav', { type: 'audio/wav' }),
            audioBuffer: new AudioContext().createBuffer(1, 44100, 44100),
            name: 'unassigned1.wav',
            isLoaded: true,
            inPoint: 0,
            outPoint: 1.0,
            playmode: 'oneshot',
            reverse: false,
            transpose: 0,
            pan: 0,
            gain: 0,
            hasBeenEdited: false,
            isAssigned: false,
            assignedKey: undefined,
            originalBitDepth: 16,
            originalSampleRate: 44100,
            originalChannels: 2,
            fileSize: 1024,
            duration: 1.0
          },
          // Another assigned sample (should be in both ZIP and patch.json)
          {
            file: new File(['assigned2'], 'assigned2.wav', { type: 'audio/wav' }),
            audioBuffer: new AudioContext().createBuffer(1, 44100, 44100),
            name: 'assigned2.wav',
            isLoaded: true,
            inPoint: 0,
            outPoint: 1.0,
            playmode: 'oneshot',
            reverse: false,
            transpose: 0,
            pan: 0,
            gain: 0,
            hasBeenEdited: false,
            isAssigned: true,
            assignedKey: 1,
            originalBitDepth: 16,
            originalSampleRate: 44100,
            originalChannels: 2,
            fileSize: 1024,
            duration: 1.0
          }
        ],
        multisampleFiles: [],
        selectedMultisample: null,
        isLoading: false,
        error: null,
        isDrumKeyboardPinned: false,
        isMultisampleKeyboardPinned: false,
        notifications: [],
        importedDrumPreset: null,
        importedMultisamplePreset: null,
        isSessionRestorationModalOpen: false,
        sessionInfo: null,
        midiNoteMapping: 'C3' as const,
    tauriDevice: null,
    tauriPresets: [],
      tauriSamples: [],
    tauriStorageInfo: null,
    tauriProjects: [],
    tauriConnecting: false
      };

      // Mock JSZip to capture what files are added
      const mockZip = {
        file: vi.fn(),
        generateAsync: vi.fn().mockResolvedValue(new Blob(['mock zip'], { type: 'application/zip' }))
      };
      
      const JSZip = (await import('jszip')).default;
      vi.mocked(JSZip).mockImplementation(() => mockZip as any);

      // Generate the patch
      await generateDrumPatch(mockState, 'Test Kit');

      // Verify that all samples (assigned and unassigned) were added to the ZIP
      expect(mockZip.file).toHaveBeenCalledWith('assigned1.wav', expect.any(Promise));
      expect(mockZip.file).toHaveBeenCalledWith('unassigned1.wav', expect.any(Promise));
      expect(mockZip.file).toHaveBeenCalledWith('assigned2.wav', expect.any(Promise));

      // Verify that patch.json was added to the ZIP
      expect(mockZip.file).toHaveBeenCalledWith('patch.json', expect.any(String));

      // Get the patch.json content to verify only assigned samples are included
      const patchJsonCall = vi.mocked(mockZip.file).mock.calls.find(call => call[0] === 'patch.json');
      expect(patchJsonCall).toBeDefined();
      
      const patchJsonContent = JSON.parse(patchJsonCall![1] as string);
      
      // Verify that only assigned samples are in the regions array
      expect(patchJsonContent.regions).toHaveLength(2); // Only 2 assigned samples
      
      // Verify the regions contain the correct sample names
      const regionSampleNames = patchJsonContent.regions.map((region: any) => region.sample);
      expect(regionSampleNames).toContain('assigned1.wav');
      expect(regionSampleNames).toContain('assigned2.wav');
      expect(regionSampleNames).not.toContain('unassigned1.wav'); // Should NOT be in patch.json
    });
  });
}); 

describe('Drum patch generation with updated mappings', () => {
  it('should generate correct filenames for drum samples with updated indices', async () => {
    // Test the filename generation directly using the mock
    const { generateFilename } = vi.mocked(await import('../../utils/audio'));
    
    // Test specific indices that were changed
    expect(generateFilename('Test Kit', ' ', 'drum', 0, 'sample0.wav', 'C3', 'wav')).toBe('Test Kit KD1.wav');
    expect(generateFilename('Test Kit', ' ', 'drum', 12, 'sample12.wav', 'C3', 'wav')).toBe('Test Kit LT1.wav');
    expect(generateFilename('Test Kit', ' ', 'drum', 18, 'sample18.wav', 'C3', 'wav')).toBe('Test Kit TRI.wav');
    expect(generateFilename('Test Kit', ' ', 'drum', 19, 'sample19.wav', 'C3', 'wav')).toBe('Test Kit LT2.wav');
    expect(generateFilename('Test Kit', ' ', 'drum', 20, 'sample20.wav', 'C3', 'wav')).toBe('Test Kit LC.wav');
    expect(generateFilename('Test Kit', ' ', 'drum', 21, 'sample21.wav', 'C3', 'wav')).toBe('Test Kit WS.wav');
    expect(generateFilename('Test Kit', ' ', 'drum', 22, 'sample22.wav', 'C3', 'wav')).toBe('Test Kit HC.wav');
  });
});

describe('Drum patch generation with sample settings', () => {
  it('should include sample settings in generated patch.json regions', async () => {
    // Create a mock state with samples that have custom settings
    const mockState: AppState = {
      currentTab: 'drum',
      drumSettings: {
        sampleRate: 44100,
        bitDepth: 16,
        channels: 2,
        presetName: 'Test Kit',
        normalize: false,
        normalizeLevel: -6.0,
        autoZeroCrossing: true,
        presetSettings: {
          playmode: 'poly',
          transpose: 0,
          velocity: 100,
          volume: 100,
          width: 100
        },
        renameFiles: false,
        filenameSeparator: ' ',
        audioFormat: 'wav' as const
      },
      multisampleSettings: {
        sampleRate: 44100,
        bitDepth: 16,
        channels: 2,
        presetName: 'Test Multisample',
        normalize: false,
        normalizeLevel: -6.0,
        autoZeroCrossing: true,
        renameFiles: false,
        filenameSeparator: ' ',
        audioFormat: 'wav' as const,
        cutAtLoopEnd: false,
        gain: 0,
        loopEnabled: true,
        loopOnRelease: false,
        playmode: 'poly',
        transpose: 0,
        velocitySensitivity: 100,
        volume: 100,
        width: 100,
        highpass: 0,
        portamentoType: 'linear',
        portamentoAmount: 0,
        tuningRoot: 60,
        ampEnvelope: {
          attack: 0,
          decay: 0,
          sustain: 32767,
          release: 0
        },
        filterEnvelope: {
          attack: 0,
          decay: 0,
          sustain: 32767,
          release: 0
        }
      },
      drumSamples: [
        // Sample with custom settings
        {
          file: new File(['sample1'], 'sample1.wav', { type: 'audio/wav' }),
          audioBuffer: new AudioContext().createBuffer(1, 44100, 44100),
          name: 'sample1.wav',
          isLoaded: true,
          inPoint: 0,
          outPoint: 1.0,
          playmode: 'group',
          reverse: true,
          transpose: 12,
          pan: 50,
          gain: -6,
          hasBeenEdited: true,
          isAssigned: true,
          assignedKey: 0,
          originalBitDepth: 16,
          originalSampleRate: 44100,
          originalChannels: 2,
          fileSize: 1024,
          duration: 1.0
        }
      ],
      multisampleFiles: [],
      selectedMultisample: null,
      isLoading: false,
      error: null,
      isDrumKeyboardPinned: false,
      isMultisampleKeyboardPinned: false,
      notifications: [],
      importedDrumPreset: null,
      importedMultisamplePreset: null,
      isSessionRestorationModalOpen: false,
      sessionInfo: null,
      midiNoteMapping: 'C3' as const,
    tauriDevice: null,
    tauriPresets: [],
      tauriSamples: [],
    tauriStorageInfo: null,
    tauriProjects: [],
    tauriConnecting: false
    };

    // Mock JSZip to capture what files are added
    const mockZip = {
      file: vi.fn(),
      generateAsync: vi.fn().mockResolvedValue(new Blob(['mock zip'], { type: 'application/zip' }))
    };
    
    const JSZip = (await import('jszip')).default;
    vi.mocked(JSZip).mockImplementation(() => mockZip as any);

    // Generate the patch
    await generateDrumPatch(mockState, 'Test Kit');

    // Verify that patch.json was added to the ZIP
    expect(mockZip.file).toHaveBeenCalledWith('patch.json', expect.any(String));

    // Get the patch.json content to verify sample settings are included
    const patchJsonCall = vi.mocked(mockZip.file).mock.calls.find(call => call[0] === 'patch.json');
    expect(patchJsonCall).toBeDefined();
    
    const patchJsonContent = JSON.parse(patchJsonCall![1] as string);
    
    // Verify that the region contains the correct sample settings
    expect(patchJsonContent.regions).toHaveLength(1);
    const region = patchJsonContent.regions[0];
    
    // Check that all sample settings are properly included
    expect(region.playmode).toBe('group');
    expect(region.reverse).toBe(true);
    expect(region.transpose).toBe(12);
    expect(region.pan).toBe(50);
    expect(region.gain).toBe(-6);
    expect(region.sample).toBe('sample1.wav');
  });
}); 

describe('patch export structure', () => {
  it('should apply transpose setting to engine in drum patch', async () => {
    // Set the mock to return transpose value 12 for drum patch
    (JSZip as any).setTransposeValue(12);
    
    const mockState: AppState = {
      currentTab: 'drum',
      drumSettings: {
        sampleRate: 44100,
        bitDepth: 16,
        channels: 2,
        presetName: 'Test Kit',
        normalize: false,
        normalizeLevel: -6.0,
        autoZeroCrossing: true,
        presetSettings: {
          playmode: 'poly',
          transpose: 12, // Set transpose to +12 semitones
          velocity: 100,
          volume: 100,
          width: 100
        },
        renameFiles: false,
        filenameSeparator: ' ',
        audioFormat: 'wav' as const
      },
      multisampleSettings: {
        sampleRate: 44100,
        bitDepth: 16,
        channels: 2,
        presetName: 'Test Multisample',
        normalize: false,
        normalizeLevel: -6.0,
        autoZeroCrossing: true,
        renameFiles: false,
        filenameSeparator: ' ',
        audioFormat: 'wav' as const,
        cutAtLoopEnd: false,
        gain: 0,
        loopEnabled: true,
        loopOnRelease: false,
        playmode: 'poly',
        transpose: 0,
        velocitySensitivity: 100,
        volume: 100,
        width: 100,
        highpass: 0,
        portamentoType: 'linear',
        portamentoAmount: 0,
        tuningRoot: 60,
        ampEnvelope: { attack: 0, decay: 0, sustain: 32767, release: 1000 },
        filterEnvelope: { attack: 0, decay: 3276, sustain: 983, release: 23757 }
      },
      drumSamples: [],
      multisampleFiles: [],
      selectedMultisample: null,
      isLoading: false,
      error: null,
      isDrumKeyboardPinned: false,
      isMultisampleKeyboardPinned: false,
      notifications: [],
      importedDrumPreset: null,
      importedMultisamplePreset: null,
      isSessionRestorationModalOpen: false,
      sessionInfo: null,
      midiNoteMapping: 'C3' as const,
    tauriDevice: null,
    tauriPresets: [],
      tauriSamples: [],
    tauriStorageInfo: null,
    tauriProjects: [],
    tauriConnecting: false
    };
    
    // As with the multisample case: read what the generator wrote.
    const mockZip = { file: vi.fn(), generateAsync: vi.fn().mockResolvedValue(new Blob(['z'])) };
    vi.mocked(JSZip).mockImplementation(() => mockZip as unknown as JSZip);
    await generateDrumPatch(mockState, 'Test Drum Kit');

    const patchCall = vi.mocked(mockZip.file).mock.calls.find(call => call[0] === 'patch.json');
    expect(patchCall, 'no patch.json was written').toBeDefined();
    expect(JSON.parse(String(patchCall![1])).engine.transpose).toBe(12);
  });

  it('should apply transpose setting to engine in multisample patch', async () => {
    // Set the mock to return transpose value -6 for multisample patch
    (JSZip as any).setTransposeValue(-6);
    
    const mockState: AppState = {
      currentTab: 'multisample',
      drumSettings: {
        sampleRate: 44100,
        bitDepth: 16,
        channels: 2,
        presetName: 'Test Kit',
        normalize: false,
        normalizeLevel: -6.0,
        autoZeroCrossing: true,
        presetSettings: {
          playmode: 'poly',
          transpose: 0,
          velocity: 100,
          volume: 100,
          width: 100
        },
        renameFiles: false,
        filenameSeparator: ' ',
        audioFormat: 'wav' as const
      },
      multisampleSettings: {
        sampleRate: 44100,
        bitDepth: 16,
        channels: 2,
        presetName: 'Test Multisample',
        normalize: false,
        normalizeLevel: -6.0,
        autoZeroCrossing: true,
        renameFiles: false,
        filenameSeparator: ' ',
        audioFormat: 'wav' as const,
        cutAtLoopEnd: false,
        gain: 0,
        loopEnabled: true,
        loopOnRelease: false,
        playmode: 'poly',
        transpose: -6, // Set transpose to -6 semitones
        velocitySensitivity: 100,
        volume: 100,
        width: 100,
        highpass: 0,
        portamentoType: 'linear',
        portamentoAmount: 0,
        tuningRoot: 60,
        ampEnvelope: { attack: 0, decay: 0, sustain: 32767, release: 1000 },
        filterEnvelope: { attack: 0, decay: 3276, sustain: 983, release: 23757 }
      },
      drumSamples: [],
      multisampleFiles: [],
      selectedMultisample: null,
      isLoading: false,
      error: null,
      isDrumKeyboardPinned: false,
      isMultisampleKeyboardPinned: false,
      notifications: [],
      importedDrumPreset: null,
      importedMultisamplePreset: null,
      isSessionRestorationModalOpen: false,
      sessionInfo: null,
      midiNoteMapping: 'C3' as const,
    tauriDevice: null,
    tauriPresets: [],
      tauriSamples: [],
    tauriStorageInfo: null,
    tauriProjects: [],
    tauriConnecting: false
    };
    
    // Read what the generator wrote, not what the mock was told to return. The previous
    // version called `JSZip.loadAsync(blob)` and read `zip.file('patch.json').async()`,
    // which this file's mock answers with a canned `{"engine":{"transpose":N}}` fixture —
    // so the test set N, read N back, and passed. Deleting the transpose write from the
    // generator entirely left it green.
    const mockZip = { file: vi.fn(), generateAsync: vi.fn().mockResolvedValue(new Blob(['z'])) };
    vi.mocked(JSZip).mockImplementation(() => mockZip as unknown as JSZip);
    await generateMultisamplePatch(mockState, 'Test Multisample');

    const patchCall = vi.mocked(mockZip.file).mock.calls.find(call => call[0] === 'patch.json');
    expect(patchCall, 'no patch.json was written').toBeDefined();
    expect(JSON.parse(String(patchCall![1])).engine.transpose).toBe(-6);
  });
}); 
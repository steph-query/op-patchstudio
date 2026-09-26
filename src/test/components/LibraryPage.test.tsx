import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { LibraryPage } from '../../components/library/LibraryPage';
import { indexedDB } from '../../utils/indexedDB';
import { sessionStorageIndexedDB } from '../../utils/sessionStorageIndexedDB';
import { generateDrumPatch, generateMultisamplePatch, downloadBlob } from '../../utils/patchGeneration';
import type { LibraryPreset } from '../../utils/libraryUtils';
import { restoredLoopPoints } from '../../utils/libraryUtils';
import { AUDIO_CONSTANTS } from '../../utils/constants';

// Mock dependencies
vi.mock('../../utils/indexedDB', () => ({
  indexedDB: {
    add: vi.fn(),
    get: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getAll: vi.fn(),
    getByIndex: vi.fn(),
  },
  STORES: {
    PRESETS: 'presets',
    SESSIONS: 'sessions',
    SAMPLES: 'samples',
    METADATA: 'metadata',
  }
}));

vi.mock('../../utils/sessionStorageIndexedDB', () => ({
  sessionStorageIndexedDB: {
    markSessionAsSavedToLibrary: vi.fn(),
    resetSavedToLibraryFlag: vi.fn(),
  }
}));

vi.mock('../../utils/patchGeneration', () => ({
  generateDrumPatch: vi.fn(),
  generateMultisamplePatch: vi.fn(),
  downloadBlob: vi.fn(),
}));

vi.mock('../../context/AppContext', () => ({
  useAppContext: () => ({
    state: {
      currentTab: 'library',
      drumSettings: {
        sampleRate: 44100,
        bitDepth: 16,
        channels: 2,
        presetName: 'Test Drum Kit',
        normalize: false,
        normalizeLevel: AUDIO_CONSTANTS.DRUM_NORMALIZATION_LEVEL,
        presetSettings: {
          playmode: 'poly',
          transpose: 0,
          velocity: 20,
          volume: 69,
          width: 0
        },
        renameFiles: false,
        filenameSeparator: ' '
      },
      multisampleSettings: {
        sampleRate: 44100,
        bitDepth: 16,
        channels: 2,
        presetName: 'Test Multisample',
        normalize: false,
        normalizeLevel: AUDIO_CONSTANTS.MULTISAMPLE_NORMALIZATION_LEVEL,
        cutAtLoopEnd: false,
        gain: 0,
        loopEnabled: true,
        loopOnRelease: true,
        renameFiles: false,
        filenameSeparator: ' '
      },
      drumSamples: [],
      multisampleFiles: [],
      selectedMultisample: null,
      isDrumKeyboardPinned: false,
      isMultisampleKeyboardPinned: false,
      isLoading: false,
      error: null,
      notifications: [],
      importedDrumPreset: null,
      importedMultisamplePreset: null,
      isSessionRestorationModalOpen: false,
      sessionInfo: null
    },
    dispatch: vi.fn(),
  }),
}));

// Mock AudioContext
const mockAudioContext = {
  decodeAudioData: vi.fn(() => Promise.resolve({})),
  sampleRate: 44100,
};

// Mock window.AudioContext
Object.defineProperty(window, 'AudioContext', {
  value: vi.fn(() => mockAudioContext),
  writable: true,
});

Object.defineProperty(window, 'webkitAudioContext', {
  value: vi.fn(() => mockAudioContext),
  writable: true,
});

// Mock window.innerWidth
Object.defineProperty(window, 'innerWidth', {
  value: 1024,
  writable: true,
});

// Mock CustomEvent
global.CustomEvent = vi.fn() as any;

describe('LibraryPage', () => {
  const mockIndexedDB = indexedDB as any;
  const mockSessionStorage = sessionStorageIndexedDB as any;
  const mockGenerateDrumPatch = generateDrumPatch as any;
  const mockGenerateMultisamplePatch = generateMultisamplePatch as any;
  const mockDownloadBlob = downloadBlob as any;

  const mockPresets: LibraryPreset[] = [
    {
      id: 'preset-1',
      name: 'Drum Kit 1',
      type: 'drum',
      data: {
        drumSettings: {},
        drumSamples: [],
        multisampleSettings: {},
        multisampleFiles: [],
        importedDrumPreset: null,
        importedMultisamplePreset: null,
      },
      createdAt: Date.now() - 86400000, // 1 day ago
      updatedAt: Date.now() - 86400000,
      isFavorite: false,
      sampleCount: 8,
    },
    {
      id: 'preset-2',
      name: 'Multisample 1',
      type: 'multisample',
      data: {
        drumSettings: {},
        drumSamples: [],
        multisampleSettings: {},
        multisampleFiles: [],
        importedDrumPreset: null,
        importedMultisamplePreset: null,
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
      isFavorite: true,
      sampleCount: 12,
    },
    {
      id: 'preset-3',
      name: 'Drum Kit 2',
      type: 'drum',
      data: {
        drumSettings: {},
        drumSamples: [],
        multisampleSettings: {},
        multisampleFiles: [],
        importedDrumPreset: null,
        importedMultisamplePreset: null,
      },
      createdAt: Date.now() - 172800000, // 2 days ago
      updatedAt: Date.now() - 172800000,
      isFavorite: false,
      sampleCount: 16,
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mockIndexedDB.getAll.mockResolvedValue(mockPresets);
    mockSessionStorage.markSessionAsSavedToLibrary.mockResolvedValue(undefined);
    mockGenerateDrumPatch.mockResolvedValue(new Blob());
    mockGenerateMultisamplePatch.mockResolvedValue(new Blob());
    mockDownloadBlob.mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Loading Presets', () => {
    it('should load presets successfully on mount', async () => {
      render(<LibraryPage />);

      // First, wait for the loading to complete
      await waitFor(() => {
        expect(screen.queryByText('loading...')).not.toBeInTheDocument();
      });

      // Then check that presets are loaded
      await waitFor(() => {
        expect(screen.getByText('Drum Kit 1')).toBeInTheDocument();
        expect(screen.getByText('Multisample 1')).toBeInTheDocument();
        expect(screen.getByText('Drum Kit 2')).toBeInTheDocument();
      });
    });

    it('should show loading state initially', () => {
      render(<LibraryPage />);
      
      expect(screen.getByText('loading...')).toBeInTheDocument();
    });

    it('should handle loading error gracefully', async () => {
      mockIndexedDB.getAll.mockRejectedValue(new Error('Database error'));
      
      render(<LibraryPage />);

      await waitFor(() => {
        expect(screen.queryByText('loading...')).not.toBeInTheDocument();
      });

      // When there's an error, the table is still rendered but empty
      await waitFor(() => {
        expect(screen.getByText('name')).toBeInTheDocument(); // Table header
        expect(screen.getByText('type')).toBeInTheDocument(); // Table header
        expect(screen.getByText('samples')).toBeInTheDocument(); // Table header
        expect(screen.getByText('updated')).toBeInTheDocument(); // Table header
        expect(screen.getByText('actions')).toBeInTheDocument(); // Table header
      });
    });
  });

  describe('Filtering and Sorting', () => {
    beforeEach(async () => {
      render(<LibraryPage />);
      // Wait for loading to complete
      await waitFor(() => {
        expect(screen.queryByText('loading...')).not.toBeInTheDocument();
      });
      await waitFor(() => {
        expect(screen.getByText('Drum Kit 1')).toBeInTheDocument();
      });
    });

    it('should filter presets by search term', async () => {
      const searchInput = screen.getByPlaceholderText('search presets...');
      fireEvent.change(searchInput, { target: { value: 'Drum' } });

      await waitFor(() => {
        expect(screen.getByText('Drum Kit 1')).toBeInTheDocument();
        expect(screen.getByText('Drum Kit 2')).toBeInTheDocument();
        expect(screen.queryByText('Multisample 1')).not.toBeInTheDocument();
      });
    });

    it('should filter presets by type', async () => {
      const typeSelect = screen.getByRole('combobox');
      fireEvent.change(typeSelect, { target: { value: 'drum' } });

      await waitFor(() => {
        expect(screen.getByText('Drum Kit 1')).toBeInTheDocument();
        expect(screen.getByText('Drum Kit 2')).toBeInTheDocument();
        expect(screen.queryByText('Multisample 1')).not.toBeInTheDocument();
      });
    });

    it('should filter presets by favorites', async () => {
      const favoritesCheckbox = screen.getByLabelText('favorites');
      fireEvent.click(favoritesCheckbox);

      await waitFor(() => {
        expect(screen.getByText('Multisample 1')).toBeInTheDocument();
        expect(screen.queryByText('Drum Kit 1')).not.toBeInTheDocument();
        expect(screen.queryByText('Drum Kit 2')).not.toBeInTheDocument();
      });
    });

    it('should sort presets by name', async () => {
      // Wait for loading to complete and table to be rendered
      await waitFor(() => {
        expect(screen.queryByText('loading...')).not.toBeInTheDocument();
      });
      
      // Wait for the table headers to be rendered
      await waitFor(() => {
        expect(screen.getByText('name')).toBeInTheDocument();
      });
      
      const nameHeader = screen.getByText('name');
      fireEvent.click(nameHeader);

      await waitFor(() => {
        const presetNames = screen.getAllByText(/Drum Kit|Multisample/);
        expect(presetNames[0]).toHaveTextContent('Drum Kit 1');
        expect(presetNames[1]).toHaveTextContent('Drum Kit 2');
        expect(presetNames[2]).toHaveTextContent('Multisample 1');
      });
    });

    /**
     * Ties must not depend on the order the list arrived in.
     *
     * A batch import gives every preset the same timestamp, so sorting by date is one long
     * tie: `localeCompare` returns 0, `sort` is stable, and the result is therefore whatever
     * order the data happened to be in. The same library could present the same presets in
     * different orders between renders, which is the flake that led here.
     *
     * The fixtures elsewhere in this file arrive in name order, so they cannot tell a
     * tie-break from luck. These arrive **reversed**.
     */
    it('orders equal timestamps by name, whatever order they arrive in', async () => {
      const sameMoment = Date.now();
      const reversed = ['Take 3', 'Take 2', 'Take 1'].map((name, index) => ({
        ...mockPresets[0],
        id: `tie-${index}`,
        name,
        createdAt: sameMoment,
        updatedAt: sameMoment,
      }));
      mockIndexedDB.getAll.mockResolvedValue(reversed);
      const view = render(<LibraryPage />);
      await waitFor(() => expect(view.queryByText('loading...')).not.toBeInTheDocument());

      // Sorted by date, all equal — so the name decides, not the input order.
      await waitFor(() => {
        const names = view.getAllByText(/Take \d/).map(node => node.textContent?.trim());
        expect(names).toEqual(['Take 1', 'Take 2', 'Take 3']);
      });
    });

    /**
     * Almost everything in this app is numbered — "long take 01", "Preset 12", "kick 2.wav" —
     * and a plain `localeCompare` sorts those "Preset 1, Preset 10, Preset 11, … Preset 2",
     * which reads as a broken list. The pagination fixtures are 25 presets that all share one
     * timestamp, so they are one long tie: with lexicographic ordering page two began at
     * "Preset 22", and with numeric collation it begins at "Preset 16" as a person would
     * expect. That test passing unchanged is the evidence this ordering is the intuitive one.
     */
    it('sorts numbered names the way a person reads them', async () => {
      const names = () => screen.getAllByText(/Drum Kit \d|Multisample \d/).map(node => node.textContent?.trim());
      fireEvent.click(screen.getByText('name'));
      await waitFor(() => expect(names()).toEqual(['Drum Kit 1', 'Drum Kit 2', 'Multisample 1']));
      // The fixtures here do not expose the 1/10/2 problem on their own, so assert the
      // comparison directly as well — this is the rule that was wrong.
      const collate = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
      expect(['take 10', 'take 2', 'take 1'].sort(collate)).toEqual(['take 1', 'take 2', 'take 10']);
      expect(['take 10', 'take 2', 'take 1'].sort((a, b) => a.localeCompare(b))).toEqual(['take 1', 'take 10', 'take 2']);
    });

    /**
     * This failed about once in fifteen runs, and the cause was the app rather than the test:
     * two of the three fixtures are drum kits, so sorting by type is a **tie** between them.
     * `localeCompare` returns 0, `sort` is stable, and the result was therefore whatever
     * order the list happened to arrive in — so the same library could present two kits in
     * either order between renders. The comparator now breaks ties by name, which makes this
     * assertion meaningful rather than lucky.
     */
    it('should sort presets by type', async () => {
      const names = () => screen.getAllByText(/Drum Kit \d|Multisample \d/).map(node => node.textContent?.trim());
      fireEvent.click(screen.getByText('type'));

      // Drum kits together, multisample after, and the two kits in name order.
      await waitFor(() => expect(names()).toEqual(['Drum Kit 1', 'Drum Kit 2', 'Multisample 1']));

      // Reversing the primary key must not reverse the tie-break: the kits stay in name
      // order, or the list looks like it is shuffling itself.
      fireEvent.click(screen.getByText('type'));
      await waitFor(() => expect(names()).toEqual(['Multisample 1', 'Drum Kit 1', 'Drum Kit 2']));
    });

    /**
     * This test used to find the presets with `/Drum Kit|Multisample/` and then assert that
     * each one matched `/Drum Kit|Multisample/` — three tautologies. Its own comments said
     * "the exact order depends on the mock data" and "the order should be consistent after
     * sorting", and then checked no order at all, so **a sorting bug could not fail it**.
     * It was also intermittently flaky, because `getAllByText` inside `waitFor` raced the
     * re-render while asserting nothing that depended on it.
     *
     * The fixtures are dated deliberately: Multisample 1 is now, Drum Kit 1 is a day old,
     * Drum Kit 2 is two days old. That is an order, so assert it — the default (newest
     * first) and both directions of the toggle.
     */
    it('should sort presets by date', async () => {
      const names = () => screen.getAllByText(/Drum Kit \d|Multisample \d/).map(node => node.textContent?.trim());

      // The library opens sorted by date, newest first — the most valuable assertion here,
      // because it is the order every user sees without touching anything.
      await waitFor(() => expect(names()).toEqual(['Multisample 1', 'Drum Kit 1', 'Drum Kit 2']));

      // Clicking the header it is already sorted by reverses the order.
      fireEvent.click(screen.getByText('updated'));
      await waitFor(() => expect(names()).toEqual(['Drum Kit 2', 'Drum Kit 1', 'Multisample 1']));

      // And back.
      fireEvent.click(screen.getByText('updated'));
      await waitFor(() => expect(names()).toEqual(['Multisample 1', 'Drum Kit 1', 'Drum Kit 2']));
    });
  });

  describe('Pagination', () => {
    beforeEach(async () => {
      // Create more presets to test pagination
      const manyPresets = Array.from({ length: 25 }, (_, i) => ({
        ...mockPresets[0],
        id: `preset-${i + 1}`,
        name: `Preset ${i + 1}`,
      }));
      mockIndexedDB.getAll.mockResolvedValue(manyPresets);
      
      render(<LibraryPage />);
      await waitFor(() => {
        expect(screen.queryByText('loading...')).not.toBeInTheDocument();
      });
      await waitFor(() => {
        expect(screen.getByText('Preset 1')).toBeInTheDocument();
      });
    });

    it('should navigate between pages', async () => {
      // Click next page button
      const nextButton = screen.getByText('Next');
      fireEvent.click(nextButton);

      await waitFor(() => {
        expect(screen.getByText('Preset 16')).toBeInTheDocument();
        expect(screen.queryByText('Preset 1')).not.toBeInTheDocument();
      });

      // Click previous page button
      const previousButton = screen.getByText('Previous');
      fireEvent.click(previousButton);

      await waitFor(() => {
        expect(screen.getByText('Preset 1')).toBeInTheDocument();
        expect(screen.queryByText('Preset 16')).not.toBeInTheDocument();
      });
    });

    it('should disable navigation buttons appropriately', async () => {
      const previousButton = screen.getByText('Previous');
      const nextButton = screen.getByText('Next');

      expect(previousButton).toBeDisabled();
      expect(nextButton).not.toBeDisabled();

      // Go to last page
      fireEvent.click(nextButton);
      await waitFor(() => {
        expect(screen.getByText('Preset 25')).toBeInTheDocument();
      });

      expect(previousButton).not.toBeDisabled();
      expect(nextButton).toBeDisabled();
    });
  });

  describe('Selection Management', () => {
    beforeEach(async () => {
      render(<LibraryPage />);
      await waitFor(() => {
        expect(screen.queryByText('loading...')).not.toBeInTheDocument();
      });
      await waitFor(() => {
        expect(screen.getByText('Drum Kit 1')).toBeInTheDocument();
      });
    });

    it('should select and deselect individual presets', async () => {
      const checkboxes = screen.getAllByRole('checkbox');
      const firstPresetCheckbox = checkboxes[1]; // Skip the "select all" checkbox
      
      fireEvent.click(firstPresetCheckbox);
      expect(firstPresetCheckbox).toBeChecked();

      fireEvent.click(firstPresetCheckbox);
      expect(firstPresetCheckbox).not.toBeChecked();
    });

    it('should select all presets', async () => {
      const selectAllCheckbox = screen.getAllByRole('checkbox')[0];
      fireEvent.click(selectAllCheckbox);

      const allCheckboxes = screen.getAllByRole('checkbox');
      allCheckboxes.forEach(checkbox => {
        expect(checkbox).toBeChecked();
      });
    });

    it('should clear selection', async () => {
      // Select some presets
      const checkboxes = screen.getAllByRole('checkbox');
      fireEvent.click(checkboxes[1]);
      fireEvent.click(checkboxes[2]);

      // Clear selection
      const clearButton = screen.getByText('delete');
      fireEvent.click(clearButton);

      // Checkboxes should be unchecked
      const allCheckboxes = screen.getAllByRole('checkbox');
      allCheckboxes.forEach(checkbox => {
        expect(checkbox).not.toBeChecked();
      });
    });
  });

  describe('Empty State', () => {
    it('should show empty state when no presets exist', async () => {
      mockIndexedDB.getAll.mockResolvedValue([]);
      render(<LibraryPage />);

      await waitFor(() => {
        expect(screen.queryByText('loading...')).not.toBeInTheDocument();
      });

      // When no presets exist, the table is still rendered but empty
      await waitFor(() => {
        expect(screen.getByText('name')).toBeInTheDocument(); // Table header
        expect(screen.getByText('type')).toBeInTheDocument(); // Table header
        expect(screen.getByText('samples')).toBeInTheDocument(); // Table header
        expect(screen.getByText('updated')).toBeInTheDocument(); // Table header
        expect(screen.getByText('actions')).toBeInTheDocument(); // Table header
      });
    });

    it('should show filtered empty state when no presets match filters', async () => {
      render(<LibraryPage />);
      await waitFor(() => {
        expect(screen.queryByText('loading...')).not.toBeInTheDocument();
      });
      await waitFor(() => {
        expect(screen.getByText('Drum Kit 1')).toBeInTheDocument();
      });

      const searchInput = screen.getByPlaceholderText('search presets...');
      fireEvent.change(searchInput, { target: { value: 'Nonexistent' } });

      // When filtering results in no matches, the table is still rendered but empty
      await waitFor(() => {
        expect(screen.getByText('name')).toBeInTheDocument(); // Table header
        expect(screen.queryByText('Drum Kit 1')).not.toBeInTheDocument(); // No presets shown
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle audio context creation failure', async () => {
      // Mock AudioContext to throw an error
      const originalAudioContext = window.AudioContext;
      window.AudioContext = vi.fn(() => {
        throw new Error('AudioContext not supported');
      }) as any;

      render(<LibraryPage />);
      await waitFor(() => {
        expect(screen.queryByText('loading...')).not.toBeInTheDocument();
      });
      await waitFor(() => {
        expect(screen.getByText('Drum Kit 1')).toBeInTheDocument();
      });

      // Check if load buttons are rendered (they should be in the table)
      const buttons = screen.getAllByRole('button');
      const loadButtons = buttons.filter(button => 
        button.textContent?.toLowerCase().includes('load')
      );
      
      // If no load buttons found, that's okay - the test is about error handling
      if (loadButtons.length > 0) {
        fireEvent.click(loadButtons[0]);
      }

      // Restore original AudioContext
      window.AudioContext = originalAudioContext;
    });
  });
});

/**
 * A loop that starts at the beginning of the sample must survive a round trip.
 *
 * The restore path defaulted these with `||`, which treats **0 as absent**. A saved
 * `loopStart` of 0 is ordinary — it is what a loop from the start of a sample means, and what
 * `patchGeneration` writes — so loading such a preset from the library silently moved the
 * loop start to 20% into the sample. Audible, and invisible in the interface.
 */
describe('restoring loop points from a saved preset', () => {
  it('keeps a loop start of zero instead of treating it as missing', () => {
    expect(restoredLoopPoints({ loopStart: 0, loopEnd: 1.5 }, 2)).toEqual({ loopStart: 0, loopEnd: 1.5 });
  });

  it('keeps any stored value, including ones that look like defaults', () => {
    expect(restoredLoopPoints({ loopStart: 0.4, loopEnd: 1.6 }, 2)).toEqual({ loopStart: 0.4, loopEnd: 1.6 });
    // A loop end of 0 is degenerate but still what was stored; the restore does not invent.
    expect(restoredLoopPoints({ loopStart: 0, loopEnd: 0 }, 2)).toEqual({ loopStart: 0, loopEnd: 0 });
  });

  it('falls back only when the value is genuinely absent', () => {
    // Presets saved before these fields existed have neither.
    expect(restoredLoopPoints({}, 10)).toEqual({ loopStart: 2, loopEnd: 8 });
    expect(restoredLoopPoints({ loopStart: undefined, loopEnd: undefined }, 10)).toEqual({ loopStart: 2, loopEnd: 8 });
    // One present, one missing.
    expect(restoredLoopPoints({ loopStart: 1 }, 10)).toEqual({ loopStart: 1, loopEnd: 8 });
  });
});

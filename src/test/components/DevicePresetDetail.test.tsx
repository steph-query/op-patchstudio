import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DevicePresetDetail } from '../../components/device/DevicePresetDetail';
import type { TauriDevicePreset } from '../../utils/tauriBridge';

vi.mock('../../utils/tauriBridge', () => ({
  mtpReadFile: vi.fn().mockResolvedValue(new Uint8Array()),
  mtpScanTree: vi.fn().mockResolvedValue({ entries: [], missing_roots: [], roots: [] }),
}));

const preset: TauriDevicePreset = {
  id: 'drum/big kit.preset',
  name: 'big kit',
  category: 'drum',
  preset_type: 'drum',
  folder_handle: 30,
  patch_json: { preset_type: 'drum', regions: [] },
  samples: [{ handle: 32, name: 'kick.wav', size: 2_000_000 }],
  total_size: 2_000_000,
};

describe('DevicePresetDetail', () => {
  it('leads with the preset, not with a caveat about a feature that is not there', () => {
    render(<DevicePresetDetail preset={preset} onClose={vi.fn()} />);

    // The note about removal being disabled used to be the panel's opening line,
    // above the name — so the first thing read about a preset was a sentence about
    // something the panel does not offer.
    const heading = screen.getByText('big kit');
    const note = screen.getByText(/Removing a preset from the device is disabled/);
    expect(heading.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBeTruthy();
    // And it still says what it always said, so the constraint is not quietly dropped.
    expect(note).toHaveTextContent('project dependency coverage is incomplete');
    expect(note).toHaveTextContent('Making a copy preserves every existing link');
  });

  it('says nothing about removal when removal is offered', () => {
    render(<DevicePresetDetail preset={preset} onClose={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.queryByText(/Removing a preset from the device is disabled/)).toBeNull();
  });
});

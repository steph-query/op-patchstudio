import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { RecordingModal } from '../../components/common/RecordingModal';

/**
 * Which input you record from must survive closing the modal.
 *
 * `getAudioDevices` had `[]` dependencies while reading `selectedDeviceId`, so it closed
 * over the initial empty value. On the first open that is correct — pick the first device.
 * On every **reopen** the stale closure still saw an empty string and overwrote the choice
 * with `audioInputs[0]`, so a chosen interface silently reverted to the built-in
 * microphone. Nothing announced it, and the recording simply came from the wrong input.
 */

const DEVICES = [
  { deviceId: 'builtin', kind: 'audioinput', label: 'MacBook Pro Microphone', groupId: 'g1', toJSON: () => ({}) },
  { deviceId: 'interface', kind: 'audioinput', label: 'Universal Audio Apollo', groupId: 'g2', toJSON: () => ({}) },
  { deviceId: 'speaker', kind: 'audiooutput', label: 'MacBook Pro Speakers', groupId: 'g3', toJSON: () => ({}) },
];

beforeEach(() => {
  vi.stubGlobal('navigator', {
    ...navigator,
    mediaDevices: {
      getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: vi.fn() }] })),
      enumerateDevices: vi.fn(async () => DEVICES),
    },
  });
});

function open(isOpen: boolean) {
  return (
    <RecordingModal
      isOpen={isOpen}
      onClose={vi.fn()}
      onSave={vi.fn()}
    />
  );
}

/** The device picker, once the enumeration has come back. */
async function picker(): Promise<HTMLSelectElement> {
  return waitFor(() => screen.getByLabelText(/input|device|microphone/i) as HTMLSelectElement);
}

describe('RecordingModal input device', () => {
  it('offers the audio inputs and starts on the first', async () => {
    render(open(true));
    const select = await picker();
    await waitFor(() => expect(select.value).toBe('builtin'));
    // Outputs are not inputs and must not be offered as a recording source.
    expect(screen.queryByText('MacBook Pro Speakers')).toBeNull();
    expect(screen.getByText('Universal Audio Apollo')).toBeInTheDocument();
  });

  it('keeps the chosen input when the modal is closed and reopened', async () => {
    const view = render(open(true));
    const select = await picker();
    await waitFor(() => expect(select.value).toBe('builtin'));

    fireEvent.change(select, { target: { value: 'interface' } });
    expect((await picker()).value).toBe('interface');

    // Close, then open again — the component stays mounted, so the choice is in state.
    view.rerender(open(false));
    view.rerender(open(true));

    const reopened = await picker();
    // Waiting properly: the overwrite happened asynchronously after enumeration, so
    // asserting immediately would pass even with the bug present.
    await waitFor(() => expect(navigator.mediaDevices.enumerateDevices).toHaveBeenCalledTimes(2));
    expect(reopened.value, 'the chosen input was reset on reopen').toBe('interface');
  });
});

import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { PatchSizeIndicator } from '../../components/common/PatchSizeIndicator';

/**
 * The size this shows is a warning about the OP-XY's 8 MB preset limit, so a stale figure
 * is worse than no figure — it says a kit will fit when it will not.
 *
 * The effect that recomputes it was keyed on `audioBuffers.length`. **Swapping one sample
 * for another does not change the count**, so replacing a 0.2 s hi-hat with a 15 s pad left
 * the old size on screen, and with it the old warning state.
 */

/** Enough of an AudioBuffer for `calculatePatchSize`, which reads only these three. */
function buffer(seconds: number, rate = 44_100, channels = 1): AudioBuffer {
  return {
    duration: seconds,
    sampleRate: rate,
    numberOfChannels: channels,
    length: Math.round(seconds * rate),
    getChannelData: () => new Float32Array(1),
  } as unknown as AudioBuffer;
}

const settings = { sampleRate: 44_100, bitDepth: 16, channels: 1 };

/** One mutable state object, so a re-render can present different samples. */
const state: { drumSamples: Array<{ isLoaded: boolean; audioBuffer: AudioBuffer | null }>; multisampleFiles: never[]; drumSettings: typeof settings; multisampleSettings: typeof settings } = {
  drumSamples: [],
  multisampleFiles: [],
  drumSettings: settings,
  multisampleSettings: settings,
};
vi.mock('../../context/AppContext', () => ({ useAppContext: () => ({ state }) }));

function loaded(...buffers: AudioBuffer[]) {
  state.drumSamples = buffers.map(audioBuffer => ({ isLoaded: true, audioBuffer }));
}

/** The figure on screen, in megabytes, whatever wording surrounds it. */
async function shownSize(): Promise<number> {
  // The figure is the labelled status, not just any text that looks like a size — the
  // 8 MB limit is also on screen, and matching loosely found that instead.
  const text = await waitFor(() => {
    const node = screen.getByRole('status', { name: 'preset size estimate' });
    const content = node.textContent ?? '';
    if (/calculating/i.test(content) || !/\d/.test(content)) throw new Error('still calculating');
    return content;
  });
  const match = /([\d.]+)\s*(kb|mb)/i.exec(text);
  if (!match) throw new Error(`no size found in ${text}`);
  const value = Number(match[1]);
  return match[2].toLowerCase() === 'mb' ? value : value / 1024;
}

describe('PatchSizeIndicator', () => {
  beforeEach(() => { state.drumSamples = []; });

  it('reports a size for the loaded samples', async () => {
    loaded(buffer(1), buffer(1));
    render(<PatchSizeIndicator type="drum" />);
    // Two seconds of 44.1 kHz mono 16-bit is about 176 KB, so well under a megabyte.
    await waitFor(async () => expect(await shownSize()).toBeGreaterThan(0));
    expect(await shownSize()).toBeLessThan(1);
  });

  it('follows a sample being swapped for a much longer one', async () => {
    loaded(buffer(0.2));
    const view = render(<PatchSizeIndicator type="drum" />);
    const before = await shownSize();

    // Same count, different audio — the case the old dependency array could not see.
    loaded(buffer(60));
    view.rerender(<PatchSizeIndicator type="drum" />);

    await waitFor(async () => expect(await shownSize()).toBeGreaterThan(before * 10));
    // 60 s of 44.1 kHz mono 16-bit is about 5 MB, which is most of the 8 MB budget.
    expect(await shownSize()).toBeGreaterThan(4);
  });

  it('follows a sample being removed as well as added', async () => {
    loaded(buffer(30), buffer(30));
    const view = render(<PatchSizeIndicator type="drum" />);
    const both = await shownSize();

    loaded(buffer(30));
    view.rerender(<PatchSizeIndicator type="drum" />);
    await waitFor(async () => expect(await shownSize()).toBeLessThan(both * 0.75));
  });
});

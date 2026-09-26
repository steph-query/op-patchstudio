import { renderHook, act } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AppContextProvider, useAppContext } from '../../context/AppContext';
import type { ReactNode } from 'react';

/**
 * A loop point that snaps to the very start of a sample must survive.
 *
 * `APPLY_ZERO_CROSSING_TO_MULTISAMPLE_FILE` took the snapped result with
 * `result.loopStart || initialLoopStart`, and **a snapped loop start of 0 is a real answer** —
 * the loop begins at the start of the sample, or the nearest zero crossing is frame 0.
 * `||` discarded it and silently reverted to the un-snapped value, so the snapping quietly
 * failed for the one case where it landed at the beginning. The symptom is a click at the
 * loop point, which is the single thing zero-crossing snapping exists to prevent.
 *
 * A third site in the same reducer already used `??`, so the correct form was known — these
 * two were oversights rather than decisions.
 */
/**
 * A buffer whose **only** zero crossing is frame 0.
 *
 * The first fixture here had silence at the head, which made every early frame a crossing —
 * so a loop start of 0 snapped to 0 and the initial value was also 0. `0 || 0` and `0 ?? 0`
 * agree, and the test passed against the broken code. The bug needs a *non-zero* loop start
 * that snaps **to** zero, so the signal is non-zero from frame 1 onward and there is nowhere
 * else for the snap to land.
 */
function buffer(frames = 4410) {
  const data = new Float32Array(frames);
  data[0] = 0;
  for (let i = 1; i < frames; i++) data[i] = 0.5;
  return {
    length: frames,
    sampleRate: 44100,
    numberOfChannels: 1,
    duration: frames / 44100,
    getChannelData: () => data,
  } as unknown as AudioBuffer;
}

const wrapper = ({ children }: { children: ReactNode }) => <AppContextProvider>{children}</AppContextProvider>;

describe('zero crossing at the start of a sample', () => {
  it('keeps a snapped loop start of zero rather than reverting it', () => {
    const { result } = renderHook(() => useAppContext(), { wrapper });
    const audioBuffer = buffer();

    // The snapping branch is guarded on this setting, so without it the reducer never
    // reaches the code under test — an earlier version of this test proved nothing because
    // of exactly that.
    act(() => {
      result.current.dispatch({ type: 'SET_MULTISAMPLE_AUTO_ZERO_CROSSING', payload: true });
    });
    expect(result.current.state.multisampleSettings.autoZeroCrossing).toBe(true);

    // Load a zone the way the app does, then set its loop to start at the very beginning.
    act(() => {
      result.current.dispatch({
        type: 'LOAD_MULTISAMPLE_FILE',
        payload: {
          file: new File([new Uint8Array([1])], 'pad.wav'),
          audioBuffer,
          metadata: {
            duration: audioBuffer.duration,
            sampleRate: 44100,
            bitDepth: 16,
            channels: 1,
            hasLoopData: true,
            loopStart: 0,
            loopEnd: audioBuffer.duration * 0.8,
            fileSize: 1,
            format: 'PCM',
          } as never,
          rootNoteOverride: 60,
        },
      });
    });
    // A loop starting three frames in: non-zero, and its nearest zero crossing is frame 0.
    const threeFrames = 3 / 44100;
    act(() => {
      result.current.dispatch({ type: 'UPDATE_MULTISAMPLE_FILE', payload: { index: 0, updates: { loopStart: threeFrames, inPoint: 0, outPoint: audioBuffer.duration } } });
    });
    expect(result.current.state.multisampleFiles[0].loopStart, 'the fixture must start non-zero, or nothing distinguishes || from ??').toBe(threeFrames);

    act(() => {
      result.current.dispatch({ type: 'APPLY_ZERO_CROSSING_TO_MULTISAMPLE_FILE', payload: 0 });
    });

    expect(
      result.current.state.multisampleFiles[0].loopStart,
      'the snapped loop start of 0 was discarded and replaced with the un-snapped value',
    ).toBe(0);
  });
});

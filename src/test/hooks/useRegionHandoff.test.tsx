import { renderHook, act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useRegionHandoff } from '../../hooks/useRegionHandoff';
import { localAudioWindow } from '../../utils/tauriBridge';
import type { CatalogRegion } from '../../utils/tauriBridge';

vi.mock('../../utils/tauriBridge', () => ({ localAudioWindow: vi.fn() }));

const handleDrumSampleUpload = vi.fn();
const handleMultisampleUpload = vi.fn();
vi.mock('../../hooks/useFileUpload', () => ({
  useFileUpload: () => ({ handleDrumSampleUpload, handleMultisampleUpload }),
}));

const dispatch = vi.fn();
const state: { drumSamples: Array<{ isLoaded: boolean }>; multisampleFiles: unknown[] } = {
  drumSamples: Array.from({ length: 24 }, () => ({ isLoaded: false })),
  multisampleFiles: [],
};
vi.mock('../../context/AppContext', () => ({ useAppContext: () => ({ state, dispatch }) }));

const source = { assetId: 'hash-a', takeName: 'long take.wav', sampleRate: 48_000 };
const region: CatalogRegion = { id: 'r1', name: 'kick 01', start_frame: 48_000, end_frame: 72_000, created_unix: 1 };

function actions(payloadType: string) {
  return dispatch.mock.calls.map(([action]) => action).filter(action => action.type === payloadType);
}

describe('useRegionHandoff', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.drumSamples = Array.from({ length: 24 }, () => ({ isLoaded: false }));
    state.multisampleFiles = [];
    vi.mocked(localAudioWindow).mockResolvedValue(new Uint8Array([1, 2, 3, 4]));
  });

  it('renders the region and hands it to the drum builder\'s own upload path', async () => {
    const { result } = renderHook(() => useRegionHandoff());
    await act(async () => { await result.current.toDrumLab(source, region); });

    expect(localAudioWindow).toHaveBeenCalledWith('hash-a', 48_000, 24_000);
    expect(handleDrumSampleUpload).toHaveBeenCalledTimes(1);
    const [file, slot] = handleDrumSampleUpload.mock.calls[0];
    expect(file).toBeInstanceOf(File);
    expect(file.name).toBe('kick 01.wav');
    expect(file.type).toBe('audio/wav');
    expect(slot).toBe(0);
    expect(actions('SET_TAB')[0].payload).toBe('drum');
    expect(actions('ADD_NOTIFICATION')[0].payload.message).toContain('pad 1');
  });

  it('fills the first free pad rather than overwriting a loaded one', async () => {
    state.drumSamples = state.drumSamples.map((sample, index) => ({ ...sample, isLoaded: index < 5 }));
    const { result } = renderHook(() => useRegionHandoff());
    await act(async () => { await result.current.toDrumLab(source, region); });
    expect(handleDrumSampleUpload.mock.calls[0][1]).toBe(5);
  });

  it('refuses when every pad is taken, without touching the builder', async () => {
    state.drumSamples = state.drumSamples.map(sample => ({ ...sample, isLoaded: true }));
    const { result } = renderHook(() => useRegionHandoff());
    await act(async () => { await result.current.toDrumLab(source, region); });

    expect(handleDrumSampleUpload).not.toHaveBeenCalled();
    expect(localAudioWindow).not.toHaveBeenCalled();
    const notice = actions('ADD_NOTIFICATION')[0].payload;
    expect(notice.type).toBe('error');
    expect(notice.message).toContain('All 24 drum pads are in use');
    expect(actions('SET_TAB')).toHaveLength(0);
  });

  it('adds a zone in the sample lab and says where it landed', async () => {
    state.multisampleFiles = [{}, {}];
    const { result } = renderHook(() => useRegionHandoff());
    await act(async () => { await result.current.toSampleLab(source, region); });

    expect(handleMultisampleUpload).toHaveBeenCalledTimes(1);
    expect(handleMultisampleUpload.mock.calls[0][0].name).toBe('kick 01.wav');
    expect(actions('SET_TAB')[0].payload).toBe('multisample');
    expect(actions('ADD_NOTIFICATION')[0].payload.message).toContain('zone 3');
  });

  it('refuses a full sample lab', async () => {
    state.multisampleFiles = Array.from({ length: 24 }, () => ({}));
    const { result } = renderHook(() => useRegionHandoff());
    await act(async () => { await result.current.toSampleLab(source, region); });
    expect(handleMultisampleUpload).not.toHaveBeenCalled();
    expect(actions('ADD_NOTIFICATION')[0].payload.message).toContain('holds 24 zones and is full');
  });

  it('refuses a region longer than one bounded read', async () => {
    const long: CatalogRegion = { ...region, start_frame: 0, end_frame: 48_000 * 45 };
    const { result } = renderHook(() => useRegionHandoff());
    await act(async () => { await result.current.toDrumLab(source, long); });

    expect(localAudioWindow).not.toHaveBeenCalled();
    expect(handleDrumSampleUpload).not.toHaveBeenCalled();
    expect(actions('ADD_NOTIFICATION')[0].payload.message).toContain('limited to 30 s');
  });

  it('warns about the instrument\'s own limit but still hands the clip over', async () => {
    const overLong: CatalogRegion = { ...region, start_frame: 0, end_frame: 48_000 * 25 };
    const { result } = renderHook(() => useRegionHandoff());
    await act(async () => { await result.current.toDrumLab(source, overLong); });

    expect(handleDrumSampleUpload).toHaveBeenCalledTimes(1);
    const messages = actions('ADD_NOTIFICATION').map(action => action.payload.message);
    expect(messages.some(message => message.includes('The OP-XY plays up to 20 s'))).toBe(true);
  });

  it('reports a failed read instead of loading an empty pad', async () => {
    vi.mocked(localAudioWindow).mockRejectedValue(new Error('That take is not a regular file.'));
    const { result } = renderHook(() => useRegionHandoff());
    await act(async () => { await result.current.toDrumLab(source, region); });

    expect(handleDrumSampleUpload).not.toHaveBeenCalled();
    expect(actions('ADD_NOTIFICATION')[0].payload.message).toContain('not a regular file');
    expect(actions('SET_TAB')).toHaveLength(0);
  });

  it('reports how much room is left in each builder', () => {
    state.drumSamples = state.drumSamples.map((sample, index) => ({ ...sample, isLoaded: index < 20 }));
    state.multisampleFiles = [{}, {}, {}];
    const { result } = renderHook(() => useRegionHandoff());
    expect(result.current.freePads).toBe(4);
    expect(result.current.freeZones).toBe(21);
  });

  it('places several regions in start order, filling consecutive pads', async () => {
    const regions: CatalogRegion[] = [
      { id: 'r3', name: 'hat', start_frame: 300_000, end_frame: 310_000, created_unix: 3 },
      { id: 'r1', name: 'kick', start_frame: 100_000, end_frame: 110_000, created_unix: 1 },
      { id: 'r2', name: 'snare', start_frame: 200_000, end_frame: 210_000, created_unix: 2 },
    ];
    const { result } = renderHook(() => useRegionHandoff());
    await act(async () => { await result.current.sendMany(source, regions, 'drum'); });

    expect(handleDrumSampleUpload).toHaveBeenCalledTimes(3);
    expect(handleDrumSampleUpload.mock.calls.map(call => call[0].name)).toEqual(['kick.wav', 'snare.wav', 'hat.wav']);
    expect(handleDrumSampleUpload.mock.calls.map(call => call[1])).toEqual([0, 1, 2]);
    expect(actions('SET_TAB')).toHaveLength(1);
    expect(actions('ADD_NOTIFICATION')[0].payload.message).toBe('3 regions placed in order.');
  });

  it('starts after the pads already in use', async () => {
    state.drumSamples = state.drumSamples.map((sample, index) => ({ ...sample, isLoaded: index < 22 }));
    const regions: CatalogRegion[] = [
      { id: 'r1', name: 'a', start_frame: 0, end_frame: 1000, created_unix: 1 },
      { id: 'r2', name: 'b', start_frame: 2000, end_frame: 3000, created_unix: 2 },
    ];
    const { result } = renderHook(() => useRegionHandoff());
    await act(async () => { await result.current.sendMany(source, regions, 'drum'); });
    expect(handleDrumSampleUpload.mock.calls.map(call => call[1])).toEqual([22, 23]);
  });

  it('sends what fits and names what did not', async () => {
    state.drumSamples = state.drumSamples.map((sample, index) => ({ ...sample, isLoaded: index < 22 }));
    const regions: CatalogRegion[] = [
      { id: 'r1', name: 'a', start_frame: 0, end_frame: 1000, created_unix: 1 },
      { id: 'r2', name: 'b', start_frame: 2000, end_frame: 3000, created_unix: 2 },
      { id: 'r3', name: 'c', start_frame: 4000, end_frame: 5000, created_unix: 3 },
      { id: 'r4', name: 'd', start_frame: 6000, end_frame: 7000, created_unix: 4 },
    ];
    const { result } = renderHook(() => useRegionHandoff());
    await act(async () => { await result.current.sendMany(source, regions, 'drum'); });

    expect(handleDrumSampleUpload).toHaveBeenCalledTimes(2);
    const message = actions('ADD_NOTIFICATION')[0].payload.message;
    expect(message).toContain('2 regions placed in order');
    expect(message).toContain('2 did not fit (c, d)');
    expect(message).toContain('make room and send them again');
  });

  it('refuses the whole batch when there is no room, without reading anything', async () => {
    state.drumSamples = state.drumSamples.map(sample => ({ ...sample, isLoaded: true }));
    const { result } = renderHook(() => useRegionHandoff());
    await act(async () => { await result.current.sendMany(source, [region], 'drum'); });

    expect(localAudioWindow).not.toHaveBeenCalled();
    expect(handleDrumSampleUpload).not.toHaveBeenCalled();
    expect(actions('ADD_NOTIFICATION')[0].payload.type).toBe('error');
    expect(actions('SET_TAB')).toHaveLength(0);
  });

  it('stops at the first failure and never reports a half kit as complete', async () => {
    vi.mocked(localAudioWindow)
      .mockResolvedValueOnce(new Uint8Array([1]))
      .mockRejectedValueOnce(new Error('USB disconnected'));
    const regions: CatalogRegion[] = [
      { id: 'r1', name: 'good', start_frame: 0, end_frame: 1000, created_unix: 1 },
      { id: 'r2', name: 'bad', start_frame: 2000, end_frame: 3000, created_unix: 2 },
      { id: 'r3', name: 'never', start_frame: 4000, end_frame: 5000, created_unix: 3 },
    ];
    const { result } = renderHook(() => useRegionHandoff());
    await act(async () => { await result.current.sendMany(source, regions, 'drum'); });

    expect(handleDrumSampleUpload).toHaveBeenCalledTimes(1);
    const notice = actions('ADD_NOTIFICATION')[0].payload;
    expect(notice.type).toBe('error');
    expect(notice.message).toContain('1 of 3 regions reached the drum lab');
    expect(notice.message).toContain('bad: USB disconnected');
    expect(notice.message).toContain('The takes themselves are unchanged');
  });

  it('adds a batch to the sample lab as zones', async () => {
    state.multisampleFiles = [{}];
    const regions: CatalogRegion[] = [
      { id: 'r1', name: 'low', start_frame: 0, end_frame: 1000, created_unix: 1 },
      { id: 'r2', name: 'high', start_frame: 2000, end_frame: 3000, created_unix: 2 },
    ];
    const { result } = renderHook(() => useRegionHandoff());
    await act(async () => { await result.current.sendMany(source, regions, 'multisample'); });

    expect(handleMultisampleUpload).toHaveBeenCalledTimes(2);
    expect(actions('SET_TAB')[0].payload).toBe('multisample');
    expect(actions('ADD_NOTIFICATION')[0].payload.message).toContain('2 regions placed in order');
  });

  it('does nothing at all for an empty selection', async () => {
    const { result } = renderHook(() => useRegionHandoff());
    await act(async () => { await result.current.sendMany(source, [], 'drum'); });
    expect(localAudioWindow).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });
});

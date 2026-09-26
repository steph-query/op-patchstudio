import { useCallback, useEffect, useRef, useState } from 'react';
import type { TauriPresetSample } from '../utils/tauriBridge';
import { audioContextManager } from '../utils/audioContext';
import { readDevicePreview } from '../utils/deviceAudio';
import { deviceOperation } from '../utils/deviceOperation';
import { describeError } from '../utils/describeError';

export function useDeviceSamplePreview(scope: unknown) {
  const [playingHandle, setPlayingHandle] = useState<number | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const source = useRef<AudioBufferSourceNode | null>(null);
  const generation = useRef(0);
  const stop = useCallback(() => {
    generation.current++;
    if (source.current) { source.current.onended = null; try { source.current.stop(); } catch { /* ended */ } source.current.disconnect(); source.current = null; }
    setPlayingHandle(null);
  }, []);
  useEffect(() => { stop(); setPreviewError(null); return stop; }, [scope, stop]);
  const play = useCallback(async (sample: TauriPresetSample) => {
    const wasPlaying = playingHandle === sample.handle;
    stop();
    if (wasPlaying) return;
    const id = ++generation.current;
    setPreviewError(null);
    try {
      await deviceOperation(async () => {
        const data = await readDevicePreview(sample.handle, sample.size);
        const ctx = await audioContextManager.getAudioContext();
        const buffer = await ctx.decodeAudioData(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer);
        if (id !== generation.current) return;
        const node = ctx.createBufferSource(); node.buffer = buffer; node.connect(ctx.destination);
        node.onended = () => { if (id === generation.current) stop(); };
        source.current = node; node.start(); setPlayingHandle(sample.handle);
      }, { message: `Reading the first seconds of ${sample.name} from the device.` });
    } catch (error) { if (id === generation.current) setPreviewError(describeError(error)); }
  }, [playingHandle, stop]);
  return { playingHandle, previewError, play, stop };
}

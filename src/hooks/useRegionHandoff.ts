import { useCallback } from 'react';
import { useAppContext } from '../context/AppContext';
import { useFileUpload } from './useFileUpload';
import { localAudioWindow } from '../utils/tauriBridge';
import type { CatalogRegion } from '../utils/tauriBridge';
import { getSampleTarget } from '../utils/sampleTargets';
import { describeError } from '../utils/describeError';

/** One read is bounded, so a region longer than this has to be trimmed first. */
export const MAX_HANDOFF_SECONDS = 30;

export interface HandoffSource {
  assetId: string;
  /** Name of the take, used to name the clip. */
  takeName: string;
  sampleRate: number;
}

/**
 * Send a marked region into the drum or sample builder.
 *
 * The region is rendered to a real WAV and handed to the *existing* upload
 * pipeline, so a capture follows exactly the same path as a file dragged in from
 * Finder — same metadata reading, same waveform editing, same preset generation.
 * Nothing about the take on disk changes.
 */
export function useRegionHandoff() {
  const { state, dispatch } = useAppContext();
  const { handleDrumSampleUpload, handleMultisampleUpload } = useFileUpload();

  const notify = useCallback((type: 'success' | 'error', title: string, message: string) => {
    dispatch({ type: 'ADD_NOTIFICATION', payload: { id: crypto.randomUUID(), type, title, message } });
  }, [dispatch]);

  /** Render the region to a File the builders can consume, or explain why not. */
  const renderRegion = useCallback(async (source: HandoffSource, region: CatalogRegion): Promise<File> => {
    const frames = region.end_frame - region.start_frame;
    if (frames < 1) throw new Error('That region has no length.');
    const seconds = source.sampleRate > 0 ? frames / source.sampleRate : 0;
    if (seconds > MAX_HANDOFF_SECONDS) {
      throw new Error(`${region.name} is ${seconds.toFixed(1)} s. One read is limited to ${MAX_HANDOFF_SECONDS} s — trim the region first.`);
    }
    const bytes = await localAudioWindow(source.assetId, region.start_frame, frames);
    // Slice so the File owns its own buffer, not the view returned over IPC.
    return new File([bytes.slice()], `${region.name}.wav`, { type: 'audio/wav' });
  }, []);

  /** Warn when a clip is longer than the instrument will accept, without blocking the handoff. */
  const noteDeviceLimit = useCallback((region: CatalogRegion, source: HandoffSource) => {
    const limit = getSampleTarget('op-xy-samples').maxSeconds;
    const seconds = source.sampleRate > 0 ? (region.end_frame - region.start_frame) / source.sampleRate : 0;
    if (limit !== null && seconds > limit) {
      notify('success', 'longer than the device allows', `${region.name} is ${seconds.toFixed(1)} s. The OP-XY plays up to ${limit} s, so trim it in the editor before sending.`);
    }
  }, [notify]);

  const toDrumLab = useCallback(async (source: HandoffSource, region: CatalogRegion) => {
    const slot = state.drumSamples.findIndex(sample => !sample.isLoaded);
    if (slot === -1) {
      notify('error', 'no free pad', 'All 24 drum pads are in use. Clear one, then send this region again.');
      return;
    }
    try {
      const file = await renderRegion(source, region);
      await handleDrumSampleUpload(file, slot);
      dispatch({ type: 'SET_TAB', payload: 'drum' });
      notify('success', 'sent to drum lab', `${region.name} landed on pad ${slot + 1}. The take itself is unchanged.`);
      noteDeviceLimit(region, source);
    } catch (error) {
      notify('error', 'could not send that region', describeError(error));
    }
  }, [state.drumSamples, renderRegion, handleDrumSampleUpload, dispatch, notify, noteDeviceLimit]);

  const toSampleLab = useCallback(async (source: HandoffSource, region: CatalogRegion) => {
    if (state.multisampleFiles.length >= 24) {
      notify('error', 'no free zone', 'The sample lab holds 24 zones and is full. Remove one, then send this region again.');
      return;
    }
    try {
      const file = await renderRegion(source, region);
      await handleMultisampleUpload(file);
      dispatch({ type: 'SET_TAB', payload: 'multisample' });
      notify('success', 'sent to sample lab', `${region.name} added as zone ${state.multisampleFiles.length + 1}. Set its root note there if the name does not carry one.`);
      noteDeviceLimit(region, source);
    } catch (error) {
      notify('error', 'could not send that region', describeError(error));
    }
  }, [state.multisampleFiles.length, renderRegion, handleMultisampleUpload, dispatch, notify, noteDeviceLimit]);


  /**
   * Send several regions at once, filling consecutive free slots.
   *
   * Marking eight hits in one take and placing them one at a time is the slow
   * part of building a kit, so this renders them in order and reports a single
   * outcome. Regions that do not fit are named rather than dropped, and the
   * first failure stops the batch so a half-filled kit is never presented as
   * complete.
   */
  const sendMany = useCallback(async (source: HandoffSource, regions: CatalogRegion[], target: 'drum' | 'multisample') => {
    if (!regions.length) return;
    const ordered = [...regions].sort((a, b) => a.start_frame - b.start_frame);
    // Free pads are chosen up front: the builder's state does not update between
    // awaits here, so re-scanning per region would target the same pad twice.
    const freeSlots = state.drumSamples.reduce<number[]>((slots, sample, index) => {
      if (!sample.isLoaded) slots.push(index);
      return slots;
    }, []);
    const room = target === 'drum' ? freeSlots.length : 24 - state.multisampleFiles.length;
    if (room <= 0) {
      notify('error', target === 'drum' ? 'no free pads' : 'no free zones',
        target === 'drum'
          ? 'All 24 drum pads are in use. Clear some, then send these regions again.'
          : 'The sample lab holds 24 zones and is full. Remove some, then send these regions again.');
      return;
    }
    const fitting = ordered.slice(0, room);
    const leftOut = ordered.slice(room);
    let placed = 0;
    let failure: string | null = null;
    for (const region of fitting) {
      try {
        const file = await renderRegion(source, region);
        if (target === 'drum') {
          await handleDrumSampleUpload(file, freeSlots[placed]);
        } else {
          await handleMultisampleUpload(file);
        }
        placed++;
      } catch (error) {
        failure = `${region.name}: ${describeError(error)}`;
        break;
      }
    }
    if (placed > 0) dispatch({ type: 'SET_TAB', payload: target });
    const where = target === 'drum' ? 'drum lab' : 'sample lab';
    if (failure) {
      notify('error', 'stopped part way', `${placed} of ${fitting.length} ${fitting.length === 1 ? 'region' : 'regions'} reached the ${where}. ${failure} The takes themselves are unchanged.`);
      return;
    }
    const remainder = leftOut.length
      ? ` ${leftOut.length} did not fit (${leftOut.map(region => region.name).join(', ')}); make room and send ${leftOut.length === 1 ? 'it' : 'them'} again.`
      : '';
    notify('success', `sent to ${where}`, `${placed} ${placed === 1 ? 'region' : 'regions'} placed in order.${remainder}`);
  }, [state.drumSamples, state.multisampleFiles.length, renderRegion, handleDrumSampleUpload, handleMultisampleUpload, dispatch, notify]);

  return { toDrumLab, toSampleLab, sendMany, freePads: state.drumSamples.filter(sample => !sample.isLoaded).length, freeZones: 24 - state.multisampleFiles.length };
}

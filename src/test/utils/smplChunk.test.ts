import { describe, it, expect, beforeEach } from 'vitest';
import { audioBufferToWav } from '../../utils/wavExport';

// Mock AudioBuffer for testing
function createMockAudioBuffer(length = 1000, sampleRate = 44100, channels = 1) {
  const channelData = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    channelData[i] = Math.sin(i * 0.1) * 0.5; // Simple sine wave
  }
  
  const buffers: Float32Array[] = [];
  for (let ch = 0; ch < channels; ch++) {
    buffers.push(channelData);
  }
  
  return {
    length,
    sampleRate,
    numberOfChannels: channels,
    duration: length / sampleRate,
    getChannelData: (channel: number) => buffers[channel],
    copyFromChannel: () => {},
    copyToChannel: () => {}
  } as AudioBuffer;
}

describe('SMPL Chunk Functionality', () => {
  let mockBuffer: any;

  beforeEach(() => {
    mockBuffer = createMockAudioBuffer(1000, 44100, 1);
  });

  describe('audioBufferToWav with SMPL metadata', () => {
    it('should create WAV without SMPL chunk when no metadata provided', async () => {
      const result = await audioBufferToWav(mockBuffer, 16);
      
      expect(result).toBeInstanceOf(Blob);
      expect(result.type).toBe('audio/wav');
      
      // Verify no SMPL chunk is present
      let arrayBuffer: ArrayBuffer;
      if (typeof (result as any).arrayBuffer === 'function') {
        arrayBuffer = await (result as Blob).arrayBuffer();
      } else if (result instanceof Uint8Array) {
        arrayBuffer = result.buffer;
      } else if (result instanceof ArrayBuffer) {
        arrayBuffer = result;
      } else if ((result as any).buffer instanceof ArrayBuffer) {
        arrayBuffer = (result as any).buffer;
      } else {
        console.warn('Skipping SMPL chunk verification - Blob not supported in test environment');
        return;
      }
      
      const uint8Array = new Uint8Array(arrayBuffer);
      
      // Look for "smpl" chunk identifier
      let foundSmpl = false;
      for (let i = 0; i < uint8Array.length - 4; i++) {
        if (uint8Array[i] === 0x73 && // 's'
            uint8Array[i + 1] === 0x6D && // 'm'
            uint8Array[i + 2] === 0x70 && // 'p'
            uint8Array[i + 3] === 0x6C) { // 'l'
          foundSmpl = true;
          break;
        }
      }
      
      expect(foundSmpl).toBe(false);
    });

    it('should create WAV with SMPL chunk when root note provided', async () => {
      const result = await audioBufferToWav(mockBuffer, 16, {
        rootNote: 60
      });
      
      expect(result).toBeInstanceOf(Blob);
      expect(result.type).toBe('audio/wav');
      
      // Verify SMPL chunk is present
      let arrayBuffer: ArrayBuffer;
      if (typeof (result as any).arrayBuffer === 'function') {
        arrayBuffer = await (result as Blob).arrayBuffer();
      } else if (result instanceof Uint8Array) {
        arrayBuffer = result.buffer;
      } else if (result instanceof ArrayBuffer) {
        arrayBuffer = result;
      } else if ((result as any).buffer instanceof ArrayBuffer) {
        arrayBuffer = (result as any).buffer;
      } else {
        console.warn('Skipping SMPL chunk verification - Blob not supported in test environment');
        return;
      }
      
      const uint8Array = new Uint8Array(arrayBuffer);
      
      // Look for "smpl" chunk identifier
      let foundSmpl = false;
      for (let i = 0; i < uint8Array.length - 4; i++) {
        if (uint8Array[i] === 0x73 && // 's'
            uint8Array[i + 1] === 0x6D && // 'm'
            uint8Array[i + 2] === 0x70 && // 'p'
            uint8Array[i + 3] === 0x6C) { // 'l'
          foundSmpl = true;
          break;
        }
      }
      
      expect(foundSmpl).toBe(true);
    });

    it('should create WAV with SMPL chunk when loop points provided', async () => {
      const result = await audioBufferToWav(mockBuffer, 16, {
        loopStart: 100,
        loopEnd: 900
      });
      
      expect(result).toBeInstanceOf(Blob);
      expect(result.type).toBe('audio/wav');
      
      // Verify SMPL chunk is present
      let arrayBuffer: ArrayBuffer;
      if (typeof (result as any).arrayBuffer === 'function') {
        arrayBuffer = await (result as Blob).arrayBuffer();
      } else if (result instanceof Uint8Array) {
        arrayBuffer = result.buffer;
      } else if (result instanceof ArrayBuffer) {
        arrayBuffer = result;
      } else if ((result as any).buffer instanceof ArrayBuffer) {
        arrayBuffer = (result as any).buffer;
      } else {
        console.warn('Skipping SMPL chunk verification - Blob not supported in test environment');
        return;
      }
      
      const uint8Array = new Uint8Array(arrayBuffer);
      
      // Look for "smpl" chunk identifier
      let foundSmpl = false;
      for (let i = 0; i < uint8Array.length - 4; i++) {
        if (uint8Array[i] === 0x73 && // 's'
            uint8Array[i + 1] === 0x6D && // 'm'
            uint8Array[i + 2] === 0x70 && // 'p'
            uint8Array[i + 3] === 0x6C) { // 'l'
          foundSmpl = true;
          break;
        }
      }
      
      expect(foundSmpl).toBe(true);
    });

    it('should create WAV with complete SMPL metadata', async () => {
      const result = await audioBufferToWav(mockBuffer, 16, {
        rootNote: 72, // C4
        loopStart: 200,
        loopEnd: 800
      });
      
      expect(result).toBeInstanceOf(Blob);
      expect(result.type).toBe('audio/wav');
      
      // Verify SMPL chunk is present and contains correct data
      let arrayBuffer: ArrayBuffer;
      if (typeof (result as any).arrayBuffer === 'function') {
        arrayBuffer = await (result as Blob).arrayBuffer();
      } else if (result instanceof Uint8Array) {
        arrayBuffer = result.buffer;
      } else if (result instanceof ArrayBuffer) {
        arrayBuffer = result;
      } else if ((result as any).buffer instanceof ArrayBuffer) {
        arrayBuffer = (result as any).buffer;
      } else {
        console.warn('Skipping SMPL chunk verification - Blob not supported in test environment');
        return;
      }
      
      const uint8Array = new Uint8Array(arrayBuffer);
      const dataView = new DataView(arrayBuffer);
      
      // Find SMPL chunk
      let smplOffset = -1;
      for (let i = 0; i < uint8Array.length - 4; i++) {
        if (uint8Array[i] === 0x73 && // 's'
            uint8Array[i + 1] === 0x6D && // 'm'
            uint8Array[i + 2] === 0x70 && // 'p'
            uint8Array[i + 3] === 0x6C) { // 'l'
          smplOffset = i;
          break;
        }
      }
      
      expect(smplOffset).toBeGreaterThan(-1);
      
      // Verify SMPL chunk structure
      const smplDataOffset = smplOffset + 8;
      const chunkSize = dataView.getUint32(smplOffset + 4, true);
      expect(chunkSize).toBe(60); // Fixed size for SMPL chunk with one loop
      
      // Verify MIDI unity note (offset 12 from smpl data start)
      const midiNote = dataView.getUint32(smplDataOffset + 12, true);
      expect(midiNote).toBe(72);
      
      // Verify number of loops (offset 28 from smpl data start)
      const numLoops = dataView.getUint32(smplDataOffset + 28, true);
      expect(numLoops).toBe(1);
      
      // Verify loop data (offset 36 from smpl data start)
      const loopStart = dataView.getUint32(smplDataOffset + 36 + 8, true);
      const loopEnd = dataView.getUint32(smplDataOffset + 36 + 12, true);
      // Both are inclusive frame indices and are written as given. The writer used to
      // subtract 1 from each "to match reference", which was right for at most one of
      // its two callers — they disagreed about whether the end was inclusive — and
      // never right for the start.
      expect(loopStart).toBe(200);
      expect(loopEnd).toBe(800);
    });

    it('should handle different bit depths with SMPL metadata', async () => {
      const result16 = await audioBufferToWav(mockBuffer, 16, {
        rootNote: 60,
        loopStart: 100,
        loopEnd: 900
      });
      
      const result24 = await audioBufferToWav(mockBuffer, 24, {
        rootNote: 60,
        loopStart: 100,
        loopEnd: 900
      });
      
      expect(result16).toBeInstanceOf(Blob);
      expect(result24).toBeInstanceOf(Blob);
      expect(result16.type).toBe('audio/wav');
      expect(result24.type).toBe('audio/wav');
      
      // 24-bit should be larger than 16-bit
      expect(result24.size).toBeGreaterThan(result16.size);
    });

    it('should handle stereo audio with SMPL metadata', async () => {
      const stereoBuffer = createMockAudioBuffer(1000, 44100, 2);
      
      const result = await audioBufferToWav(stereoBuffer, 16, {
        rootNote: 60,
        loopStart: 100,
        loopEnd: 900
      });
      
      expect(result).toBeInstanceOf(Blob);
      expect(result.type).toBe('audio/wav');
    });

    it('should use default values when metadata is partially provided', async () => {
      const result = await audioBufferToWav(mockBuffer, 16, {
        rootNote: 60
        // loopStart and loopEnd not provided
      });
      
      expect(result).toBeInstanceOf(Blob);
      expect(result.type).toBe('audio/wav');
      
      // Verify SMPL chunk is present
      let arrayBuffer: ArrayBuffer;
      if (typeof (result as any).arrayBuffer === 'function') {
        arrayBuffer = await (result as Blob).arrayBuffer();
      } else if (result instanceof Uint8Array) {
        arrayBuffer = result.buffer;
      } else if (result instanceof ArrayBuffer) {
        arrayBuffer = result;
      } else if ((result as any).buffer instanceof ArrayBuffer) {
        arrayBuffer = (result as any).buffer;
      } else {
        console.warn('Skipping SMPL chunk verification - Blob not supported in test environment');
        return;
      }
      
      const uint8Array = new Uint8Array(arrayBuffer);
      const dataView = new DataView(arrayBuffer);
      
      // Find SMPL chunk
      let smplOffset = -1;
      for (let i = 0; i < uint8Array.length - 4; i++) {
        if (uint8Array[i] === 0x73 && // 's'
            uint8Array[i + 1] === 0x6D && // 'm'
            uint8Array[i + 2] === 0x70 && // 'p'
            uint8Array[i + 3] === 0x6C) { // 'l'
          smplOffset = i;
          break;
        }
      }
      
      expect(smplOffset).toBeGreaterThan(-1);
      
      // Verify default values are used
      const smplDataOffset = smplOffset + 8;
      const midiNote = dataView.getUint32(smplDataOffset + 12, true);
      expect(midiNote).toBe(60);
      
      // With no loop points given, the loop is the whole sample: first frame to last.
      // It used to end at length - 2, a frame short of the audio for no reason.
      const loopStart = dataView.getUint32(smplDataOffset + 36 + 8, true);
      const loopEnd = dataView.getUint32(smplDataOffset + 36 + 12, true);
      expect(loopStart).toBe(0);
      expect(loopEnd).toBe(mockBuffer.length - 1);
    });
  });

  describe('SMPL chunk structure validation', () => {
    it('should have correct SMPL chunk size', async () => {
      const result = await audioBufferToWav(mockBuffer, 16, {
        rootNote: 60,
        loopStart: 100,
        loopEnd: 900
      });
      
      let arrayBuffer: ArrayBuffer;
      if (typeof (result as any).arrayBuffer === 'function') {
        arrayBuffer = await (result as Blob).arrayBuffer();
      } else if (result instanceof Uint8Array) {
        arrayBuffer = result.buffer;
      } else if (result instanceof ArrayBuffer) {
        arrayBuffer = result;
      } else if ((result as any).buffer instanceof ArrayBuffer) {
        arrayBuffer = (result as any).buffer;
      } else {
        console.warn('Skipping SMPL chunk verification - Blob not supported in test environment');
        return;
      }
      
      const uint8Array = new Uint8Array(arrayBuffer);
      const dataView = new DataView(arrayBuffer);
      
      // Find SMPL chunk
      let smplOffset = -1;
      for (let i = 0; i < uint8Array.length - 4; i++) {
        if (uint8Array[i] === 0x73 && // 's'
            uint8Array[i + 1] === 0x6D && // 'm'
            uint8Array[i + 2] === 0x70 && // 'p'
            uint8Array[i + 3] === 0x6C) { // 'l'
          smplOffset = i;
          break;
        }
      }
      
      expect(smplOffset).toBeGreaterThan(-1);
      
      // Verify chunk size is 60 bytes
      const chunkSize = dataView.getUint32(smplOffset + 4, true);
      expect(chunkSize).toBe(60);
    });

    it('should have correct sample period calculation', async () => {
      const result = await audioBufferToWav(mockBuffer, 16, {
        rootNote: 60
      });
      
      let arrayBuffer: ArrayBuffer;
      if (typeof (result as any).arrayBuffer === 'function') {
        arrayBuffer = await (result as Blob).arrayBuffer();
      } else if (result instanceof Uint8Array) {
        arrayBuffer = result.buffer;
      } else if (result instanceof ArrayBuffer) {
        arrayBuffer = result;
      } else if ((result as any).buffer instanceof ArrayBuffer) {
        arrayBuffer = (result as any).buffer;
      } else {
        console.warn('Skipping SMPL chunk verification - Blob not supported in test environment');
        return;
      }
      
      const uint8Array = new Uint8Array(arrayBuffer);
      const dataView = new DataView(arrayBuffer);
      
      // Find SMPL chunk
      let smplOffset = -1;
      for (let i = 0; i < uint8Array.length - 4; i++) {
        if (uint8Array[i] === 0x73 && // 's'
            uint8Array[i + 1] === 0x6D && // 'm'
            uint8Array[i + 2] === 0x70 && // 'p'
            uint8Array[i + 3] === 0x6C) { // 'l'
          smplOffset = i;
          break;
        }
      }
      
      expect(smplOffset).toBeGreaterThan(-1);
      
      // Verify sample period (nanoseconds)
      const smplDataOffset = smplOffset + 8;
      const samplePeriod = dataView.getUint32(smplDataOffset + 8, true);
      const expectedPeriod = Math.round(1000000000 / mockBuffer.sampleRate);
      expect(samplePeriod).toBe(expectedPeriod);
    });
  });
}); 
describe('loop points that used to be written wrong', () => {
  async function loopPointsOf(buffer: AudioBuffer, options: { loopStart?: number; loopEnd?: number }) {
    const bytes = new Uint8Array(await (await audioBufferToWav(buffer, 16, { rootNote: 60, ...options })).arrayBuffer());
    const view = new DataView(bytes.buffer);
    // Walk the chunk list rather than assuming where smpl landed.
    let offset = 12;
    while (offset + 8 <= bytes.length) {
      const id = String.fromCharCode(...bytes.slice(offset, offset + 4));
      const size = view.getUint32(offset + 4, true);
      if (id === 'smpl') {
        return {
          start: view.getUint32(offset + 8 + 36 + 8, true),
          end: view.getUint32(offset + 8 + 36 + 12, true),
        };
      }
      offset += 8 + size + (size % 2);
    }
    throw new Error('no smpl chunk');
  }

  it('does not turn a loop starting at the first frame into 4294967295', async () => {
    // The writer subtracted 1 from the start, and -1 written as an unsigned 32-bit
    // value wraps to the largest possible frame index — a loop beginning past the end
    // of any file. Two callers in patchGeneration pass a loop start of 0.
    const { start, end } = await loopPointsOf(createMockAudioBuffer(1000), { loopStart: 0, loopEnd: 999 });
    expect(start).toBe(0);
    expect(end).toBe(999);
  });

  it('keeps a loop inside the audio even when asked for more', async () => {
    const { start, end } = await loopPointsOf(createMockAudioBuffer(1000), { loopStart: 5000, loopEnd: 9000 });
    expect(start).toBe(999);
    expect(end).toBe(999);
  });

  it('never writes an end before its start', async () => {
    const { start, end } = await loopPointsOf(createMockAudioBuffer(1000), { loopStart: 800, loopEnd: 100 });
    expect(start).toBe(800);
    expect(end).toBeGreaterThanOrEqual(start);
  });
});

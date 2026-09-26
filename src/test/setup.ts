import '@testing-library/jest-dom'
import { vi } from 'vitest'

// Mock AudioBuffer class
class MockAudioBuffer {
  numberOfChannels: number;
  length: number;
  sampleRate: number;
  duration: number;
  private channelData: Float32Array[];

  constructor(numberOfChannels: number, length: number, sampleRate: number) {
    this.numberOfChannels = numberOfChannels;
    this.length = length;
    this.sampleRate = sampleRate;
    this.duration = length / sampleRate;
    this.channelData = [];
    
    // Create Float32Array for each channel
    for (let i = 0; i < numberOfChannels; i++) {
      this.channelData[i] = new Float32Array(length);
    }
  }

  getChannelData(channel: number): Float32Array {
    return this.channelData[channel];
  }

  copyFromChannel(destination: Float32Array, channelNumber: number, startInChannel: number = 0): void {
    const source = this.channelData[channelNumber];
    const length = Math.min(destination.length, source.length - startInChannel);
    for (let i = 0; i < length; i++) {
      destination[i] = source[startInChannel + i];
    }
  }

  copyToChannel(source: Float32Array, channelNumber: number, startInChannel: number = 0): void {
    const destination = this.channelData[channelNumber];
    const length = Math.min(source.length, destination.length - startInChannel);
    for (let i = 0; i < length; i++) {
      destination[startInChannel + i] = source[i];
    }
  }
}

// Mock Audio APIs that aren't available in jsdom
global.AudioContext = vi.fn().mockImplementation(() => ({
  createBufferSource: vi.fn(() => ({
    buffer: null,
    connect: vi.fn(() => ({ connect: vi.fn() })),
    start: vi.fn(),
    stop: vi.fn(),
    playbackRate: { value: 1 }
  })),
  createBuffer: vi.fn((numberOfChannels: number, length: number, sampleRate: number) => {
    return new MockAudioBuffer(numberOfChannels, length, sampleRate);
  }),
  createGain: vi.fn(() => ({
    gain: { value: 1 },
    connect: vi.fn(() => ({ connect: vi.fn() }))
  })),
  createStereoPanner: vi.fn(() => ({
    pan: { value: 0 },
    connect: vi.fn(() => ({ connect: vi.fn() }))
  })),
  destination: {},
  sampleRate: 44100,
  state: 'running',
  resume: vi.fn(() => Promise.resolve()),
  suspend: vi.fn(() => Promise.resolve()),
  close: vi.fn(() => Promise.resolve()),
  decodeAudioData: vi.fn(() => Promise.resolve(new MockAudioBuffer(1, 1000, 44100)))
}))

// Make AudioBuffer available globally
global.AudioBuffer = MockAudioBuffer as any;

// Mock MediaRecorder
const MediaRecorderMock = function (this: any) {
  this.start = vi.fn()
  this.stop = vi.fn()
  this.pause = vi.fn()
  this.resume = vi.fn()
  this.state = 'inactive'
  this.ondataavailable = null
  this.onstop = null
  this.onerror = null
}
MediaRecorderMock.isTypeSupported = vi.fn(() => true)

global.MediaRecorder = MediaRecorderMock as any

// Mock WebMIDI API
const createMockMidiPort = (id: string, name: string, type: 'input' | 'output', manufacturer: string = 'Test Manufacturer') => ({
  id,
  name,
  manufacturer,
  type,
  connection: 'open' as const,
  state: 'connected' as const,
  onmidimessage: null as any,
  onstatechange: null as any,
  send: vi.fn(),
  open: vi.fn(() => Promise.resolve()),
  close: vi.fn(() => Promise.resolve())
})

const createMockMidiAccess = (inputs: any[] = [], outputs: any[] = []) => ({
  inputs: new Map(inputs.map(input => [input.id, input])),
  outputs: new Map(outputs.map(output => [output.id, output])),
  onstatechange: null as any,
  sysexEnabled: false
})

// Mock navigator.requestMIDIAccess
Object.defineProperty(navigator, 'requestMIDIAccess', {
  writable: true,
  value: vi.fn()
})

// Mock navigator.mediaDevices
Object.defineProperty(navigator, 'mediaDevices', {
  writable: true,
  value: {
    getUserMedia: vi.fn(() => Promise.resolve({
      getTracks: () => []
    }))
  }
})

// JSZip mock removed to allow real implementation for testing

// Mock File API methods
global.URL.createObjectURL = vi.fn(() => 'mock-url')
global.URL.revokeObjectURL = vi.fn()

// Mock localStorage and sessionStorage
const localStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
  length: 0,
  key: vi.fn()
}
global.localStorage = localStorageMock as any
global.sessionStorage = localStorageMock as any

// Patch AudioParam and GainNode to support setValueCurveAtTime for ADSR tests
class MockAudioParam {
  value = 1;
  setValueCurveAtTime = vi.fn();
  setValueAtTime = vi.fn();
  linearRampToValueAtTime = vi.fn();
}
global.AudioParam = MockAudioParam as any;
// Patch createGain to return a gain node with a writable gain property
const origCreateGain = global.AudioContext.prototype?.createGain;
if (origCreateGain) {
  global.AudioContext.prototype.createGain = function () {
    const gainNode = origCreateGain.call(this);
    // Overwrite gain with a writable property
    Object.defineProperty(gainNode, 'gain', {
      value: new MockAudioParam(),
      writable: true,
      configurable: true,
      enumerable: true
    });
    return gainNode;
  };
}
/**
 * jsdom's 2D context is a stub, so anything that draws needs one supplied here.
 *
 * This used to be a hand-written list of methods with "add any other needed 2d
 * context methods here" at the bottom. The failure mode was nasty: adding one
 * drawing call to a component crashed a test file that never mentioned canvas,
 * with `ctx.closePath is not a function` from inside a mount effect. Answer any
 * method instead of enumerating them, so the list can never fall behind.
 */
try {
  const origGetContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...args: [string, unknown?]) {
    if (args[0] === '2d') {
      // Assigned properties (fillStyle, lineWidth, font…) read back as they were set.
      const assigned: Record<string | symbol, unknown> = {};
      // One spy per method name, so `expect(ctx.fillRect).toHaveBeenCalled()` still works.
      const methods = new Map<string | symbol, ReturnType<typeof vi.fn>>();
      const ctx = new Proxy(assigned, {
        get(target, prop) {
          if (prop in target) return target[prop];
          if (!methods.has(prop)) {
            // Covers what canvas methods actually return: gradients and patterns
            // (addColorStop), measureText (width), getImageData (data).
            methods.set(prop, vi.fn(() => ({
              addColorStop: vi.fn(),
              width: 0,
              height: 0,
              data: new Uint8ClampedArray(4),
            })));
          }
          return methods.get(prop);
        },
        set(target, prop, value) {
          target[prop] = value;
          return true;
        },
        has: () => true,
      });
      return ctx as unknown as CanvasRenderingContext2D;
    }
    return origGetContext ? origGetContext.apply(this, args) : null;
    // Cast the whole assignment: `getContext` is overloaded per context id, and a
    // single implementation signature cannot satisfy all four overloads.
  } as typeof HTMLCanvasElement.prototype.getContext;
} catch (e) {
  // If we can't mock, ignore and let tests skip or fail gracefully
}

// jsdom 25 omits Blob.arrayBuffer, which real browsers and the Tauri webview provide.
// Back it with FileReader so tests can exercise the same file-reading code paths as the app.
if (typeof Blob !== 'undefined' && !Blob.prototype.arrayBuffer) {
  Blob.prototype.arrayBuffer = function arrayBuffer(this: Blob): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(this);
    });
  };
}

// Export mock utilities for tests
export { createMockMidiPort, createMockMidiAccess }
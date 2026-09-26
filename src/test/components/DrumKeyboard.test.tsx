import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DrumKeyboard } from '../../components/drum/DrumKeyboard';
import { drumKeyMap } from '../../utils/drumKeyMap';
import { AppContextProvider } from '../../context/AppContext';

/**
 * These tests used to declare their own copy of `drumKeyMap` and assert facts about
 * that literal — twelve assertions that could not fail whatever the component did.
 * They read the real mapping now.
 */
describe('DrumKeyboard', () => {
  it('should render the pads, not merely avoid throwing', () => {
    const { container } = render(
      <AppContextProvider>
        <DrumKeyboard />
      </AppContextProvider>
    );
    // A render that throws fails either way; this also says something arrived.
    expect(container).not.toBeEmptyDOMElement();
    expect(screen.getAllByText('A').length).toBeGreaterThan(0);
  });

  it('should have correct drum key mapping for G key in octave 1', () => {
    // Test that the G key in octave 1 correctly maps to "LT2" (low tom alt) at index 19
    const gKeyMapping = drumKeyMap[1].G;
    expect(gKeyMapping.label).toBe('LT2');
    expect(gKeyMapping.idx).toBe(19);
  });

  it('should have correct drum key mapping for A key in octave 1', () => {
    // Test that the A key in octave 1 correctly maps to "LT1" (low tom) at index 12
    const aKeyMapping = drumKeyMap[1].A;
    expect(aKeyMapping.label).toBe('LT1');
    expect(aKeyMapping.idx).toBe(12);
  });

  it('should have correct drum key mapping for S key in octave 1', () => {
    // Test that the S key in octave 1 correctly maps to "MT" (mid-tom) at index 14
    const sKeyMapping = drumKeyMap[1].S;
    expect(sKeyMapping.label).toBe('MT');
    expect(sKeyMapping.idx).toBe(14);
  });

  it('should have correct drum key mapping for D key in octave 1', () => {
    // Test that the D key in octave 1 correctly maps to "HT" (hi-tom) at index 16
    const dKeyMapping = drumKeyMap[1].D;
    expect(dKeyMapping.label).toBe('HT');
    expect(dKeyMapping.idx).toBe(16);
  });

  it('should have correct drum key mapping for F key in octave 1', () => {
    // Test that the F key in octave 1 correctly maps to "TRI" (triangle) at index 18
    const fKeyMapping = drumKeyMap[1].F;
    expect(fKeyMapping.label).toBe('TRI');
    expect(fKeyMapping.idx).toBe(18);
  });

  it('should have correct drum key mapping for Y key in octave 1', () => {
    // Test that the Y key in octave 1 correctly maps to "LC" (low conga) at index 20
    const yKeyMapping = drumKeyMap[1].Y;
    expect(yKeyMapping.label).toBe('LC');
    expect(yKeyMapping.idx).toBe(20);
  });

  it('should have correct drum key mapping for H key in octave 1', () => {
    // Test that the H key in octave 1 correctly maps to "WS" (wood stick) at index 21
    const hKeyMapping = drumKeyMap[1].H;
    expect(hKeyMapping.label).toBe('WS');
    expect(hKeyMapping.idx).toBe(21);
  });

  it('should not have duplicate "LT1" labels in octave 1', () => {
    // Test that there are no duplicate "LT1" labels in octave 1
    const octave1Labels = Object.values(drumKeyMap[1]).map(mapping => mapping.label);
    const lt1Count = octave1Labels.filter(label => label === 'LT1').length;
    expect(lt1Count).toBe(1); // Should only be one "LT1" label (on A key)
  });

  it('should not have duplicate "LT2" labels in octave 1', () => {
    // Test that there are no duplicate "LT2" labels in octave 1
    const octave1Labels = Object.values(drumKeyMap[1]).map(mapping => mapping.label);
    const lt2Count = octave1Labels.filter(label => label === 'LT2').length;
    expect(lt2Count).toBe(1); // Should only be one "LT2" label (on G key)
  });

  it('should not have duplicate "CL1" labels in octave 1', () => {
    // Test that there are no duplicate "CL1" labels in octave 1
    const octave1Labels = Object.values(drumKeyMap[1]).map(mapping => mapping.label);
    const cl1Count = octave1Labels.filter(label => label === 'CL1').length;
    expect(cl1Count).toBe(0); // Should be no "CL1" labels in octave 1 (it's in octave 0)
  });

  it('should not have duplicate "WS" labels in octave 1', () => {
    // Test that there are no duplicate "WS" labels in octave 1
    const octave1Labels = Object.values(drumKeyMap[1]).map(mapping => mapping.label);
    const wsCount = octave1Labels.filter(label => label === 'WS').length;
    expect(wsCount).toBe(1); // Should only be one "WS" label (on H key)
  });

  it('should have unique indices for all keys in octave 1', () => {
    // Test that all indices in octave 1 are unique
    const octave1Indices = Object.values(drumKeyMap[1]).map(mapping => mapping.idx);
    const uniqueIndices = new Set(octave1Indices);
    expect(uniqueIndices.size).toBe(octave1Indices.length);
  });
}); 
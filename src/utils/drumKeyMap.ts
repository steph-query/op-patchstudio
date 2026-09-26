/**
 * Which computer key plays which pad, per bank.
 *
 * Its own module because it is data, not a component: exporting it from
 * `DrumKeyboard.tsx` breaks fast refresh, and the tests need to read the real
 * mapping rather than a copy — a copy is what they used to assert against, which
 * meant twelve assertions that could not fail whatever the component did.
 */
export const drumKeyMap = [
  // Lower octave (octave 0)
  {
    // top row (offset like a real keyboard)
    W: { label: "KD2", idx: 1 }, // index 1 = sample 2
    E: { label: "SD2", idx: 3 }, // index 3 = sample 4
    R: { label: "CLP", idx: 5 }, // index 5 = sample 6
    Y: { label: "CH", idx: 8 },  // index 8 = sample 9
    U: { label: "OH", idx: 10 }, // index 10 = sample 11
    // bottom row
    A: { label: "KD1", idx: 0 },  // index 0 = sample 1
    S: { label: "SD1", idx: 2 },  // index 2 = sample 3
    D: { label: "RIM", idx: 4 },  // index 4 = sample 5
    F: { label: "TB", idx: 6 },   // index 6 = sample 7
    G: { label: "SH", idx: 7 },   // index 7 = sample 8
    H: { label: "CL", idx: 9 },   // index 9 = sample 10
    J: { label: "CAB", idx: 11 }, // index 11 = sample 12
  },
  // Upper octave (octave 1)
  {
    // top row (offset like a real keyboard)
    W: { label: "RC", idx: 13 },  // index 13 = ride cymbal
    E: { label: "CC", idx: 15 },  // index 15 = crash cymbal
    R: { label: "COW", idx: 17 }, // index 17 = cowbell
    Y: { label: "LC", idx: 20 },  // index 20 = low conga
    U: { label: "HC", idx: 22 },  // index 22 = hi-conga
    // bottom row
    A: { label: "LT1", idx: 12 },  // index 12 = low tom
    S: { label: "MT", idx: 14 },  // index 14 = mid-tom
    D: { label: "HT", idx: 16 },  // index 16 = hi-tom
    F: { label: "TRI", idx: 18 }, // index 18 = triangle
    G: { label: "LT2", idx: 19 },  // index 19 = low tom alt
    H: { label: "WS", idx: 21 },  // index 21 = wood stick
    J: { label: "GUI", idx: 23 }, // index 23 = guiro
  },
];

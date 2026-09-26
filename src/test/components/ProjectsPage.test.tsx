import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectsPage } from '../../components/projects/ProjectsPage';
import { mtpReadFile } from '../../utils/tauriBridge';
vi.mock('../../utils/tauriBridge', () => ({ mtpReadFile: vi.fn(), isTauriAvailable: () => false }));
vi.mock('../../context/AppContext', () => ({ useAppContext: () => ({ state }) }));
const state = { tauriDevice: { model: 'OP-XY' }, tauriProjects: [{ handle: 1, name: 'First', size: 12 }, { handle: 2, name: 'Second', size: 12 }], tauriPresets: [], tauriSamples: [] };
const bytes = new Uint8Array([0xdd, 0xcc, 0xbb, 0xaa, 0, 0, 0]);
describe('ProjectsPage', () => {
  beforeEach(() => vi.clearAllMocks());
  it('keeps the most recently selected project when reads finish out of order', async () => {
    let resolveFirst!: (value: Uint8Array) => void;
    vi.mocked(mtpReadFile).mockImplementation(handle => handle === 1 ? new Promise(resolve => { resolveFirst = resolve; }) : Promise.resolve(bytes));
    render(<ProjectsPage />);
    fireEvent.click(screen.getByRole('button', { name: /First/ }));
    fireEvent.click(screen.getByRole('button', { name: /Second/ }));
    expect(await screen.findByRole('heading', { name: 'Second' })).toBeInTheDocument();
    await act(async () => resolveFirst(bytes));
    expect(screen.getByRole('heading', { name: 'Second' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'First' })).not.toBeInTheDocument();
  });
  it('shows read failures and supports retrying the same project', async () => {
    vi.mocked(mtpReadFile).mockRejectedValueOnce(new Error('USB disconnected')).mockResolvedValue(bytes);
    render(<ProjectsPage />);
    fireEvent.click(screen.getByRole('button', { name: /First/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('USB disconnected');
    fireEvent.click(screen.getByRole('button', { name: /First/ }));
    expect(await screen.findByRole('heading', { name: 'First' })).toBeInTheDocument();
  });
  it('rejects non-project data', async () => {
    vi.mocked(mtpReadFile).mockResolvedValue(new Uint8Array([1, 2, 3]));
    render(<ProjectsPage />);
    fireEvent.click(screen.getByRole('button', { name: /First/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('recognized OP-XY project header');
  });
});

describe('ProjectsPage — counts that have to read as English', () => {
  beforeEach(() => vi.clearAllMocks());

  function xyWith(paths: string[]) {
    const parts: number[] = [0xdd, 0xcc, 0xbb, 0xaa, 0, 0, 0, 0];
    for (const path of paths) {
      for (const code of new TextEncoder().encode(path)) parts.push(code);
      parts.push(0);
      for (let pad = 0; pad < 8; pad++) parts.push(0);
    }
    return new Uint8Array(parts);
  }

  it('says "1 unresolved reference", not "1 unresolved references"', async () => {
    // Exactly one unresolved reference is the ordinary case, and the plural made the
    // inspector look broken rather than the project look incomplete.
    state.tauriPresets = [];
    state.tauriSamples = [];
    vi.mocked(mtpReadFile).mockResolvedValue(xyWith(['/fat32/samples/user/missing vocal.wav']));
    render(<ProjectsPage />);
    fireEvent.click(screen.getByRole('button', { name: /First/ }));

    expect(await screen.findByText('unresolved reference')).toBeInTheDocument();
    expect(screen.getByText('unique reference')).toBeInTheDocument();
    expect(screen.queryByText('unresolved references')).toBeNull();
  });

  it('uses the plural when there is more than one', async () => {
    state.tauriPresets = [];
    state.tauriSamples = [];
    vi.mocked(mtpReadFile).mockResolvedValue(xyWith([
      '/fat32/samples/user/missing one.wav',
      '/fat32/samples/user/missing two.wav',
    ]));
    render(<ProjectsPage />);
    fireEvent.click(screen.getByRole('button', { name: /First/ }));

    expect(await screen.findByText('unresolved references')).toBeInTheDocument();
    expect(screen.getByText('unique references')).toBeInTheDocument();
  });
});

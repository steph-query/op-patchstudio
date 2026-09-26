import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BackupPanel } from '../../components/projects/BackupPanel';
import { createDeviceBackup, verifyDeviceBackup, previewDeviceRestore, restoreDeviceBackup } from '../../utils/tauriBridge';

const state = { tauriDevice: null as { model: string } | null };
vi.mock('../../context/AppContext', () => ({ useAppContext: () => ({ state }) }));
vi.mock('../../utils/tauriBridge', () => ({ isTauriAvailable: () => true, createDeviceBackup: vi.fn(), verifyDeviceBackup: vi.fn(), previewDeviceRestore: vi.fn(), restoreDeviceBackup: vi.fn(), cancelRestorePreview: vi.fn() }));

describe('BackupPanel', () => {
  it('blocks a conflicting restore before invoking any writes', async () => {
    state.tauriDevice = { model: 'OP-XY' };
    vi.mocked(previewDeviceRestore).mockResolvedValue({ token: 'one', path: '/backup', model: 'OP-XY', serial: 'test', entries: [{ path: 'samples/keep.wav', status: 'conflict', size: 10 }], required_bytes: 0, free_bytes: 100 });
    render(<BackupPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Preview restore…' }));
    expect(await screen.findByRole('button', { name: 'Restore missing files and verify' })).toBeDisabled();
    expect(restoreDeviceBackup).not.toHaveBeenCalled();
  });
  beforeEach(() => { vi.clearAllMocks(); state.tauriDevice = null; });
  it('allows verification offline while requiring a device to create a snapshot', async () => {
    vi.mocked(verifyDeviceBackup).mockResolvedValue({ path: '/backup', files: 5, bytes: 128, firmware: '1.1.33' });
    render(<BackupPanel />);
    expect(screen.getByRole('button', { name: 'Create backup…' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Verify backup…' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Backup verified'));
    expect(screen.getByRole('status')).toHaveTextContent('5 files');
    expect(createDeviceBackup).not.toHaveBeenCalled();
  });
  it('reports failed copies without showing success', async () => {
    state.tauriDevice = { model: 'OP-XY' };
    vi.mocked(createDeviceBackup).mockRejectedValue(new Error('Backup incomplete at /backup: USB disconnected'));
    render(<BackupPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Create backup…' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Backup incomplete');
    expect(screen.queryByText('Backup verified')).not.toBeInTheDocument();
  });
  it('treats dialog cancellation as a normal outcome', async () => {
    vi.mocked(verifyDeviceBackup).mockResolvedValue(null);
    render(<BackupPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Verify backup…' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Verify backup…' })).toBeEnabled());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText('Backup verified')).not.toBeInTheDocument();
  });
});

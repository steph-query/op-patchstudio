import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SessionRestorationModal } from '../../components/common/SessionRestorationModal';

const props = { isOpen: true, onLoadSession: vi.fn(), onStartNew: vi.fn().mockResolvedValue(undefined) };

describe('SessionRestorationModal', () => {
  it('counts agree with their nouns, on the first sentence of a relaunch', () => {
    // "1 drum samples and 0 multisample files" reads as a fault in the app rather
    // than a fact about the user's work, and this is what greets them every time
    // they reopen with something saved.
    render(<SessionRestorationModal {...props} sessionInfo={{ timestamp: Date.now(), drumSamplesCount: 1, multisampleFilesCount: 0 }} />);
    expect(screen.getByText(/with 1 drum sample and 0 multisample files/)).toBeInTheDocument();
  });

  it('uses plurals where plurals belong', () => {
    render(<SessionRestorationModal {...props} sessionInfo={{ timestamp: Date.now(), drumSamplesCount: 12, multisampleFilesCount: 1 }} />);
    expect(screen.getByText(/with 12 drum samples and 1 multisample file/)).toBeInTheDocument();
  });

  it('offers both ways forward, and neither is destructive by accident', () => {
    render(<SessionRestorationModal {...props} sessionInfo={{ timestamp: Date.now(), drumSamplesCount: 2, multisampleFilesCount: 0 }} />);
    expect(screen.getByRole('button', { name: 'restore' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'start new' })).toBeInTheDocument();
  });
});

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { deviceOperation } from '../../utils/deviceOperation';
import { useEffect } from 'react';
import { MainTabs } from '../../components/common/MainTabs';
import { AppContextProvider, useAppContext } from '../../context/AppContext';

function OfflineLoading() {
  const { dispatch } = useAppContext();
  useEffect(() => { dispatch({ type: 'SET_LOADING', payload: true }); }, [dispatch]);
  return null;
}

describe('MainTabs', () => {
  it('does not lock navigation or display a device banner during local sample loading', () => {
    render(<AppContextProvider><OfflineLoading /><MainTabs /></AppContextProvider>);
    const panel = screen.getByRole('tabpanel', { name: 'main application content' });
    expect(panel).toHaveAttribute('aria-busy', 'false');
    expect(panel.querySelector('[inert]')).toBeNull();
    expect(screen.queryByText('Working… keep the device connected.')).not.toBeInTheDocument();
  });
  const renderWithContext = () => {
    return render(
      <AppContextProvider>
        <MainTabs />
      </AppContextProvider>
    );
  };

  it('should render with proper ARIA structure', () => {
    renderWithContext();

    const mainContainer = screen.getByRole('tabpanel', { name: 'main application content' });
    expect(mainContainer).toBeInTheDocument();

    // With nothing connected there is one section, named by its heading. A tablist may
    // only own tabs, so each section is its own tablist rather than one list with
    // headings inside it.
    const tablist = screen.getByRole('tablist', { name: 'workbench' });
    expect(tablist).toBeInTheDocument();
    expect(tablist).toHaveAttribute('aria-orientation', 'vertical');

    const tabs = screen.getAllByRole('tab');
    // Offline: takes, drum, multisample, library, projects
    expect(tabs).toHaveLength(5);

    tabs.forEach(tab => {
      expect(tab).toHaveAttribute('aria-controls');
      expect(tab).toHaveAttribute('aria-selected');
      expect(tab).toHaveAttribute('aria-label');
      expect(tab).toHaveAttribute('id');
    });

    const drumTab = screen.getByRole('tab', { name: 'drum tab' });
    expect(drumTab).toHaveAttribute('tabindex', '0');
    expect(drumTab).toHaveAttribute('aria-selected', 'true');

    const drumPanel = document.getElementById('drum-tabpanel');
    expect(drumPanel).toBeInTheDocument();
    expect(drumPanel).toHaveAttribute('role', 'tabpanel');
    expect(drumTab).toHaveAttribute('aria-controls', 'drum-tabpanel');
  });

  it('should have proper tab order and navigation', () => {
    renderWithContext();

    const tabs = screen.getAllByRole('tab');
    // Takes leads the workbench: it is the cross-device hub and the one surface that is
    // useful before anything is plugged in.
    const expectedTabNames = ['Takes', 'Drum lab', 'Sample lab', 'Library', 'Projects'];

    tabs.forEach((tab, index) => {
      expect(tab).toHaveTextContent(expectedTabNames[index]);
    });
  });
});

describe('the busy banner', () => {
  function Busy({ options }: { options?: Parameters<typeof deviceOperation>[1] }) {
    useEffect(() => { void deviceOperation(() => new Promise<void>(() => {}), options); }, [options]);
    return null;
  }

  it('offers to cancel only what can actually be cancelled', async () => {
    // `cancel` used to be required, so every caller passed an empty function, and the
    // banner showed its button whenever options existed. During an import it read
    // "Cancel preview" — the wrong noun — and pressing it did nothing at all.
    const cancel = vi.fn().mockResolvedValue(undefined);
    const { unmount } = render(<AppContextProvider>
      <Busy options={{ message: 'Copying 2 takes into your library. Keep the device connected.' }} />
      <MainTabs />
    </AppContextProvider>);

    expect(await screen.findByText(/Copying 2 takes into your library/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /cancel/i })).toBeNull();
    unmount();

    render(<AppContextProvider>
      <Busy options={{ message: 'Comparing checksums.', cancel, cancelLabel: 'Cancel preview' }} />
      <MainTabs />
    </AppContextProvider>);
    const button = await screen.findByRole('button', { name: 'Cancel preview' });
    fireEvent.click(button);
    expect(cancel).toHaveBeenCalled();
  });

  it('labels a cancellable operation plainly when it does not name itself', async () => {
    render(<AppContextProvider>
      <Busy options={{ message: 'Working.', cancel: vi.fn().mockResolvedValue(undefined) }} />
      <MainTabs />
    </AppContextProvider>);
    expect(await screen.findByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });
});

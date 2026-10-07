import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TabNavigation } from '../../components/common/TabNavigation';
import { AppContextProvider } from '../../context/AppContext';

const renderWithContext = (props: { currentTab: string; onTabChange: ReturnType<typeof vi.fn> }) => {
  return render(
    <AppContextProvider>
      <TabNavigation currentTab={props.currentTab as 'drum'} onTabChange={props.onTabChange} />
    </AppContextProvider>
  );
};

describe('TabNavigation', () => {
  const mockOnTabChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render all tabs with proper ARIA attributes', () => {
    renderWithContext({ currentTab: 'drum', onTabChange: mockOnTabChange });

    // Disconnected there is only the workbench section; it is labelled by its heading.
    const tablist = screen.getByRole('tablist', { name: 'workbench' });
    expect(tablist).toHaveAttribute('aria-orientation', 'vertical');

    const tabs = screen.getAllByRole('tab');
    // Offline: songs, takes, drum, multisample, library, projects
    expect(tabs).toHaveLength(6);

    tabs.forEach(tab => {
      expect(tab).toHaveAttribute('aria-selected');
      expect(tab).toHaveAttribute('aria-controls');
      expect(tab).toHaveAttribute('aria-label');
      expect(tab).toHaveAttribute('id');
    });

    const drumTab = screen.getByRole('tab', { name: 'drum tab' });
    expect(drumTab).toHaveAttribute('aria-selected', 'true');
    expect(drumTab).toHaveAttribute('tabindex', '0');
  });

  it('should handle tab clicks', () => {
    renderWithContext({ currentTab: 'drum', onTabChange: mockOnTabChange });

    const multisampleTab = screen.getByRole('tab', { name: 'multisample tab' });
    fireEvent.click(multisampleTab);

    expect(mockOnTabChange).toHaveBeenCalledWith('multisample');
  });

  it('should handle keyboard navigation with arrow keys', () => {
    renderWithContext({ currentTab: 'drum', onTabChange: mockOnTabChange });

    const drumTab = screen.getByRole('tab', { name: 'drum tab' });

    // Down/Right both move on: the list is vertical now, and the horizontal pair still
    // works for anyone who learned it when this was a strip across the top.
    fireEvent.keyDown(drumTab, { key: 'ArrowDown' });
    expect(mockOnTabChange).toHaveBeenCalledWith('multisample');

    vi.clearAllMocks();
    fireEvent.keyDown(drumTab, { key: 'ArrowRight' });
    expect(mockOnTabChange).toHaveBeenCalledWith('multisample');

    vi.clearAllMocks();

    // Up from drum reaches takes, which leads the workbench section.
    fireEvent.keyDown(drumTab, { key: 'ArrowUp' });
    expect(mockOnTabChange).toHaveBeenCalledWith('takes');
  });

  it('should handle Home and End key navigation', () => {
    renderWithContext({ currentTab: 'multisample', onTabChange: mockOnTabChange });

    const multisampleTab = screen.getByRole('tab', { name: 'multisample tab' });

    fireEvent.keyDown(multisampleTab, { key: 'Home' });
    expect(mockOnTabChange).toHaveBeenCalledWith('songs');

    vi.clearAllMocks();

    fireEvent.keyDown(multisampleTab, { key: 'End' });
    expect(mockOnTabChange).toHaveBeenCalledWith('projects');
  });

  it('should handle Enter and Space key activation', () => {
    renderWithContext({ currentTab: 'drum', onTabChange: mockOnTabChange });

    const multisampleTab = screen.getByRole('tab', { name: 'multisample tab' });

    fireEvent.keyDown(multisampleTab, { key: 'Enter' });
    expect(mockOnTabChange).toHaveBeenCalledWith('multisample');

    vi.clearAllMocks();

    fireEvent.keyDown(multisampleTab, { key: ' ' });
    expect(mockOnTabChange).toHaveBeenCalledWith('multisample');
  });

  it('uses the shared studio tab style for consistent touch targets', () => {
    renderWithContext({ currentTab: 'drum', onTabChange: mockOnTabChange });

    const tabs = screen.getAllByRole('tab');
    tabs.forEach(tab => {
      expect(tab).toHaveClass('studio-tab');
    });
  });
});

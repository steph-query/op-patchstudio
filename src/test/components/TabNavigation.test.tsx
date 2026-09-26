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

    const tablist = screen.getByRole('tablist');
    expect(tablist).toHaveAttribute('aria-label', 'main navigation tabs');
    expect(tablist).toHaveAttribute('aria-orientation', 'horizontal');

    const tabs = screen.getAllByRole('tab');
    // Offline: drum, multisample, takes, library, projects
    expect(tabs).toHaveLength(5);

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

    fireEvent.keyDown(drumTab, { key: 'ArrowRight' });
    expect(mockOnTabChange).toHaveBeenCalledWith('multisample');

    vi.clearAllMocks();

    // Left from drum wraps to projects (last tab when disconnected)
    fireEvent.keyDown(drumTab, { key: 'ArrowLeft' });
    expect(mockOnTabChange).toHaveBeenCalledWith('projects');
  });

  it('should handle Home and End key navigation', () => {
    renderWithContext({ currentTab: 'multisample', onTabChange: mockOnTabChange });

    const multisampleTab = screen.getByRole('tab', { name: 'multisample tab' });

    fireEvent.keyDown(multisampleTab, { key: 'Home' });
    expect(mockOnTabChange).toHaveBeenCalledWith('drum');

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

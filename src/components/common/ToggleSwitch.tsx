interface ToggleSwitchProps {
  leftLabel: string;
  rightLabel: string;
  isRight: boolean;
  onToggle: () => void;
  disabled?: boolean;
}

export function ToggleSwitch({ 
  leftLabel, 
  rightLabel, 
  isRight, 
  onToggle, 
  disabled = false
}: ToggleSwitchProps) {
  // Exact match to amp/filter toggle for md size
  const knobLeft = isRight ? 19 : 3;

  // Colors to match amp/filter toggle
  const activeColor = '#000';
  const inactiveColor = '#999';
  const pillBg = '#393939';
  const knobBg = '#fff';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
      <span style={{ 
        fontSize: '0.875rem', 
        fontWeight: 400,
        color: !isRight ? activeColor : inactiveColor,
        userSelect: 'none',
        letterSpacing: 0
      }}>
        {leftLabel}
      </span>
      {/* A real control, not a styled div.
          This was a `<div onClick>` with no role, tabIndex or key handler: unreachable by
          Tab, not announced as interactive, and impossible to activate from the keyboard.
          It sets the export audio format (wav/aiff) and the MIDI note mapping (c3/c4) —
          two settings a keyboard user simply could not change. `role="switch"` with
          `aria-checked` is what this shape already was; the button's own defaults are
          reset so nothing moves. */}
      <button
        type="button"
        role="switch"
        aria-checked={isRight}
        aria-label={`${leftLabel} or ${rightLabel}`}
        disabled={disabled}
        onClick={disabled ? undefined : onToggle}
        style={{
          width: '32px',
          height: '16px',
          backgroundColor: pillBg,
          borderRadius: '8px',
          position: 'relative',
          cursor: disabled ? 'default' : 'pointer',
          transition: 'all 0.2s ease',
          opacity: disabled ? 0.5 : 1,
          padding: 0,
          border: 0,
          margin: 0,
          appearance: 'none',
          font: 'inherit',
          flex: 'none'
        }}
      >
        <div
          style={{
            width: '10px',
            height: '10px',
            backgroundColor: knobBg,
            borderRadius: '50%',
            position: 'absolute',
            top: '3px',
            left: `${knobLeft}px`,
            transition: 'left 0.2s ease',
            boxShadow: '0 1px 3px rgba(0, 0, 0, 0.3)'
          }}
        />
      </button>
      <span style={{ 
        fontSize: '0.875rem', 
        fontWeight: 400,
        color: isRight ? activeColor : inactiveColor,
        userSelect: 'none',
        letterSpacing: 0
      }}>
        {rightLabel}
      </span>
    </div>
  );
} 
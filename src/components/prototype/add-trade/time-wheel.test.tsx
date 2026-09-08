/**
 * What jsdom can actually prove about the time wheel.
 *
 * There is no layout here, so dragging and the mouse wheel — both of which are
 * measured in pixels against a real row height — are verified in a browser
 * rather than pretended at with fake rects. What IS provable without layout is
 * the part a screen reader and a keyboard see: the spinbutton contract, the
 * step behaviour, the boundaries that must not wrap, and the parse that must
 * never quietly turn `25:70` into a real time.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import {
  formatWheelTime,
  parseTypedTime,
  parseWheelTime,
  TimeWheels,
  type TimeWheelValue,
} from './time-wheel';

function Harness({ initial }: { initial: TimeWheelValue }) {
  const [value, setValue] = useState(initial);
  return <TimeWheels value={value} onChange={setValue} />;
}

const hour = () => screen.getByRole('spinbutton', { name: 'Hour' });
const minute = () => screen.getByRole('spinbutton', { name: 'Minute' });

describe('TimeWheels', () => {
  describe('the accessible contract', () => {
    it('exposes exactly two spinbuttons, not sixty options', () => {
      render(<Harness initial={{ hour: 14, minute: 32 }} />);
      expect(screen.getAllByRole('spinbutton')).toHaveLength(2);
      expect(screen.queryAllByRole('option')).toHaveLength(0);
    });

    it('states each range and the padded current value', () => {
      render(<Harness initial={{ hour: 9, minute: 5 }} />);
      expect(hour()).toHaveAttribute('aria-valuenow', '9');
      expect(hour()).toHaveAttribute('aria-valuemin', '0');
      expect(hour()).toHaveAttribute('aria-valuemax', '23');
      expect(hour()).toHaveAttribute('aria-valuetext', '09');
      expect(minute()).toHaveAttribute('aria-valuemin', '0');
      expect(minute()).toHaveAttribute('aria-valuemax', '59');
      expect(minute()).toHaveAttribute('aria-valuetext', '05');
    });

    it('keeps both columns reachable by keyboard', () => {
      render(<Harness initial={{ hour: 14, minute: 32 }} />);
      expect(hour()).toHaveAttribute('tabindex', '0');
      expect(minute()).toHaveAttribute('tabindex', '0');
    });
  });

  describe('keyboard stepping', () => {
    it('moves one value at a time in each direction', () => {
      render(<Harness initial={{ hour: 14, minute: 32 }} />);
      fireEvent.keyDown(hour(), { key: 'ArrowUp' });
      expect(hour()).toHaveAttribute('aria-valuetext', '15');
      fireEvent.keyDown(hour(), { key: 'ArrowDown' });
      fireEvent.keyDown(hour(), { key: 'ArrowDown' });
      expect(hour()).toHaveAttribute('aria-valuetext', '13');
    });

    it('jumps to the ends with Home and End', () => {
      render(<Harness initial={{ hour: 14, minute: 32 }} />);
      fireEvent.keyDown(hour(), { key: 'Home' });
      expect(hour()).toHaveAttribute('aria-valuetext', '00');
      fireEvent.keyDown(hour(), { key: 'End' });
      expect(hour()).toHaveAttribute('aria-valuetext', '23');
      fireEvent.keyDown(minute(), { key: 'End' });
      expect(minute()).toHaveAttribute('aria-valuetext', '59');
    });

    it('moves five at a time with Page Up and Page Down', () => {
      render(<Harness initial={{ hour: 14, minute: 32 }} />);
      fireEvent.keyDown(minute(), { key: 'PageUp' });
      expect(minute()).toHaveAttribute('aria-valuetext', '37');
      fireEvent.keyDown(minute(), { key: 'PageDown' });
      fireEvent.keyDown(minute(), { key: 'PageDown' });
      expect(minute()).toHaveAttribute('aria-valuetext', '27');
    });

    it('changes one column without disturbing the other', () => {
      render(<Harness initial={{ hour: 14, minute: 32 }} />);
      fireEvent.keyDown(hour(), { key: 'ArrowUp' });
      expect(minute()).toHaveAttribute('aria-valuetext', '32');
      fireEvent.keyDown(minute(), { key: 'ArrowDown' });
      expect(hour()).toHaveAttribute('aria-valuetext', '15');
    });
  });

  describe('the ends of the range do not wrap', () => {
    it('stops at hour 00 and hour 23', () => {
      render(<Harness initial={{ hour: 0, minute: 30 }} />);
      fireEvent.keyDown(hour(), { key: 'ArrowDown' });
      expect(hour()).toHaveAttribute('aria-valuetext', '00');
      fireEvent.keyDown(hour(), { key: 'PageDown' });
      expect(hour()).toHaveAttribute('aria-valuetext', '00');

      fireEvent.keyDown(hour(), { key: 'End' });
      fireEvent.keyDown(hour(), { key: 'ArrowUp' });
      expect(hour()).toHaveAttribute('aria-valuetext', '23');
    });

    it('stops at minute 59 without carrying into the hour', () => {
      render(<Harness initial={{ hour: 14, minute: 59 }} />);
      fireEvent.keyDown(minute(), { key: 'ArrowUp' });
      expect(minute()).toHaveAttribute('aria-valuetext', '59');
      expect(hour()).toHaveAttribute('aria-valuetext', '14');
    });

    it('stops at minute 00 without borrowing from the hour', () => {
      render(<Harness initial={{ hour: 14, minute: 0 }} />);
      fireEvent.keyDown(minute(), { key: 'ArrowDown' });
      expect(minute()).toHaveAttribute('aria-valuetext', '00');
      expect(hour()).toHaveAttribute('aria-valuetext', '14');
    });

    it('draws empty space where an unavailable neighbour would be', () => {
      const { container } = render(<Harness initial={{ hour: 0, minute: 30 }} />);
      // 00 is the first hour, so the two rows above it have no value to show.
      const hourRows = [...(hour().querySelector('div')?.children ?? [])].map((row) =>
        (row.textContent ?? '').trim(),
      );
      expect(hourRows).toEqual(['', '', '00', '01', '02']);
      expect(container).toBeTruthy();
    });
  });

  describe('pointing', () => {
    /*
      WHICH neighbour a tap selects is decided from the pointer's position
      against the column's own rect, so it cannot be asserted here: jsdom
      reports every rect as zero and the assertion would be measuring the stub
      rather than the control. That behaviour — tap the row above, tap the row
      below, drag three rows — is verified against a real layout in a browser.

      What IS provable here is the part that is structural rather than
      geometric: the centre is not secretly an input, so pointing at it can
      never summon a phone keyboard.
    */
    it('never renders a text field inside the wheel', () => {
      render(<Harness initial={{ hour: 14, minute: 32 }} />);
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
      expect(screen.queryByRole('spinbutton', { name: 'Hour' })?.tagName).toBe('DIV');
    });

    it('draws the neighbours a tap can reach', () => {
      render(<Harness initial={{ hour: 14, minute: 32 }} />);
      const hourRows = [...(hour().querySelector('div')?.children ?? [])].map((row) =>
        (row.textContent ?? '').trim(),
      );
      expect(hourRows).toEqual(['12', '13', '14', '15', '16']);
    });
  });
});

describe('parseTypedTime', () => {
  it.each([
    ['00:00', { hour: 0, minute: 0 }],
    ['09:05', { hour: 9, minute: 5 }],
    ['9:05', { hour: 9, minute: 5 }],
    ['14:32', { hour: 14, minute: 32 }],
    ['23:59', { hour: 23, minute: 59 }],
  ])('accepts %s', (raw, expected) => {
    expect(parseTypedTime(raw)).toEqual(expected);
  });

  it.each(['25:70', '24:00', '23:60', '-1:00', '1432', '14:', ':32', '', 'now', '14:32:00'])(
    'refuses %s rather than clamping it',
    (raw) => {
      expect(parseTypedTime(raw)).toBeNull();
    },
  );

  it('never rewrites an out-of-range time into a valid one', () => {
    // The failure this guards: 25:70 quietly becoming 23:59, which is a
    // timestamp the reader never chose and cannot see was substituted.
    expect(parseTypedTime('25:70')).toBeNull();
  });
});

describe('formatWheelTime and parseWheelTime', () => {
  it('pads both halves on the way out', () => {
    expect(formatWheelTime({ hour: 9, minute: 5 })).toBe('09:05');
    expect(formatWheelTime({ hour: 0, minute: 0 })).toBe('00:00');
  });

  it('round-trips a committed value', () => {
    expect(formatWheelTime(parseWheelTime('14:32'))).toBe('14:32');
  });

  it('falls back to 09:00 for a missing or unusable value', () => {
    expect(parseWheelTime(undefined)).toEqual({ hour: 9, minute: 0 });
    expect(parseWheelTime('25:70')).toEqual({ hour: 9, minute: 0 });
  });
});

/**
 * WHAT THE FULLY CLOSED SCREEN MAY AND MAY NOT PUT IN FRONT OF A TRADER.
 *
 * The semantics are proved in `closed-trade.test.ts`; this file proves the
 * screen is actually wired to them. Both halves are needed, and the split is
 * deliberate: a model that refuses to invent a zero is worth nothing if the form
 * above it still opens with 400.00 in the amount field, and the previous version
 * of this screen did exactly that while its arithmetic was perfectly correct.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';

import en from '../../../../messages/en.json';
import { AfterTradeForm } from './after-trade-form';

/* The shared timestamp picker renders the product's own `ToolbarDisclosure`,
   which reads translated control labels. The prototype route sits inside the
   locale layout that provides them; a bare `render` does not. */
function show(props: Parameters<typeof AfterTradeForm>[0] = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <AfterTradeForm {...props} />
    </NextIntlClientProvider>,
  );
}

function openBlank() {
  show();
}

/** Fills only what a Fully closed record actually requires. */
function identify() {
  fireEvent.change(screen.getByLabelText('Symbol'), { target: { value: 'XAUUSD' } });
  fireEvent.click(screen.getByRole('radio', { name: 'Long' }));
}

const saveButton = () => screen.getByRole('button', { name: 'Save closed trade' });

describe('a historical form opens knowing nothing', () => {
  it('leaves both timestamps unrecorded rather than defaulting to now', () => {
    openBlank();
    expect(screen.getByRole('button', { name: 'Entry time' })).toHaveTextContent('Not set');
    expect(screen.getByRole('button', { name: 'Final exit time' })).toHaveTextContent('Not set');
  });

  it('keeps the final exit time askable even with no exit history', () => {
    // It was a read-only line derived from the latest recorded leg. A trade can
    // have a known closing time and no recorded legs at all.
    openBlank();
    expect(screen.getByRole('button', { name: 'Final exit time' })).toBeEnabled();
  });

  it('pre-selects no outcome and shows no amount at all', () => {
    openBlank();
    for (const label of ['Profit', 'Loss', 'Break-even']) {
      expect(screen.getByRole('radio', { name: label })).not.toBeChecked();
    }
    expect(screen.queryByLabelText('Final net profit')).toBeNull();
    expect(screen.queryByLabelText('Final net loss')).toBeNull();
    expect(screen.queryByText(/0\.00 USD/)).toBeNull();
  });

  it('starts the symbol, direction and plan baseline empty', () => {
    openBlank();
    expect(screen.getByLabelText('Symbol')).toHaveValue('');
    expect(screen.getByRole('radio', { name: 'Long' })).not.toBeChecked();
    expect(screen.getByLabelText('Risk at entry')).toHaveValue('');
    expect(screen.getByLabelText('Target profit')).toHaveValue('');
  });

  it('prints no R figure before there is anything to derive one from', () => {
    openBlank();
    expect(screen.queryByText(/R$/)).toBeNull();
    expect(screen.queryByText(/0\.00R/)).toBeNull();
  });
});

describe('saving a partly remembered trade', () => {
  it('refuses only while the identity is missing', () => {
    openBlank();
    expect(saveButton()).toBeDisabled();
    identify();
    expect(saveButton()).toBeEnabled();
  });

  it('does not tell the trader off before they have touched anything', () => {
    // The refusal is in the control. The reasons wait until there is something
    // the trader could have got wrong — an untouched form has nothing.
    openBlank();
    expect(saveButton()).toBeDisabled();
    expect(screen.queryByText('Enter the symbol you traded.')).toBeNull();
    expect(screen.queryByText('Choose Long or Short.')).toBeNull();

    fireEvent.change(screen.getByLabelText('Symbol'), { target: { value: 'XAUUSD' } });
    expect(screen.getByText('Choose Long or Short.')).toBeInTheDocument();
  });

  it('saves with no time, no risk, no target, no result and no journal', () => {
    openBlank();
    identify();
    expect(saveButton()).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Entry time' })).toHaveTextContent('Not set');
    expect(screen.queryByText(/Actual R/)).toBeNull();
  });

  it('states what blocks a save, and never states what is merely unrecorded', () => {
    openBlank();
    identify();
    fireEvent.change(screen.getByLabelText('Risk at entry'), { target: { value: '0' } });
    expect(saveButton()).toBeDisabled();
    expect(screen.getAllByText(/Risk at entry must be above zero/).length).toBeGreaterThan(0);
  });
});

describe('the result is the trade’s, and R follows from it', () => {
  it('derives Actual R from the final result over the risk at entry', () => {
    openBlank();
    identify();
    fireEvent.change(screen.getByLabelText('Risk at entry'), { target: { value: '200' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Profit' }));
    fireEvent.change(screen.getByLabelText('Final net profit'), { target: { value: '400' } });

    expect(screen.getByText('Actual R')).toBeInTheDocument();
    expect(screen.getByText('+2.00R')).toBeInTheDocument();
  });

  it('re-derives it when the historical risk is corrected afterwards', () => {
    openBlank();
    identify();
    fireEvent.change(screen.getByLabelText('Risk at entry'), { target: { value: '200' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Profit' }));
    fireEvent.change(screen.getByLabelText('Final net profit'), { target: { value: '400' } });
    expect(screen.getByText('+2.00R')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Risk at entry'), { target: { value: '100' } });
    expect(screen.getByText('+4.00R')).toBeInTheDocument();
    expect(screen.queryByText('+2.00R')).toBeNull();
  });

  it('says R is unavailable rather than printing 0R when the risk is unknown', () => {
    openBlank();
    identify();
    fireEvent.click(screen.getByRole('radio', { name: 'Profit' }));
    fireEvent.change(screen.getByLabelText('Final net profit'), { target: { value: '400' } });

    expect(screen.queryByText(/0\.00R/)).toBeNull();
    expect(screen.getByText('Actual R needs your risk at entry.')).toBeInTheDocument();
  });

  it('shows Target R only once both halves of the plan exist', () => {
    openBlank();
    identify();
    fireEvent.change(screen.getByLabelText('Target profit'), { target: { value: '1000' } });
    expect(screen.queryByText(/Target R/)).toBeNull();

    fireEvent.change(screen.getByLabelText('Risk at entry'), { target: { value: '200' } });
    expect(screen.getByText('Target R')).toBeInTheDocument();
    expect(screen.getByText('+5.00R')).toBeInTheDocument();
  });

  it('keeps No fixed target as an answer distinct from a blank one', () => {
    openBlank();
    identify();
    fireEvent.change(screen.getByLabelText('Risk at entry'), { target: { value: '200' } });
    fireEvent.change(screen.getByLabelText('Target profit'), { target: { value: '1000' } });
    expect(screen.getByText('+5.00R')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'No fixed target' }));
    expect(screen.getByText('No fixed target')).toBeInTheDocument();
    expect(screen.queryByText(/Target R/)).toBeNull();
    expect(screen.queryByText('+5.00R')).toBeNull();
  });

  it('records break-even as a stated zero, not as a typed one', () => {
    openBlank();
    identify();
    fireEvent.click(screen.getByRole('radio', { name: 'Break-even' }));
    expect(screen.getByText('0.00 USD')).toBeInTheDocument();
    expect(screen.queryByLabelText('Final net profit')).toBeNull();
  });
});

describe('exit details are a disclosure, never a second mode', () => {
  it('stays collapsed, with no empty exit form standing open', () => {
    openBlank();
    expect(screen.getByRole('button', { name: /Add exit details/ })).toBeInTheDocument();
    expect(screen.getByText('If you closed in parts.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Record an exit' })).toBeNull();
    expect(screen.queryByText('Exits')).toBeNull();
  });

  it('keeps the whole-trade result present and authoritative once opened', () => {
    openBlank();
    identify();
    fireEvent.click(screen.getByRole('radio', { name: 'Profit' }));
    fireEvent.change(screen.getByLabelText('Final net profit'), { target: { value: '400' } });
    fireEvent.click(screen.getByRole('button', { name: /Add exit details/ }));

    // The field that carries the trade's result is still there. The previous
    // version removed it and let the reconstructed legs become the money.
    expect(screen.getByLabelText('Final net profit')).toHaveValue('400');
    expect(screen.getByRole('button', { name: 'Record an exit' })).toBeInTheDocument();
  });

  it('totals nothing until a leg has been recorded', () => {
    openBlank();
    fireEvent.click(screen.getByRole('button', { name: /Add exit details/ }));
    expect(screen.queryByText('Recorded exits subtotal')).toBeNull();
    expect(screen.queryByText(/\+0\.00 USD/)).toBeNull();
  });

  it('labels a recorded history as a subtotal beside the trade’s own result', () => {
    show({ filled: true, exits: true });
    // Seeded: a +400.00 whole-trade result, and legs of −40.00 and +120.00.
    expect(screen.getByLabelText('Final net profit')).toHaveValue('400.00');
    expect(screen.getByText('Recorded exits subtotal')).toBeInTheDocument();
    expect(screen.getByText('+80.00 USD')).toBeInTheDocument();
    expect(screen.getByText(/Your final result stays \+400\.00 USD/)).toBeInTheDocument();
    // 480 is the sum nobody may produce.
    expect(screen.queryByText(/480/)).toBeNull();
  });
});

describe('journal and review', () => {
  it('offers both journal areas as invitations, and neither as a task', () => {
    openBlank();
    expect(screen.getByText('Journal at entry')).toBeInTheDocument();
    expect(screen.getByText('Trade idea')).toBeInTheDocument();
    expect(screen.getByText('Why did you take this trade?')).toBeInTheDocument();
    expect(screen.getByText('Feelings at entry')).toBeInTheDocument();
  });

  it('keeps Review separate, holding Reflection', () => {
    openBlank();
    expect(screen.getByText('Review')).toBeInTheDocument();
    expect(screen.getByText('Reflection')).toBeInTheDocument();
    expect(screen.getByText('What would you repeat or change next time?')).toBeInTheDocument();
  });

  it('does not duplicate the plan baseline inside the journal', () => {
    // Target, risk and the exit plan belong to Plan at entry. The old journal
    // asked "What was your plan?" and collected them a second time.
    openBlank();
    expect(screen.queryByText('What was your plan?')).toBeNull();
    expect(screen.getAllByText('Risk at entry')).toHaveLength(1);
    expect(screen.getAllByText('Exit plan')).toHaveLength(1);
  });

  it('shows no System assessment anywhere in this pass — including inside Reflection', () => {
    // NOT AN AT-REST CHECK ALONE. The previous Review kept the rule comparison
    // one row deeper, so a surface-only assertion passed while opening the row
    // put "Compare with your rules" and a counterfactual result in front of the
    // trader. The editor is opened here for that reason.
    openBlank();
    fireEvent.click(screen.getByRole('button', { name: /Reflection/ }));

    expect(screen.getByLabelText('In your own words')).toBeInTheDocument();
    expect(screen.queryByText(/System assessment/i)).toBeNull();
    expect(screen.queryByText(/Compare with your rules/i)).toBeNull();
    expect(screen.queryByText(/follow(ed)? your rules/i)).toBeNull();
    expect(screen.queryByText(/would have produced/i)).toBeNull();
    expect(screen.queryByText(/If you followed your rules/i)).toBeNull();
  });

  it('previews a written reflection instead of its invitation', () => {
    show({ filled: true });
    expect(screen.queryByText('What would you repeat or change next time?')).toBeNull();
    expect(
      screen.getByText('Wait for the candle close next time rather than anticipating it.'),
    ).toBeInTheDocument();
  });
});

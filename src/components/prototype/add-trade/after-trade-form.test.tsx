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
import { describe, expect, it, vi } from 'vitest';

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
  it('shows no validation noise on an untouched form', () => {
    openBlank();
    expect(screen.queryByText('Enter the symbol you traded.')).toBeNull();
    expect(screen.queryByText('Choose Long or Short.')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('stays pressable rather than going dead while fields are blank', () => {
    // A disabled Save leaves the keyboard with nothing to reach and says, on a
    // form built around blanks, that blank is a fault.
    openBlank();
    expect(saveButton()).toBeEnabled();
  });

  it('does not complain while the trader is still filling the form in', () => {
    openBlank();
    fireEvent.change(screen.getByLabelText('Symbol'), { target: { value: 'XAUUSD' } });
    // Direction is not yet missing — it is simply not reached.
    expect(screen.queryByText('Choose Long or Short.')).toBeNull();
  });

  it('blocks an attempted save and then names the fields', () => {
    const onSave = vi.fn();
    show({ onSave });

    fireEvent.click(saveButton());
    expect(onSave).not.toHaveBeenCalled();
    // Twice each, deliberately: beside the field to act on, and in the footer
    // summary beside the control that refused.
    expect(screen.getAllByText('Enter the symbol you traded.')).toHaveLength(2);
    expect(screen.getAllByText('Choose Long or Short.')).toHaveLength(2);
    // Each field announces its own problem; the Save button points at the
    // summary, so tabbing back to it explains the refusal.
    expect(screen.getAllByRole('alert')).toHaveLength(2);
    expect(saveButton()).toHaveAttribute('aria-describedby');
  });

  it('saves once the required fields are corrected, however much stays unknown', () => {
    const onSave = vi.fn();
    show({ onSave });

    fireEvent.click(saveButton());
    expect(onSave).not.toHaveBeenCalled();

    identify();
    expect(screen.queryByText('Enter the symbol you traded.')).toBeNull();
    expect(screen.queryByText('Choose Long or Short.')).toBeNull();

    fireEvent.click(saveButton());
    expect(onSave).toHaveBeenCalledTimes(1);
    // Saved with the unknowns still unknown — not zeroed, not dated.
    expect(onSave.mock.calls[0]?.[0]).toMatchObject({
      symbol: 'XAUUSD',
      direction: 'long',
      enteredAt: null,
      exitedAt: null,
      riskAtEntry: '',
      targetProfit: '',
      outcome: null,
      finalAmount: '',
      exits: [],
    });
  });

  it('states a wrong value at once, and refuses the save that follows', () => {
    // A typed-invalid value is not a missing one: the trader has just entered it
    // and should not build on it until Save to find out.
    const onSave = vi.fn();
    show({ onSave });
    identify();
    fireEvent.change(screen.getByLabelText('Risk at entry'), { target: { value: '0' } });

    expect(screen.getByText(/Risk at entry must be above zero/)).toBeInTheDocument();
    fireEvent.click(saveButton());
    expect(onSave).not.toHaveBeenCalled();
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
    expect(screen.getByText('Final result remains +400.00 USD.')).toBeInTheDocument();
    // 480 is the sum nobody may produce.
    expect(screen.queryByText(/480/)).toBeNull();
  });

  it('does not explain a difference it cannot account for', () => {
    /*
      THE SENTENCE THIS TEST EXISTS TO KEEP OUT.

      "The difference is exit history you have not recorded" reads a CAUSE out of
      a subtraction. An unrecorded leg is one explanation; a mistyped leg, a
      mistyped total and costs netted into one figure but not the other are
      others, and nothing on the record distinguishes them. Until the trader says
      exits are missing, the app states two figures and no story.
    */
    show({ filled: true, exits: true });
    expect(screen.queryByText(/exit history you have not recorded/i)).toBeNull();
    expect(screen.queryByText(/The difference is/i)).toBeNull();
    expect(screen.queryByText(/incomplete/i)).toBeNull();
    expect(screen.queryByText(/missing/i)).toBeNull();
  });

  it('repeats the trader’s own claim once they establish exits are missing', () => {
    show({ filled: true, exits: true });
    fireEvent.click(screen.getByRole('button', { name: 'No' }));

    expect(
      screen.getByText('You have said some exits are missing. Final result remains +400.00 USD.'),
    ).toBeInTheDocument();
    // Still never a fabricated leg and never a combined figure.
    expect(screen.getByText('+80.00 USD')).toBeInTheDocument();
    expect(screen.queryByText(/480/)).toBeNull();
  });

  it('claims a reconciliation only when the trader declares the history complete', () => {
    show({ filled: true, exits: true });
    // A +400.00 total against +80.00 of legs, declared complete, is two
    // statements that cannot both be true.
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
    expect(
      screen.getByText('These values don’t match. Review the final result or the recorded exits.'),
    ).toBeInTheDocument();
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

  it('keeps System assessment out of the Reflection editor', () => {
    /*
      SUPERSEDED IN SCOPE, PRESERVED IN INTENT.

      Pass 1 asserted System assessment appeared NOWHERE, which was right while
      it was unbuilt. It exists now, as its own launcher — so what still has to
      hold is the SEPARATION: opening Reflection must present one question about
      what the trader learned, and nothing about what the rules would have
      produced. The old Review editor kept the rule comparison one row deeper
      inside Reflection, which is exactly the conflation this checks against.
    */
    openBlank();
    fireEvent.click(screen.getByRole('button', { name: /Reflection/ }));

    expect(screen.getByLabelText('In your own words')).toBeInTheDocument();
    expect(screen.queryByText('Would your rules have taken this trade?')).toBeNull();
    expect(screen.queryByText('What would have closed the trade?')).toBeNull();
    expect(screen.queryByText('Did you follow your plan?')).toBeNull();
    expect(screen.queryByText(/Compare with your rules/i)).toBeNull();
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

/**
 * PASS 2 ON THE SCREEN — the promotion, and the states around it.
 *
 * The model proves the transitions; these prove the trader can reach them, and
 * that the offer never appears where taking it would be wrong.
 */
describe('promoting a reconstruction into the result', () => {
  /** Opens the exit details on a blank trade and records legs by hand. */
  function recordExits(amounts: readonly string[]) {
    fireEvent.click(screen.getByRole('button', { name: /Add exit details/ }));
    for (const amount of amounts) {
      fireEvent.click(screen.getByRole('button', { name: 'Record an exit' }));
      if (amount !== '') {
        fireEvent.change(screen.getByLabelText('Net profit for this exit'), {
          target: { value: amount },
        });
      }
      fireEvent.click(screen.getByRole('button', { name: 'Add exit' }));
    }
  }

  const declareComplete = () => fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
  const adoptAction = () => screen.queryByRole('button', { name: /as final result/ });

  it('offers nothing until the trader declares the history complete', () => {
    openBlank();
    identify();
    recordExits(['100.00', '300.00']);

    // The legs come to +400 and nobody has said they are all of them.
    expect(screen.getByText('+400.00 USD')).toBeInTheDocument();
    expect(adoptAction()).toBeNull();

    declareComplete();
    expect(adoptAction()).toBeInTheDocument();
    expect(adoptAction()).toHaveTextContent('Use +400.00 USD as final result');
  });

  it('leaves the result unknown while the offer sits there unaccepted', () => {
    const onSave = vi.fn();
    show({ onSave });
    identify();
    recordExits(['100.00', '300.00']);
    declareComplete();

    fireEvent.click(saveButton());
    // Offered is not answered: the trade saves with no result at all.
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0]?.[0]).toMatchObject({
      finalSource: 'manual_total',
      finalAmount: '',
      outcome: null,
    });
  });

  it('makes the reconstruction the result, and says so', () => {
    const onSave = vi.fn();
    show({ onSave });
    identify();
    fireEvent.change(screen.getByLabelText('Risk at entry'), { target: { value: '200' } });
    recordExits(['100.00', '300.00']);
    declareComplete();
    fireEvent.click(adoptAction() as HTMLElement);

    // The figure, its provenance, and an Actual R derived from it.
    expect(screen.getByText('From your recorded exits, which you marked complete.'));
    expect(screen.getByText('Final net profit')).toBeInTheDocument();
    expect(screen.getByText('+2.00R')).toBeInTheDocument();
    // The outcome is no longer a separate choice that could contradict it.
    expect(screen.queryByRole('radio', { name: 'Profit' })).toBeNull();

    fireEvent.click(saveButton());
    expect(onSave.mock.calls[0]?.[0]).toMatchObject({ finalSource: 'exit_history' });
  });

  it('never offers a partial sum as a whole-trade result', () => {
    openBlank();
    identify();
    // The second leg's amount is left blank.
    recordExits(['100.00', '']);
    declareComplete();

    expect(adoptAction()).toBeNull();
    expect(screen.queryByText(/Use \+100\.00 USD as final result/)).toBeNull();
  });

  it('never offers to overwrite a result the trader already stated', () => {
    openBlank();
    identify();
    fireEvent.click(screen.getByRole('radio', { name: 'Profit' }));
    fireEvent.change(screen.getByLabelText('Final net profit'), { target: { value: '9' } });
    recordExits(['100.00', '300.00']);
    declareComplete();

    expect(adoptAction()).toBeNull();
  });

  it('hands an adopted figure back for manual editing, and changes its source', () => {
    const onSave = vi.fn();
    show({ onSave });
    identify();
    recordExits(['100.00', '300.00']);
    declareComplete();
    fireEvent.click(adoptAction() as HTMLElement);

    fireEvent.click(screen.getByRole('button', { name: 'Edit final result' }));
    // Opens on the figure they accepted, in the field that now owns it.
    expect(screen.getByLabelText('Final net profit')).toHaveValue('400.00');
    expect(screen.getByRole('radio', { name: 'Profit' })).toBeChecked();

    fireEvent.click(saveButton());
    expect(onSave.mock.calls[0]?.[0]).toMatchObject({
      finalSource: 'manual_total',
      finalAmount: '400.00',
    });
  });
});

describe('a declared-complete contradiction', () => {
  function conflicted() {
    show({ filled: true, exits: true });
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
  }

  it('shows both figures and names neither as the wrong one', () => {
    conflicted();
    expect(screen.getByText('Final result')).toBeInTheDocument();
    expect(screen.getAllByText('+400.00 USD').length).toBeGreaterThan(0);
    expect(screen.getAllByText('+80.00 USD').length).toBeGreaterThan(0);
    expect(
      screen.getByText('These values don’t match. Review the final result or the recorded exits.'),
    ).toBeInTheDocument();

    // No verdict, and no invented reconciling amount.
    expect(screen.queryByText(/wrong/i)).toBeNull();
    expect(screen.queryByText(/should equal/i)).toBeNull();
    expect(screen.queryByText(/320/)).toBeNull();
    expect(screen.queryByText(/480/)).toBeNull();
  });

  it('offers a route to each of the two things that could be corrected', () => {
    conflicted();
    expect(screen.getByRole('button', { name: 'Edit final result' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Review exits' })).toBeInTheDocument();
  });

  it('blocks the save until one of them is resolved', () => {
    const onSave = vi.fn();
    show({ filled: true, exits: true, onSave });
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }));

    fireEvent.click(saveButton());
    expect(onSave).not.toHaveBeenCalled();
    expect(
      screen.getAllByText(
        'These values don’t match. Review the final result or the recorded exits.',
      ).length,
    ).toBeGreaterThan(0);

    // Withdrawing the completeness claim makes it an ordinary partial history.
    fireEvent.click(screen.getByRole('button', { name: 'No' }));
    fireEvent.click(saveButton());
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('does not block the ordinary incomplete states', () => {
    const onSave = vi.fn();
    show({ filled: true, exits: true, onSave });
    // Unanswered completeness, with figures that plainly differ.
    fireEvent.click(saveButton());
    expect(onSave).toHaveBeenCalledTimes(1);
  });
});

describe('two closing times', () => {
  it('surfaces the disagreement without changing either', () => {
    /*
      The seeded draft closes at 14:32 and its exit legs are partial, so nothing
      is said. Marking the later leg as the one that closed the position creates
      two closing times, and neither may be silently preferred.
    */
    show({ filled: true, exits: true });
    expect(screen.queryByText(/exit that closed the position/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Edit exit 2' }));
    fireEvent.click(screen.getByRole('button', { name: 'All remaining' }));

    expect(
      screen.getByText(/exit that closed the position \(2026-09-01 14:15\)/),
    ).toBeInTheDocument();
    // The trader's own Final exit time is untouched.
    expect(screen.getByRole('button', { name: 'Final exit time' })).toHaveTextContent('14:32');
  });
});

/**
 * SYSTEM ASSESSMENT ON THE SCREEN — the second Review launcher.
 *
 * The semantics are proved in `system-assessment.test.ts`. These prove the
 * trader can reach them, that the short path is genuinely short, and that
 * nothing about the assessment leaks into the trade's own result or into
 * Reflection.
 */
describe('the System assessment launcher', () => {
  const openAssessment = () =>
    fireEvent.click(screen.getByRole('button', { name: /System assessment/ }));
  const done = () => fireEvent.click(screen.getByRole('button', { name: 'Done' }));

  it('sits beside Reflection under Review, and starts as an invitation', () => {
    openBlank();
    expect(screen.getByText('Review')).toBeInTheDocument();
    expect(screen.getByText('Reflection')).toBeInTheDocument();
    expect(screen.getByText('System assessment')).toBeInTheDocument();
    expect(screen.getByText('What would following your rules have produced?')).toBeInTheDocument();
    // Untouched means silent: no badge, no count, no "needs review".
    expect(screen.queryByText('Needs review')).toBeNull();
  });

  it('never blocks the save', () => {
    const onSave = vi.fn();
    show({ onSave });
    identify();
    fireEvent.click(saveButton());
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('opens on one question with three answers', () => {
    openBlank();
    openAssessment();
    expect(screen.getByText('Would your rules have taken this trade?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Yes' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: "No — the setup wasn't valid" })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: "Can't determine" })).toBeInTheDocument();
    // Nothing further is exposed until the first question is answered.
    expect(screen.queryByText('What would have closed the trade?')).toBeNull();
  });

  it('completes as no_trade in one answer, and states what that means', () => {
    openBlank();
    openAssessment();
    fireEvent.click(screen.getByRole('button', { name: "No — the setup wasn't valid" }));

    expect(screen.getByText(/no system result to compare against/)).toBeInTheDocument();
    // No resolution, and emphatically no System R of zero.
    expect(screen.queryByText('What would have closed the trade?')).toBeNull();
    expect(screen.queryByText(/0\.00R/)).toBeNull();

    done();
    expect(screen.getByText('Your rules would not have taken this trade')).toBeInTheDocument();
  });

  it('completes as cannot determine without inventing a figure', () => {
    openBlank();
    openAssessment();
    fireEvent.click(screen.getByRole('button', { name: "Can't determine" }));
    expect(screen.getByText(/Nothing is assumed/)).toBeInTheDocument();
    expect(screen.queryByText(/R$/)).toBeNull();

    done();
    expect(screen.getByText('Can’t determine what the rules would have done')).toBeInTheDocument();
    // Distinct from never having been asked.
    expect(screen.queryByText('What would following your rules have produced?')).toBeNull();
  });

  it('asks for the rule before any magnitude, and never preselects one', () => {
    openBlank();
    openAssessment();
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }));

    expect(screen.getByText('What would have closed the trade?')).toBeInTheDocument();
    expect(
      screen.getByText('The rule that would have fired first — not where price happened to go.'),
    ).toBeInTheDocument();
    for (const label of ['Target hit', 'Stop hit', 'Trailing exit']) {
      expect(screen.getByRole('button', { name: label })).toHaveAttribute('aria-pressed', 'false');
    }
    // No magnitude offered until a rule is named.
    expect(screen.queryByText('Where does the result come from?')).toBeNull();
  });

  it('does not turn a recorded target into a system result on its own', () => {
    // The plan says target 1000 over risk 200 — Target R is +5.00R and visible
    // on the page. It becomes the system result only after two explicit choices.
    show({ filled: true });
    expect(screen.getByText('+5.00R')).toBeInTheDocument();

    openAssessment();
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
    expect(screen.queryByText('System R')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Target hit' }));
    expect(screen.queryByText('System R')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Your recorded target' }));
    expect(screen.getByText(/System R/)).toBeInTheDocument();
  });

  it('keeps an unknown cost unknown, and withholds the comparison', () => {
    show({ filled: true });
    openAssessment();
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
    fireEvent.click(screen.getByRole('button', { name: 'Target hit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Your recorded target' }));

    // The cost field is empty and says so — never a prefilled zero.
    const cost = screen.getByLabelText(/Costs if you followed your rules/);
    expect(cost).toHaveValue('');
    expect(cost).toHaveAttribute('placeholder', 'Unknown');

    expect(screen.getByText('System R (gross)')).toBeInTheDocument();
    expect(
      screen.getByText('Gross only — not compared with your actual result, which is after costs.'),
    ).toBeInTheDocument();
  });

  it('produces a net figure and an outcome once the cost is given', () => {
    show({ filled: true });
    openAssessment();
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
    fireEvent.click(screen.getByRole('button', { name: 'Target hit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Your recorded target' }));
    fireEvent.change(screen.getByLabelText(/Costs if you followed your rules/), {
      target: { value: '0.2' },
    });

    expect(screen.getByText('System R')).toBeInTheDocument();
    expect(screen.getByText('+4.80R')).toBeInTheDocument();
    expect(screen.getByText(/System win/)).toBeInTheDocument();
    expect(
      screen.queryByText(
        'Gross only — not compared with your actual result, which is after costs.',
      ),
    ).toBeNull();
  });

  it('records a system loss the trader followed', () => {
    show({ filled: true });
    openAssessment();
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
    fireEvent.click(screen.getByRole('button', { name: 'Stop hit' }));
    fireEvent.click(screen.getByRole('button', { name: /Your initial stop/ }));
    fireEvent.change(screen.getByLabelText(/Costs if you followed your rules/), {
      target: { value: '0' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Followed' }));
    expect(screen.getByText(/System loss/)).toBeInTheDocument();
    done();

    expect(screen.getByText('System -1.00R')).toBeInTheDocument();
    expect(screen.getByText('Followed your plan')).toBeInTheDocument();
    // The trade's own +400.00 result is untouched by any of it.
    expect(screen.getByLabelText('Final net profit')).toHaveValue('400.00');
  });

  it('records a system win the trader did not follow', () => {
    show({ filled: true });
    openAssessment();
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
    fireEvent.click(screen.getByRole('button', { name: 'Target hit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Your recorded target' }));
    fireEvent.change(screen.getByLabelText(/Costs if you followed your rules/), {
      target: { value: '0' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Not followed' }));
    done();

    expect(screen.getByText('System +5.00R')).toBeInTheDocument();
    expect(screen.getByText('Did not follow your plan')).toBeInTheDocument();
  });

  it('asks adherence even when the system result cannot be determined', () => {
    // Not knowing what the rules would have produced says nothing about whether
    // the trader followed them.
    openBlank();
    openAssessment();
    fireEvent.click(screen.getByRole('button', { name: "Can't determine" }));
    fireEvent.click(screen.getByRole('button', { name: 'Partly' }));
    done();

    expect(screen.getByText('Can’t determine what the rules would have done')).toBeInTheDocument();
    expect(screen.getByText('Partly followed your plan')).toBeInTheDocument();
  });

  it('states that a reconstructed plan is a reconstruction', () => {
    openBlank();
    openAssessment();
    fireEvent.click(screen.getByRole('button', { name: "Can't determine" }));
    expect(screen.getByText(/No exit plan is recorded for this trade/)).toBeInTheDocument();
  });

  it('marks the assessment for review when a rule it rested on changes', () => {
    show({ filled: true });
    openAssessment();
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
    fireEvent.click(screen.getByRole('button', { name: 'Target hit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Your recorded target' }));
    done();
    expect(screen.getByText('System +5.00R gross')).toBeInTheDocument();
    expect(screen.queryByText('Needs review')).toBeNull();

    // The risk this assessment divided by is corrected afterwards.
    fireEvent.change(screen.getByLabelText('Risk at entry'), { target: { value: '100' } });

    expect(screen.getByText('Needs review')).toBeInTheDocument();
    // Preserved, not erased — and it still computes, against the new figure.
    expect(screen.getByText('System +10.00R gross')).toBeInTheDocument();
  });

  it('shows the review mark even on a fully answered assessment', () => {
    /*
      THE LAUNCHER RENDERS TWO PREVIEW LINES AND NO MORE.

      With the mark appended last, a complete assessment — a system figure AND an
      adherence answer — pushed it off the end, so the trader was told their
      assessment was stale only while it was half finished. The more they had
      entered, the less likely they were to hear that it no longer applied.
      Ordering is load-bearing here, which is why this asserts the fully answered
      case specifically.
    */
    show({ filled: true });
    openAssessment();
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
    fireEvent.click(screen.getByRole('button', { name: 'Target hit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Your recorded target' }));
    fireEvent.click(screen.getByRole('button', { name: 'Not followed' }));
    done();

    // Two lines of real content before anything is stale.
    expect(screen.getByText('System +5.00R gross')).toBeInTheDocument();
    expect(screen.getByText('Did not follow your plan')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Risk at entry'), { target: { value: '100' } });
    expect(screen.getByText('Needs review')).toBeInTheDocument();
  });

  it('settles again when the trader confirms it still applies', () => {
    show({ filled: true });
    openAssessment();
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
    fireEvent.click(screen.getByRole('button', { name: 'Target hit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Your recorded target' }));
    done();
    fireEvent.change(screen.getByLabelText('Risk at entry'), { target: { value: '100' } });
    expect(screen.getByText('Needs review')).toBeInTheDocument();

    openAssessment();
    expect(screen.getByText(/kept, but it is not counted until you confirm/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'This still applies' }));
    done();
    expect(screen.queryByText('Needs review')).toBeNull();
  });

  it('does not mark it stale when the reflection changes', () => {
    show({ filled: true });
    openAssessment();
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
    fireEvent.click(screen.getByRole('button', { name: 'Target hit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Your recorded target' }));
    done();

    fireEvent.click(screen.getByRole('button', { name: /Reflection/ }));
    fireEvent.change(screen.getByLabelText('In your own words'), {
      target: { value: 'A completely different conclusion.' },
    });
    done();
    expect(screen.queryByText('Needs review')).toBeNull();
  });
});

describe('Reflection and System assessment complete independently', () => {
  it('leaves System assessment inviting after Reflection is written', () => {
    show({ filled: true });
    // The seeded draft already holds a reflection.
    expect(
      screen.getByText('Wait for the candle close next time rather than anticipating it.'),
    ).toBeInTheDocument();
    expect(screen.getByText('What would following your rules have produced?')).toBeInTheDocument();
  });

  it('leaves Reflection inviting after System assessment is answered', () => {
    openBlank();
    fireEvent.click(screen.getByRole('button', { name: /System assessment/ }));
    fireEvent.click(screen.getByRole('button', { name: "No — the setup wasn't valid" }));
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));

    expect(screen.getByText('Your rules would not have taken this trade')).toBeInTheDocument();
    expect(screen.getByText('What would you repeat or change next time?')).toBeInTheDocument();
  });
});

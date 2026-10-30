import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NumberField, Segmented, Switch } from './index';

function SegHarness({ onChange }: { onChange?: (v: string) => void }) {
  const [v, setV] = useState<'a' | 'b' | 'c'>('a');
  return (
    <Segmented
      label="Mode"
      value={v}
      onChange={(x) => {
        setV(x);
        onChange?.(x);
      }}
      options={[
        { value: 'a', label: 'A' },
        { value: 'b', label: 'B', disabled: true },
        { value: 'c', label: 'C' },
      ]}
    />
  );
}

describe('Segmented', () => {
  it('exposes a radio group with the active option checked', () => {
    render(<SegHarness />);
    expect(screen.getByRole('radiogroup', { name: 'Mode' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'A' })).toHaveAttribute('aria-checked', 'true');
  });

  it('selects on click', async () => {
    const onChange = vi.fn();
    render(<SegHarness onChange={onChange} />);
    await userEvent.click(screen.getByRole('radio', { name: 'C' }));
    expect(onChange).toHaveBeenLastCalledWith('c');
    expect(screen.getByRole('radio', { name: 'C' })).toHaveAttribute('aria-checked', 'true');
  });

  it('moves with arrow keys, skipping disabled options and wrapping', async () => {
    render(<SegHarness />);
    screen.getByRole('radio', { name: 'A' }).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: 'C' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'C' })).toHaveFocus();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: 'A' })).toHaveAttribute('aria-checked', 'true');
  });
});

describe('NumberField', () => {
  it('commits on Enter and reverts when the parser rejects', async () => {
    const onCommit = vi.fn((raw: string) => /^\d+(\.\d+)?$/.test(raw));
    render(<NumberField label="Width" display="13.0" suffix="cm" onCommit={onCommit} />);
    const input = screen.getByRole('textbox', { name: 'Width' });

    await userEvent.clear(input);
    await userEvent.type(input, '20{Enter}');
    expect(onCommit).toHaveBeenLastCalledWith('20');

    await userEvent.clear(input);
    await userEvent.type(input, 'abc{Enter}');
    expect(input).toHaveValue('13.0');
  });

  it('reverts on Escape without committing', async () => {
    const onCommit = vi.fn(() => true);
    render(<NumberField label="Height" display="5" onCommit={onCommit} />);
    const input = screen.getByRole('textbox', { name: 'Height' });
    await userEvent.type(input, '9{Escape}');
    expect(input).toHaveValue('5');
    expect(onCommit).not.toHaveBeenCalled();
  });
});

describe('Switch', () => {
  it('toggles and reports the new state', async () => {
    const onChange = vi.fn();
    render(<Switch label="Fold shadows" checked={false} onChange={onChange} />);
    await userEvent.click(screen.getByRole('switch', { name: 'Fold shadows' }));
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

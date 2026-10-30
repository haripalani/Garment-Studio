import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TooltipProvider } from '@gs/ui';
import '../i18n';
import { EditorShell } from './EditorShell';
import { usePrefs } from '../store/prefs';
import { FACTORY_LOOK, look } from '../store/look';
import { createDoc } from '@gs/core';
import { DEV_GARMENT, useDoc } from '../store/doc';
import { useWorkspace } from '../store/workspace';

function renderShell() {
  return render(
    <TooltipProvider>
      <EditorShell />
    </TooltipProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  usePrefs.setState({ theme: 'dark', viewMode: 'split', unit: 'cm', tourDone: true });
  useWorkspace.setState({
    tourStep: null,
    dialog: null,
    view: { zoom: 1, panX: 0, panY: 0 },
    viewport: { width: 560, height: 790 },
    tab: 'design',
    side: 'outside',
    tool: 'select',
  });
  useDoc.getState().load(createDoc(DEV_GARMENT.id, DEV_GARMENT.version));
});

describe('EditorShell layout', () => {
  it('shows both stages and the inspector in split view', () => {
    renderShell();
    expect(screen.getByRole('region', { name: 'Sewing pattern' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '3D Preview' })).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Inspector' })).toBeInTheDocument();
  });

  it('switches view modes and remembers the choice', async () => {
    renderShell();
    const view = screen.getByRole('radiogroup', { name: 'View' });
    await userEvent.click(within(view).getByRole('radio', { name: '3D' }));
    expect(screen.queryByRole('region', { name: 'Sewing pattern' })).not.toBeInTheDocument();
    expect(usePrefs.getState().viewMode).toBe('3d');
    expect(localStorage.getItem('gs:prefs')).toContain('"viewMode":"3d"');

    await userEvent.click(within(view).getByRole('radio', { name: 'Sewing pattern' }));
    expect(screen.queryByRole('region', { name: '3D Preview' })).not.toBeInTheDocument();
  });

  it('toggles the theme', async () => {
    renderShell();
    await userEvent.click(screen.getByRole('switch', { name: 'Day / night mode' }));
    expect(usePrefs.getState().theme).toBe('light');
  });

  it('changes units and zoom from the pattern stage', async () => {
    renderShell();
    await userEvent.click(screen.getByRole('radio', { name: 'mm' }));
    expect(usePrefs.getState().unit).toBe('mm');

    await userEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(screen.getByText('125%')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Fit' }));
    // Fit sizes the 6-piece outside sheet into a 560×790 viewport.
    const fitted = useWorkspace.getState().view.zoom;
    expect(fitted).not.toBeCloseTo(1.25);
    expect(screen.getByText(`${Math.round(fitted * 100)}%`)).toBeInTheDocument();
  });

  it('marks stage-gated actions as disabled', () => {
    renderShell();
    expect(screen.getByRole('button', { name: /Undo/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Save project/ })).toBeDisabled();
  });
});

describe('Look defaults', () => {
  it('saves, resets to saved, and restores factory settings', async () => {
    renderShell();
    look.setFabric({ color: '#141516' });
    await userEvent.click(screen.getByRole('button', { name: 'Save as default' }));
    expect(localStorage.getItem('gs:lookDefaults')).toContain('#141516');

    look.setFabric({ color: '#ffffff' });
    await userEvent.click(screen.getByRole('button', { name: 'Reset to saved defaults' }));
    expect(look.get().fabric.color).toBe('#141516');

    await userEvent.click(screen.getByRole('button', { name: 'Restore factory settings' }));
    expect(look.get().fabric.color).toBe(FACTORY_LOOK.fabric.color);
    expect(localStorage.getItem('gs:lookDefaults')).toBeNull();
  });
});

describe('Auth dialog', () => {
  it('validates locally and never claims to have signed in', async () => {
    renderShell();
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Log in' }));
    expect(within(dialog).getByText('Enter a valid email address.')).toBeInTheDocument();

    await userEvent.type(within(dialog).getByLabelText('Email'), 'a@b.co');
    await userEvent.type(within(dialog).getByLabelText('Password'), 'secret-pass');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Log in' }));
    expect(within(dialog).getByText(/Nothing was sent/)).toBeInTheDocument();
  });
});

describe('Tour', () => {
  it('runs on first visit and is marked done when skipped', async () => {
    usePrefs.setState({ tourDone: false });
    renderShell();
    const card = await screen.findByRole('dialog', { name: 'Start with your artwork' });
    expect(within(card).getByText('1 of 6')).toBeInTheDocument();
    await userEvent.click(within(card).getByRole('button', { name: 'Next' }));
    expect(screen.getByRole('dialog', { name: 'Work on the real pattern' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Skip tour' }));
    expect(screen.queryByRole('dialog', { name: /pattern/ })).not.toBeInTheDocument();
    expect(usePrefs.getState().tourDone).toBe(true);
  });
});

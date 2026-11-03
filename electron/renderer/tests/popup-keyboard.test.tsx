import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

function Controls({ kind }: { kind: 'select' | 'menu' }) {
  const [value, setValue] = useState('first');
  return <><button>Before</button>{kind === 'select'
    ? <Select value={value} onValueChange={setValue}><SelectTrigger aria-label="Picker"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="first">First</SelectItem><SelectItem value="disabled" disabled>Unavailable</SelectItem><SelectItem value="last">Last</SelectItem></SelectContent></Select>
    : <DropdownMenu><DropdownMenuTrigger asChild><Button>Picker</Button></DropdownMenuTrigger><DropdownMenuContent><DropdownMenuItem onSelect={() => setValue('first')}>First</DropdownMenuItem><DropdownMenuItem disabled>Unavailable</DropdownMenuItem><DropdownMenuItem onSelect={() => setValue('last')}>Last</DropdownMenuItem></DropdownMenuContent></DropdownMenu>}
    <button disabled>Disabled neighbor</button><button style={{ display: 'none' }}>Hidden neighbor</button><button>After</button><output aria-label="Selection">{value}</output></>;
}

for (const kind of ['select', 'menu'] as const) {
  describe(kind, () => {
    const trigger = () => screen.getByRole(kind === 'select' ? 'combobox' : 'button', { name: 'Picker' });
    const popupRole = kind === 'select' ? 'listbox' : 'menu';
    const itemRole = kind === 'select' ? 'option' : 'menuitem';
    for (const backwards of [false, true]) {
      it(`${backwards ? 'Shift+Tab' : 'Tab'} closes and moves past the trigger, skipping unavailable controls`, async () => {
        const user = userEvent.setup();
        render(<Controls kind={kind} />);
        await user.click(trigger());
        await screen.findByRole(popupRole);
        await user.tab({ shift: backwards });
        await waitFor(() => {
          expect(screen.queryByRole(popupRole)).toBeNull();
          expect(document.activeElement).toBe(screen.getByRole('button', { name: backwards ? 'Before' : 'After' }));
        });
        expect(screen.getByRole('status', { name: 'Selection' }).textContent).toBe('first');
      });
    }
    it('loops in both directions, skips disabled items, and commits only on Enter', async () => {
      const user = userEvent.setup();
      render(<Controls kind={kind} />);
      await user.click(trigger());
      const first = await screen.findByRole(itemRole, { name: 'First' });
      const last = screen.getByRole(itemRole, { name: 'Last' });
      await user.keyboard('{End}');
      await waitFor(() => expect(document.activeElement).toBe(last));
      await user.keyboard('{ArrowDown}');
      await waitFor(() => expect(document.activeElement).toBe(first));
      await user.keyboard('{ArrowUp}');
      await waitFor(() => expect(document.activeElement).toBe(last));
      await user.keyboard('{Home}');
      await waitFor(() => expect(document.activeElement).toBe(first));
      await user.keyboard('{ArrowDown}');
      await waitFor(() => expect(document.activeElement).toBe(last));
      expect(screen.getByRole('status', { name: 'Selection', hidden: true }).textContent).toBe('first');
      await user.keyboard('{Enter}');
      await waitFor(() => expect(screen.queryByRole(popupRole)).toBeNull());
      expect(screen.getByRole('status', { name: 'Selection' }).textContent).toBe('last');
    });
    it('Escape restores focus to the trigger without advancing', async () => {
      const user = userEvent.setup();
      render(<Controls kind={kind} />);
      await user.click(trigger());
      await screen.findByRole(popupRole);
      await user.keyboard('{Escape}');
      await waitFor(() => expect(document.activeElement).toBe(trigger()));
      expect(screen.queryByRole(popupRole)).toBeNull();
    });
  });
}

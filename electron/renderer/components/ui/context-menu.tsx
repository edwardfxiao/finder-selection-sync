import type { ComponentProps } from 'react';
import { ContextMenu as ContextMenuPrimitive } from 'radix-ui';
import { cn } from 'cn';

export function ContextMenu(props: ComponentProps<typeof ContextMenuPrimitive.Root>) {
  return <ContextMenuPrimitive.Root {...props} />;
}

export function ContextMenuTrigger({ onKeyDown, ...props }: ComponentProps<typeof ContextMenuPrimitive.Trigger>) {
  return <ContextMenuPrimitive.Trigger data-slot="context-menu-trigger" {...props} onKeyDown={event => {
    onKeyDown?.(event);
    if (event.defaultPrevented || !(event.key === 'ContextMenu' || event.key === 'F10' && event.shiftKey)) return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    event.currentTarget.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: rect.left + 24, clientY: rect.top + rect.height / 2 }));
  }} />;
}

export function ContextMenuContent({ className, loop = true, ...props }: ComponentProps<typeof ContextMenuPrimitive.Content>) {
  return <ContextMenuPrimitive.Portal><ContextMenuPrimitive.Content data-slot="context-menu-content" loop={loop}
    className={cn('z-50 min-w-44 max-h-(--radix-context-menu-content-available-height) overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md', className)} {...props} />
  </ContextMenuPrimitive.Portal>;
}

export function ContextMenuItem({ className, ...props }: ComponentProps<typeof ContextMenuPrimitive.Item>) {
  return <ContextMenuPrimitive.Item data-slot="context-menu-item"
    className={cn('relative flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground', className)} {...props} />;
}

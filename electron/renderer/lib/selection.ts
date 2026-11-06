import type { Plan, Row } from '@/types';

// A matching file may already have the chosen tags. Keep it selectable so a
// later tag choice can change it without losing the user's file selection.
export function isRowSelectable(plan: Plan, row: Row) {
  if (plan.mode === 'list') return true;
  if (plan.mode === 'filter' || plan.mode === 'compare') {
    return Boolean(row.matched ?? row.candidate) && row.reason.key !== 'reason.hardLink';
  }
  return row.candidate;
}

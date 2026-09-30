'use client';
// S12b: the pack's [data-print] button (site.js: click -> window.print()). The browser's print window offers PDF too.
import { Button } from '@/ui';

export function PrintButton({ children }: { children: string }) {
  return <Button onClick={() => window.print()}>{children}</Button>;
}

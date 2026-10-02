'use client';
// src/app/admin/(app)/requests/_check/CheckLanding.tsx — T2.9.U2: rendered in the Check these list; lands focus
// where a just-deleted request's detail pane asked (landing.ts, wireframe 09 n15). Renders nothing.
import { useEffect } from 'react';
import { moveFocus } from '@/ui/focus';
import { takeLanding } from './landing';

export function CheckLanding() {
  useEffect(() => {
    const el = takeLanding();
    if (el) moveFocus(el, 'script');
  }, []);
  return null;
}

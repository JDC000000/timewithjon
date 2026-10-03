// src/features/email/templates/rest.ts — T3.2.U2: the HTML part of the 15 templates after E1/E2 (index.ts spreads
// this into its map). Each one is Mail.tsx on the #107 Layout with its copy from src/content/emails.ts.
import { createElement, type ReactElement } from 'react';
import { E3 } from './E3';
import { E4 } from './E4';
import { E4c } from './E4c';
import { E5 } from './E5';
import { E5b } from './E5b';
import { E5j } from './E5j';
import { E6 } from './E6';
import { E7 } from './E7';
import { E8 } from './E8';
import { E9 } from './E9';
import { E10 } from './E10';
import { E11 } from './E11';
import { E12 } from './E12';
import { E13 } from './E13';
import { E14 } from './E14';
import { E16 } from './E16';

type Vars = Record<string, string | number>;
const C = { E3, E4, E4c, E5, E5b, E5j, E6, E7, E8, E9, E10, E11, E12, E13, E14, E16 } as const;

export const REST_HTML = Object.fromEntries(
  Object.entries(C).map(([id, T]) => [id, (vars: Vars) => createElement(T, { vars })]),
) as Record<keyof typeof C, (vars: Vars) => ReactElement>;

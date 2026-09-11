import type { Language } from '@prisma/client';
import { t } from './templates';

/** "#7", or a localised "not started yet" before the first consult of the day. */
export function nowServingLabel(language: Language, token: number | null): string {
  return token === null ? t(language, 'nowServingNone') : `#${token}`;
}

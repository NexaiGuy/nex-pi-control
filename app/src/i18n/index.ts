// Kiest de taal eenmalig bij het opstarten op basis van de taal van de gsm: Nederlands of anders Engels.
import { getLocales } from 'expo-localization';

import { en } from './en';
import { nl, type Strings } from './nl';

function detect(): 'nl' | 'en' {
  try {
    const code = getLocales()[0]?.languageCode ?? 'en';
    return code === 'nl' ? 'nl' : 'en';
  } catch {
    return 'en';
  }
}

export const lang: 'nl' | 'en' = detect();
export const locale: string = lang === 'nl' ? 'nl-BE' : 'en-GB';
export const t: Strings = lang === 'nl' ? nl : en;

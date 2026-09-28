// Nickname cleaning. The server always re-sanitizes; the client uses the same
// function to preview. Display code must still use textContent, never innerHTML.
import { NAME_MAX_LENGTH } from './constants.js';

// Control chars, zero-width chars, bidi overrides and other invisible tricks.
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f­͏؜ᅟᅠ឴឵᠎​-‏‪-‮⁠-⁯ㅤ︀-️﻿ﾠ￰-￻]/g;
// Max two combining marks in a row (stops "zalgo" text from covering the UI).
const MARK_SPAM = /(\p{M}{2})\p{M}+/gu;

// Tiny, deliberately incomplete word list. Replace `nameFilter` to plug in
// something smarter; it receives a cleaned name and returns the name to use.
const BLOCKED = ['kanker', 'tering', 'tyfus', 'hitler', 'nazi', 'fuck', 'cunt', 'nigger', 'neger', 'hoer'];

export let nameFilter = (name) => {
  const lower = name.toLowerCase();
  return BLOCKED.some((w) => lower.includes(w)) ? '' : name;
};

export function setNameFilter(fn) {
  nameFilter = fn;
}

export function sanitizeName(raw) {
  if (typeof raw !== 'string') return '';
  let s = raw.slice(0, 200).normalize('NFC').replace(/[\t\n\r\f\v]/g, ' ');
  s = s.replace(INVISIBLE, '').replace(MARK_SPAM, '$1');
  s = s.replace(/\s+/g, ' ').trim();
  s = Array.from(s).slice(0, NAME_MAX_LENGTH).join('').trim();
  return nameFilter(s);
}

// Fallback name when the input is empty after cleaning.
export function defaultName(slot) {
  return `Speler ${slot + 1}`;
}

// Bot names are ours, so no sanitizing needed.
export const BOT_NAMES = ['Bliep', 'Pixel', 'Knopje', 'Turbo', 'Vonk', 'Robbie', 'Zoemer', 'Chip', 'Neon', 'Byte'];

/**
 * The one password-strength rule, shared by client-side UX validation
 * (`RegisterForm`) and server-side enforcement (`src/lib/auth/server.ts`'s
 * `/sign-up/email` before-hook) — a single source of truth so the two can
 * never silently drift into different rules. Pure and side-effect-free: no
 * I/O, no logging, and the password is never mutated (not trimmed, not
 * normalized) or echoed back in the returned result.
 *
 * Mirrors Better Auth's own configured bounds
 * (`emailAndPassword.minPasswordLength`/`maxPasswordLength` in
 * `src/lib/auth/server.ts`, both 12/128) exactly, and uses the same
 * `password.length` semantics (UTF-16 code units) Better Auth's own
 * `sign-up.mjs` length check uses, so the two never disagree about a
 * password containing a surrogate pair (e.g. an emoji).
 */
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

export interface PasswordPolicyResult {
  readonly minimumLength: boolean;
  readonly maximumLength: boolean;
  readonly lowercase: boolean;
  readonly uppercase: boolean;
  readonly number: boolean;
  readonly special: boolean;
  readonly valid: boolean;
}

const LOWERCASE_PATTERN = /[a-z]/;
const UPPERCASE_PATTERN = /[A-Z]/;
const NUMBER_PATTERN = /[0-9]/;
const ASCII_LETTER_OR_DIGIT_PATTERN = /[A-Za-z0-9]/;

/**
 * A "special character" is defined as a printable ASCII character
 * (U+0021–U+007E) that is not an ASCII letter or digit — e.g.
 * `! " # $ % & ' ( ) * + , - . / : ; < = > ? @ [ \ ] ^ _ \` { | } ~`.
 *
 * Whitespace and non-ASCII characters (accented Latin, Thai script, emoji,
 * …) never count. This is deliberate, not an oversight: it is what keeps
 * "Unicode characters do not accidentally satisfy ASCII rules" true for
 * every category, not only uppercase/lowercase — a password cannot satisfy
 * this requirement by pasting in a space or a non-Latin character instead
 * of genuine punctuation.
 */
function isSpecialCharacter(character: string): boolean {
  const codePoint = character.codePointAt(0) ?? 0;
  const isPrintableAscii = codePoint >= 0x21 && codePoint <= 0x7e;
  return isPrintableAscii && !ASCII_LETTER_OR_DIGIT_PATTERN.test(character);
}

/**
 * Evaluates the password policy against the password exactly as given —
 * never trimmed, never case-folded, never otherwise altered. Whitespace
 * (leading, trailing, or internal) is permitted and counts toward length
 * like any other character; it simply never satisfies any of the four
 * character-class requirements.
 */
export function evaluatePasswordPolicy(password: string): PasswordPolicyResult {
  const minimumLength = password.length >= PASSWORD_MIN_LENGTH;
  const maximumLength = password.length <= PASSWORD_MAX_LENGTH;
  const lowercase = LOWERCASE_PATTERN.test(password);
  const uppercase = UPPERCASE_PATTERN.test(password);
  const number = NUMBER_PATTERN.test(password);
  const special = Array.from(password).some(isSpecialCharacter);

  return {
    minimumLength,
    maximumLength,
    lowercase,
    uppercase,
    number,
    special,
    valid: minimumLength && maximumLength && lowercase && uppercase && number && special,
  };
}

export type PasswordStrength = 'insufficient' | 'weak' | 'medium' | 'strong';

/**
 * Informational only — never a substitute for `evaluatePasswordPolicy`'s
 * mandatory checklist, and never claims to guarantee security on its own.
 * A password that fails the mandatory policy is always `'insufficient'`
 * regardless of score.
 *
 * Deterministic scoring, once the mandatory requirements are met:
 * - +1 for each 4 characters beyond the 12-character minimum (so 16+
 *   characters scores strictly better than exactly 12).
 * - +1 if the character diversity (unique characters / length) is high —
 *   but only once length is already past the floor, so a bare 12-character
 *   password cannot borrow a diversity bonus to match a genuinely longer
 *   one. This is what guarantees 16+ characters always outranks exactly 12.
 *
 * No network request, no logging of the password itself, and the numeric
 * score is discarded outside this function — only the coarse band is
 * ever displayed.
 */
export function evaluatePasswordStrength(password: string): PasswordStrength {
  const policy = evaluatePasswordPolicy(password);
  if (!policy.valid) return 'insufficient';

  const extraLength = Math.max(0, password.length - PASSWORD_MIN_LENGTH);
  const lengthScore = Math.floor(extraLength / 4);

  const uniqueCharacters = new Set(Array.from(password)).size;
  const diversityScore = extraLength > 0 && uniqueCharacters >= password.length * 0.7 ? 1 : 0;

  const score = lengthScore + diversityScore;
  if (score >= 3) return 'strong';
  if (score >= 1) return 'medium';
  return 'weak';
}

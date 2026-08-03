import { describe, expect, it } from 'vitest';

import { evaluatePasswordPolicy, evaluatePasswordStrength } from './password-policy';

describe('evaluatePasswordPolicy', () => {
  it('fails a password shorter than 12 characters', () => {
    const result = evaluatePasswordPolicy('Sh0rt!aaaa'); // 10 characters
    expect(result.minimumLength).toBe(false);
    expect(result.valid).toBe(false);
  });

  it('passes at exactly 12 characters when every category is present', () => {
    const password = 'Abcdefgh1@#$'; // 12 chars: upper, lower, number, special
    expect(password).toHaveLength(12);
    const result = evaluatePasswordPolicy(password);
    expect(result.minimumLength).toBe(true);
    expect(result.lowercase).toBe(true);
    expect(result.uppercase).toBe(true);
    expect(result.number).toBe(true);
    expect(result.special).toBe(true);
    expect(result.valid).toBe(true);
  });

  it('fails a password longer than 128 characters', () => {
    const password = `Aa1!${'a'.repeat(126)}`; // 130 characters
    expect(password.length).toBeGreaterThan(128);
    const result = evaluatePasswordPolicy(password);
    expect(result.maximumLength).toBe(false);
    expect(result.valid).toBe(false);
  });

  it('passes at exactly 128 characters', () => {
    const password = `Aa1!${'a'.repeat(124)}`; // 128 characters
    expect(password).toHaveLength(128);
    expect(evaluatePasswordPolicy(password).maximumLength).toBe(true);
  });

  it('fails when lowercase is missing', () => {
    const result = evaluatePasswordPolicy('ABCDEFGH123!');
    expect(result.lowercase).toBe(false);
    expect(result.valid).toBe(false);
  });

  it('fails when uppercase is missing', () => {
    const result = evaluatePasswordPolicy('abcdefgh123!');
    expect(result.uppercase).toBe(false);
    expect(result.valid).toBe(false);
  });

  it('fails when a number is missing', () => {
    const result = evaluatePasswordPolicy('Abcdefghijk!');
    expect(result.number).toBe(false);
    expect(result.valid).toBe(false);
  });

  it('fails when a special character is missing', () => {
    const result = evaluatePasswordPolicy('Abcdefghij12');
    expect(result.special).toBe(false);
    expect(result.valid).toBe(false);
  });

  it('passes a genuinely valid password', () => {
    const result = evaluatePasswordPolicy('Correct-Horse9');
    expect(result).toEqual({
      minimumLength: true,
      maximumLength: true,
      lowercase: true,
      uppercase: true,
      number: true,
      special: true,
      valid: true,
    });
  });

  describe('Unicode does not accidentally satisfy ASCII character-class rules', () => {
    it('a Thai/accented/full-width letter does not count as lowercase or uppercase', () => {
      // 'à' (accented lowercase Latin), 'ก' (Thai), 'Ａ' (full-width Latin
      // capital) are all non-ASCII code points — none may substitute for a
      // genuine a-z/A-Z character.
      const result = evaluatePasswordPolicy('àกＡ23456789012');
      expect(result.lowercase).toBe(false);
      expect(result.uppercase).toBe(false);
    });

    it('a full-width digit does not count as a number', () => {
      const result = evaluatePasswordPolicy('Abcdefghij١!'); // Arabic-Indic digit 1, not ASCII
      expect(result.number).toBe(false);
    });

    it('a non-ASCII character (Thai, emoji, accented) does not count as a special character', () => {
      const result = evaluatePasswordPolicy('Abcdefghij12ก');
      expect(result.special).toBe(false);
      const emojiResult = evaluatePasswordPolicy('Abcdefghij12😀');
      expect(emojiResult.special).toBe(false);
    });

    it('genuine ASCII punctuation does count as a special character', () => {
      for (const char of ['!', '@', '#', '$', '%', '^', '&', '*', '-', '_', '~', '`']) {
        const result = evaluatePasswordPolicy(`Abcdefghij12${char}`);
        expect(result.special, `expected "${char}" to count as special`).toBe(true);
      }
    });
  });

  it('never trims or otherwise mutates the password — leading/trailing whitespace counts toward length and is preserved', () => {
    const withSpaces = '  Abc12345!  '; // 13 chars, spaces do not satisfy any class
    const result = evaluatePasswordPolicy(withSpaces);
    // Length is computed against the untrimmed string.
    expect(withSpaces).toHaveLength(13);
    expect(result.minimumLength).toBe(true);
    // The function takes no mutable reference and returns no password —
    // there is nothing for it to have mutated. Re-running on the same
    // input is idempotent, confirming no hidden state.
    expect(evaluatePasswordPolicy(withSpaces)).toEqual(result);
  });

  it('does not let internal whitespace substitute for a required character class', () => {
    const result = evaluatePasswordPolicy('Abc def gh1!'); // 12 chars incl. spaces
    expect(result.valid).toBe(true); // has upper/lower/number/special already
    // A password that relies ONLY on spaces plus letters (no digit/special)
    // must still fail — spaces are inert, not a wildcard.
    const spacesOnly = evaluatePasswordPolicy('Abcdefghijkl        '); // spaces, no digit/special
    expect(spacesOnly.number).toBe(false);
    expect(spacesOnly.special).toBe(false);
  });
});

describe('evaluatePasswordStrength', () => {
  it('reports "insufficient" whenever the mandatory policy fails, regardless of length', () => {
    expect(evaluatePasswordStrength('short')).toBe('insufficient');
    expect(evaluatePasswordStrength('alllowercase12!!!!!!!!!!!!!!!!')).toBe('insufficient');
  });

  it('scores a 16+ character password strictly better than the exact 12-character minimum', () => {
    const twelve = evaluatePasswordStrength('Abcdefgh1@#$');
    const sixteenPlus = evaluatePasswordStrength('Abcdefghijkl1@#$');
    const rank: Record<string, number> = { insufficient: 0, weak: 1, medium: 2, strong: 3 };
    expect(rank[sixteenPlus]).toBeGreaterThan(rank[twelve] ?? 0);
  });

  it('never returns anything outside the four documented labels', () => {
    const passwords = ['Abcdefgh1@#$', 'ThisIsAMuchLongerPassword123!@#$%^&*()', 'short'];
    for (const password of passwords) {
      expect(['insufficient', 'weak', 'medium', 'strong']).toContain(
        evaluatePasswordStrength(password),
      );
    }
  });
});

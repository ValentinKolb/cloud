const UPPERCASE = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const LOWERCASE = "abcdefghijklmnopqrstuvwxyz";
const DIGITS = "0123456789";
const SYMBOLS = "!@$%^&*()-_=+[]{}|;:,.<>?";

const CHARSETS = [UPPERCASE, LOWERCASE, DIGITS, SYMBOLS] as const;
const ALL_CHARS = CHARSETS.join("");

/** Generate a random password with at least 3 character classes. */
export const generatePassword = (length = 10): string => {
  const randomBytes = new Uint8Array(length * 2);
  crypto.getRandomValues(randomBytes);

  let result: string[];
  let attempts = 0;

  do {
    crypto.getRandomValues(randomBytes);
    result = [];
    for (let i = 0; i < length; i++) {
      result.push(ALL_CHARS[randomBytes[i]! % ALL_CHARS.length]!);
    }
    attempts++;
  } while (countClasses(result) < 3 && attempts < 100);

  // Shuffle to avoid any positional bias
  for (let i = result.length - 1; i > 0; i--) {
    const j = randomBytes[length + i]! % (i + 1);
    [result[i], result[j]] = [result[j]!, result[i]!];
  }

  return result.join("");
};

const countClasses = (chars: string[]): number => {
  let count = 0;
  for (const charset of CHARSETS) {
    if (chars.some((c) => charset.includes(c))) count++;
  }
  return count;
};

export const password = {
  generate: generatePassword,
} as const;

// Copied from Moth (MIT, github.com/Ridarketh/Moth-radar) for running in the browser.
// Turns a token name like "BabyDogWifHat 2.0 🚀" into the words we count:
// ["baby", "dog", "wif", "hat"].
//
// Rules, in order:
//   1. Unicode NFKC, so fancy letters (𝐂𝐀𝐓, ｃａｔ) collapse to plain ones.
//   2. Drop possessive 's and apostrophes ("Elon's" -> "elon", "don't" -> "dont").
//   3. Split camelCase ("DogWifHat" -> dog wif hat, "AIAgent" -> ai agent).
//   4. Split on anything that is not a letter, mark or digit (spaces, $, emoji, dots).
//   5. Separate CJK runs from Latin ("AI猫" -> ai, 猫). A CJK run is kept whole.
//   6. Lowercase, strip Latin diacritics, drop pure numbers, single letters,
//      stopwords and anything over 24 characters.
// Each word is counted once per token.

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const CJK_RUNS = /([\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}ー]+)/u;
const LATIN_ONLY = /^[\p{Script=Latin}\p{M}\p{N}]+$/u;

export const DEFAULT_STOPWORDS = [
  // English glue words
  'a', 'an', 'the', 'and', 'or', 'nor', 'but', 'of', 'to', 'in', 'on', 'at', 'for', 'from',
  'by', 'with', 'into', 'onto', 'as', 'is', 'are', 'was', 'were', 'be', 'been', 'am',
  'it', 'its', 'this', 'that', 'these', 'those', 'there', 'here', 'than', 'then', 'so',
  'if', 'not', 'no', 'do', 'does', 'did', 'has', 'have', 'had', 'will', 'would', 'can',
  'could', 'should', 'just', 'very', 'too', 'also', 'only',
  'i', 'me', 'my', 'you', 'your', 'he', 'him', 'his', 'she', 'her', 'we', 'us', 'our',
  'they', 'them', 'their', 'who', 'what', 'which', 'when', 'where', 'why', 'how',
  // launchpad boilerplate that appears in every other name and says nothing
  'coin', 'coins', 'token', 'tokens', 'official', 'sol', 'solana', 'crypto', 'ca',
];

export function makeStopwords(extra = []) {
  return new Set([...DEFAULT_STOPWORDS, ...extra.map((w) => String(w).toLowerCase().trim()).filter(Boolean)]);
}

const DEFAULT_SET = makeStopwords();

export function tokenize(name, { stopwords = DEFAULT_SET, maxWords = 8 } = {}) {
  if (typeof name !== 'string' || !name) return [];
  let s = name.normalize('NFKC');
  s = s.replace(/['’`]s\b/giu, '').replace(/['’`]/gu, '');
  s = s
    .replace(/(\p{Ll})(\p{Lu})/gu, '$1 $2')
    .replace(/(\p{Lu}+)(\p{Lu}\p{Ll}{2,})/gu, '$1 $2');

  const out = [];
  const seen = new Set();
  const raw = s.match(/[\p{L}\p{M}\p{N}]+/gu) || [];
  for (const chunk of raw) {
    for (const part of chunk.split(CJK_RUNS)) {
      if (!part) continue;
      let w = part.toLowerCase();
      if (LATIN_ONLY.test(w)) w = w.normalize('NFD').replace(/\p{M}+/gu, '');
      if (!isWord(w) || stopwords.has(w) || seen.has(w)) continue;
      seen.add(w);
      out.push(w);
      if (out.length >= maxWords) return out;
    }
  }
  return out;
}

function isWord(w) {
  const len = [...w].length;
  if (len === 0 || len > 24) return false;
  if (/^\p{N}+$/u.test(w)) return false;
  if (CJK.test(w)) return true;
  if (len < 2) return false;
  return /\p{L}/u.test(w);
}

// Cleans up a word the user typed into the watchlist or hide list.
export function normalizeWord(input) {
  const words = tokenize(String(input || ''), { stopwords: new Set() });
  return words[0] || '';
}

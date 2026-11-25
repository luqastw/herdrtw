// Fuzzy matching for the Go to list. Every word typed must match one of a row's fields,
// in order but not necessarily together ("app login" finds my-app ·
// feature/123-login-form). A field scores higher when the word is a whole piece of it,
// starts one of its parts (after / - _ . or a space), or sits in one run of letters; matches
// in the branch count most, then repo and space name, then the folder.

const BOUNDARY = /[\/\-_. ]/;

// Best placement of `word` in `text` as a subsequence, preferring boundary starts and runs.
// Returns { score, hits } (hits: matched indexes) or null.
function matchWord(word, text) {
  const lower = text.toLowerCase();
  const exact = lower.indexOf(word);
  if (exact >= 0) {
    const atBoundary = exact === 0 || BOUNDARY.test(lower[exact - 1]);
    const whole = atBoundary && (exact + word.length === lower.length || BOUNDARY.test(lower[exact + word.length]));
    const hits = Array.from({ length: word.length }, (_, i) => exact + i);
    return { score: 100 + word.length * 10 + (atBoundary ? 40 : 0) + (whole ? 40 : 0) - exact * 0.2, hits };
  }
  // Subsequence: greedy from each possible start, keep the best.
  let best = null;
  for (let start = lower.indexOf(word[0]); start >= 0; start = lower.indexOf(word[0], start + 1)) {
    const hits = [start];
    let i = start;
    for (const ch of word.slice(1)) {
      i = lower.indexOf(ch, i + 1);
      if (i < 0) break;
      hits.push(i);
    }
    if (hits.length !== word.length) break;
    let score = 0;
    hits.forEach((h, k) => {
      score += 4;
      if (h === 0 || BOUNDARY.test(lower[h - 1])) score += 8;
      if (k > 0 && h === hits[k - 1] + 1) score += 6;
      else if (k > 0) score -= Math.min(6, h - hits[k - 1]);
    });
    if (!best || score > best.score) best = { score, hits };
  }
  return best;
}

// fields: { [name]: { text, weight } }. Returns { score, hits: { [name]: Set } } or null.
export function fuzzyMatch(query, fields) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return { score: 0, hits: {} };
  let total = 0;
  const hits = {};
  for (const word of words) {
    let best = null;
    for (const [name, { text, weight }] of Object.entries(fields)) {
      if (!text) continue;
      const m = matchWord(word, text);
      if (m && (!best || m.score * weight > best.score)) best = { score: m.score * weight, name, hits: m.hits };
    }
    if (!best) return null;
    total += best.score;
    (hits[best.name] ??= new Set());
    best.hits.forEach((h) => hits[best.name].add(h));
  }
  return { score: total, hits };
}

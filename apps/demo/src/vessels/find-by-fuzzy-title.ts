// Picks the longest (most specific) match rather than list.find's first
// match — a shorter, coincidentally-contained title (e.g. "Gym" inside
// "Design review — Gym") would otherwise win over the title the query
// actually names.
function mostSpecificReverseMatch<T extends { title: string }>(
  list: T[],
  query: string,
): T | undefined {
  let best: T | undefined;
  for (const item of list) {
    if (!query.includes(item.title.toLowerCase())) continue;
    if (!best || item.title.length > best.title.length) best = item;
  }
  return best;
}

export function findByFuzzyTitle<T extends { title: string }>(
  list: T[],
  title: string,
): T | undefined {
  const query = title.toLowerCase().trim();
  if (!query) return undefined;
  return (
    list.find((item) => item.title.toLowerCase() === query) ??
    list.find((item) => item.title.toLowerCase().includes(query)) ??
    mostSpecificReverseMatch(list, query)
  );
}

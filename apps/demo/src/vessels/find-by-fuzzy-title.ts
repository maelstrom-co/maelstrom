export function findByFuzzyTitle<T extends { title: string }>(
  list: T[],
  title: string,
): T | undefined {
  const query = title.toLowerCase().trim();
  if (!query) return undefined;
  return (
    list.find((item) => item.title.toLowerCase() === query) ??
    list.find((item) => item.title.toLowerCase().includes(query))
  );
}

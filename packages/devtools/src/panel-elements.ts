export function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  value?: string,
  className?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (value !== undefined) node.textContent = value;
  if (className) node.className = className;
  return node;
}
export function button(
  label: string,
  click: () => void,
  className?: string,
): HTMLButtonElement {
  const node = element('button', label, className);
  node.type = 'button';
  node.addEventListener('click', click);
  return node;
}

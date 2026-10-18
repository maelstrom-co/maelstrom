import jsonview from '@pgrabovets/json-view';
import { button, element } from './panel-elements.js';

type JsonMode = 'tree' | 'raw';

function highlightedJson(serialized: string): DocumentFragment {
  const fragment = document.createDocumentFragment();
  const tokens =
    /"(?:\\.|[^"\\])*"(?:\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;
  let offset = 0;
  let count = 0;
  for (const match of serialized.matchAll(tokens)) {
    if (++count > 20000) break;
    fragment.append(
      document.createTextNode(serialized.slice(offset, match.index)),
    );
    const token = match[0];
    const kind = token.startsWith('"')
      ? token.endsWith(':')
        ? 'key'
        : 'string'
      : token === 'null'
        ? 'null'
        : token === 'true' || token === 'false'
          ? 'boolean'
          : 'number';
    fragment.append(element('span', token, `json-${kind}`));
    offset = match.index + token.length;
  }
  fragment.append(document.createTextNode(serialized.slice(offset)));
  return fragment;
}

export function createJsonInspector(
  initialMode: JsonMode,
  onModeChange: (mode: JsonMode) => void,
  name = 'JSON evidence',
) {
  const root = element('aside', undefined, 'json-pane');
  root.setAttribute('aria-label', name);
  const title = element('h3', name);
  const label = (value: string) =>
    name === 'JSON evidence' ? value : `${name}: ${value}`;
  const description = element('p', undefined, 'muted small');
  const redaction = element('p', undefined, 'muted small');
  const controls = element('div', undefined, 'json-controls');
  controls.setAttribute('role', 'group');
  controls.setAttribute('aria-label', label('JSON presentation'));
  const raw = element('pre', undefined, 'json-content json-raw');
  raw.tabIndex = 0;
  raw.setAttribute('role', 'region');
  raw.setAttribute('aria-label', label('Raw JSON'));
  raw.dataset.focusKey = `${name}:raw-content`;
  const treeContent = element('div', undefined, 'json-content json-tree');
  treeContent.tabIndex = 0;
  treeContent.setAttribute('role', 'region');
  treeContent.setAttribute('aria-label', label('JSON tree'));
  treeContent.dataset.focusKey = `${name}:tree-content`;
  let tree: ReturnType<typeof jsonview.create> | undefined;
  let mode = initialMode;
  let initialized = false;
  let previous: unknown;
  const rawButton = button(label('Raw JSON'), () => choose('raw'));
  const treeButton = button(label('Tree'), () => choose('tree'));
  const expand = button(label('Expand all'), () => {
    if (tree) jsonview.expand(tree);
    updateTreeControls();
  });
  const collapse = button(label('Collapse all'), () => {
    if (tree) jsonview.collapse(tree);
    updateTreeControls();
  });
  controls.append(treeButton, rawButton, expand, collapse);
  for (const [index, control] of [
    treeButton,
    rawButton,
    expand,
    collapse,
  ].entries())
    control.dataset.focusKey = `${name}:control-${index}`;
  root.append(title, description, controls, redaction, raw, treeContent);

  function choose(next: JsonMode): void {
    mode = next;
    raw.hidden = mode !== 'raw';
    treeContent.hidden = mode !== 'tree';
    rawButton.setAttribute('aria-pressed', String(mode === 'raw'));
    treeButton.setAttribute('aria-pressed', String(mode === 'tree'));
    expand.hidden = collapse.hidden = mode !== 'tree';
    onModeChange(mode);
  }
  function updateTreeControls(): void {
    if (!tree) return;
    jsonview.traverse(tree, (node) => {
      const toggle = node.el?.querySelector<HTMLElement>('.caret-icon');
      if (!toggle || node.children.length === 0) return;
      toggle.setAttribute('role', 'button');
      toggle.tabIndex = 0;
      toggle.setAttribute('aria-expanded', String(node.isExpanded));
      const section =
        node.depth === 0
          ? 'root'
          : (node.el?.querySelector('.json-key')?.textContent ?? 'section');
      toggle.setAttribute(
        'aria-label',
        label(`${node.isExpanded ? 'Collapse' : 'Expand'} ${section}`),
      );
    });
  }
  treeContent.addEventListener('click', updateTreeControls);
  treeContent.addEventListener('keydown', (event) => {
    const target = event.target as HTMLElement;
    if (
      (event.key === 'Enter' || event.key === ' ') &&
      target.matches('.caret-icon')
    ) {
      event.preventDefault();
      target.click();
    }
  });
  function clear(): void {
    if (tree) jsonview.destroy(tree);
    tree = undefined;
    previous = undefined;
    initialized = false;
    raw.replaceChildren();
    treeContent.replaceChildren();
    raw.scrollTop = treeContent.scrollTop = 0;
    redaction.hidden = true;
    expand.disabled = collapse.disabled = true;
  }
  function set(
    value: unknown,
    descriptionText: string,
    empty = 'Choose a request stage, event, or Instance to inspect its JSON.',
  ): void {
    description.textContent = descriptionText;
    if (initialized && previous === value) {
      if (value === undefined)
        raw.textContent = treeContent.textContent = empty;
      return;
    }
    clear();
    previous = value;
    initialized = true;
    if (value === undefined) {
      raw.textContent = treeContent.textContent = empty;
      return;
    }
    try {
      const serialized = JSON.stringify(value, null, 2);
      raw.append(highlightedJson(serialized));
      // The library uses HTML templates. Escape its projection while preserving raw evidence.
      const escaped = serialized
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;');
      tree = jsonview.create(escaped);
      jsonview.traverse(tree, (node) => {
        // The library maps empty property names to null.
        if (node.depth > 0 && node.key === null) node.key = '""';
      });
      jsonview.render(tree, treeContent);
      if (tree.children.length > 0) jsonview.toggleNode(tree);
      updateTreeControls();
      expand.disabled = collapse.disabled = tree.children.length === 0;
      redaction.hidden = !/\[(?:REDACTED|TRUNCATED|CIRCULAR)\]/.test(
        serialized,
      );
      redaction.textContent =
        'Some values were redacted, shortened, or replaced.';
    } catch {
      if (tree) jsonview.destroy(tree);
      tree = undefined;
      raw.textContent = treeContent.textContent =
        'Could not display this value as JSON.';
    }
  }
  choose(mode);
  clear();
  return { element: root, set, clear };
}

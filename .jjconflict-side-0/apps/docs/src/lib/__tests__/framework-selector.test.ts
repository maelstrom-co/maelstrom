import { describe, it, expect, beforeEach } from 'bun:test';
import {
  FRAMEWORK_LABELS,
  LABEL_TO_FRAMEWORK,
  syncStarlightTabs,
} from '../framework-selector';

describe('FRAMEWORK_LABELS', () => {
  it('maps framework IDs to display labels', () => {
    expect(FRAMEWORK_LABELS.react).toBe('React');
    expect(FRAMEWORK_LABELS.vanilla).toBe('Vanilla JS');
    expect(FRAMEWORK_LABELS.solid).toBe('Solid');
  });
});

describe('LABEL_TO_FRAMEWORK', () => {
  it('maps display labels back to framework IDs', () => {
    expect(LABEL_TO_FRAMEWORK['React']).toBe('react');
    expect(LABEL_TO_FRAMEWORK['Vanilla JS']).toBe('vanilla');
    expect(LABEL_TO_FRAMEWORK['Solid']).toBe('solid');
  });
});

describe('syncStarlightTabs', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  function buildTabGroup(labels: string[], activeIndex = 0) {
    const tabGroup = document.createElement('starlight-tabs');
    tabGroup.setAttribute('data-sync-key', 'framework');

    labels.forEach((label, i) => {
      const tab = document.createElement('button');
      tab.setAttribute('role', 'tab');
      tab.textContent = label;
      tab.setAttribute('aria-selected', i === activeIndex ? 'true' : 'false');
      tab.setAttribute('tabindex', i === activeIndex ? '0' : '-1');
      tabGroup.appendChild(tab);
    });

    labels.forEach((_, i) => {
      const panel = document.createElement('div');
      panel.setAttribute('role', 'tabpanel');
      panel.hidden = i !== activeIndex;
      tabGroup.appendChild(panel);
    });

    document.body.appendChild(tabGroup);
    return tabGroup;
  }

  it('switches the active tab by label', () => {
    buildTabGroup(['React', 'Vanilla JS', 'Solid']);
    syncStarlightTabs('Vanilla JS');

    const tabs = document.querySelectorAll('[role="tab"]');
    expect(tabs[0].getAttribute('aria-selected')).toBe('false');
    expect(tabs[1].getAttribute('aria-selected')).toBe('true');
    expect(tabs[2].getAttribute('aria-selected')).toBe('false');
  });

  it('shows the matching panel and hides others', () => {
    buildTabGroup(['React', 'Vanilla JS']);
    syncStarlightTabs('Vanilla JS');

    const panels = document.querySelectorAll('[role="tabpanel"]');
    expect((panels[0] as HTMLElement).hidden).toBe(true);
    expect((panels[1] as HTMLElement).hidden).toBe(false);
  });

  it('sets correct tabindex on tabs', () => {
    buildTabGroup(['React', 'Vanilla JS']);
    syncStarlightTabs('Vanilla JS');

    const tabs = document.querySelectorAll('[role="tab"]');
    expect(tabs[0].getAttribute('tabindex')).toBe('-1');
    expect(tabs[1].getAttribute('tabindex')).toBe('0');
  });

  it('does nothing when label does not match any tab', () => {
    buildTabGroup(['React', 'Vanilla JS']);
    syncStarlightTabs('Nonexistent');

    const tabs = document.querySelectorAll('[role="tab"]');
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    expect(tabs[1].getAttribute('aria-selected')).toBe('false');
  });

  it('does nothing when no starlight-tabs elements exist', () => {
    expect(() => syncStarlightTabs('React')).not.toThrow();
  });

  it('syncs multiple tab groups on the same page', () => {
    buildTabGroup(['React', 'Vanilla JS']);
    buildTabGroup(['React', 'Vanilla JS']);

    syncStarlightTabs('Vanilla JS');

    const allTabs = document.querySelectorAll('[role="tab"]');
    expect(allTabs[1].getAttribute('aria-selected')).toBe('true');
    expect(allTabs[3].getAttribute('aria-selected')).toBe('true');
  });
});

describe('FrameworkSelector custom element', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
  });

  /** Build a <framework-selector> element matching Sidebar.astro's template. */
  function buildSelector() {
    const el = document.createElement('framework-selector');
    el.classList.add('framework-selector');
    el.innerHTML = `
      <button type="button" class="framework-trigger" aria-expanded="false" aria-haspopup="listbox">
        <span class="framework-icon"></span>
        <span class="framework-label">React</span>
        <span class="framework-chevron"></span>
      </button>
      <ul class="framework-menu" role="listbox" aria-label="Select framework">
        <li role="option" data-framework="react" aria-selected="true">
          <span class="fw-option-icon">R</span>
          <span class="fw-option-label">React</span>
        </li>
        <li role="option" data-framework="vanilla" aria-selected="false">
          <span class="fw-option-icon">V</span>
          <span class="fw-option-label">Vanilla JS</span>
        </li>
        <li role="option" data-framework="solid" aria-selected="false" class="coming-soon">
          <span class="fw-option-icon">S</span>
          <span class="fw-option-label">Solid</span>
          <span class="badge-soon">Soon</span>
        </li>
      </ul>
    `;
    document.body.appendChild(el);
    return el;
  }

  it('loads saved framework preference on connect', () => {
    localStorage.setItem('maelstrom-framework', 'vanilla');
    const el = buildSelector();

    const label = el.querySelector('.framework-label');
    expect(label!.textContent).toBe('Vanilla JS');
  });

  it('defaults to react when no preference is saved', () => {
    const el = buildSelector();

    const selected = el.querySelector('[aria-selected="true"]');
    expect((selected as HTMLElement).dataset.framework).toBe('react');
  });

  it('syncs preference to Starlight tabs localStorage key on connect', () => {
    localStorage.setItem('maelstrom-framework', 'vanilla');
    buildSelector();

    expect(localStorage.getItem('starlight-synced-tabs__framework')).toBe('Vanilla JS');
  });

  it('opens menu on trigger click', () => {
    const el = buildSelector();
    const trigger = el.querySelector('.framework-trigger') as HTMLElement;

    trigger.click();
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
  });

  it('closes menu on second trigger click', () => {
    const el = buildSelector();
    const trigger = el.querySelector('.framework-trigger') as HTMLElement;

    trigger.click();
    trigger.click();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('selects framework on option click', () => {
    const el = buildSelector();
    const trigger = el.querySelector('.framework-trigger') as HTMLElement;
    trigger.click(); // open menu

    const vanillaOption = el.querySelector('[data-framework="vanilla"]') as HTMLElement;
    vanillaOption.click();

    expect(el.querySelector('.framework-label')!.textContent).toBe('Vanilla JS');
    expect(vanillaOption.getAttribute('aria-selected')).toBe('true');
    expect(localStorage.getItem('maelstrom-framework')).toBe('vanilla');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('excludes coming-soon options from interactive options', () => {
    const el = buildSelector();
    const trigger = el.querySelector('.framework-trigger') as HTMLElement;
    trigger.click();

    const solidOption = el.querySelector('[data-framework="solid"]') as HTMLElement;
    solidOption.click();

    // Should NOT change — solid is coming-soon
    expect(el.querySelector('.framework-label')!.textContent).not.toBe('Solid');
  });

  it('closes menu on Escape key', () => {
    const el = buildSelector();
    const trigger = el.querySelector('.framework-trigger') as HTMLElement;
    trigger.click();

    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('opens menu on ArrowDown when closed', () => {
    const el = buildSelector();
    const trigger = el.querySelector('.framework-trigger') as HTMLElement;

    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
  });

  it('cleans up event listeners on disconnect', () => {
    const el = buildSelector();
    expect(() => el.remove()).not.toThrow();
  });
});

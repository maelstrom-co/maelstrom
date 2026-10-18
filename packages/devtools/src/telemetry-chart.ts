import { element } from './panel-elements.js';
import type { TelemetrySample } from './telemetry-history.js';

interface Series {
  readonly label: string;
  readonly color: string;
  readonly value: (sample: TelemetrySample) => number | undefined;
}

const namespace = 'http://www.w3.org/2000/svg';
const plotLeft = 72;
const plotRight = 580;
const number = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

function svgElement<K extends keyof SVGElementTagNameMap>(
  name: K,
  attributes: Record<string, string>,
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(namespace, name);
  for (const [key, value] of Object.entries(attributes))
    node.setAttribute(key, value);
  return node;
}

export function createTelemetryChart(
  title: string,
  series: readonly Series[],
  select: (sequence: number) => void,
) {
  const root = element('figure', undefined, 'telemetry-chart');
  const legend = element('div', undefined, 'telemetry-legend');
  for (const item of series) {
    const label = element('span', item.label);
    label.style.setProperty('--series-color', item.color);
    legend.append(label);
  }
  const svg = svgElement('svg', {
    viewBox: '0 0 600 160',
    role: 'img',
    'aria-label': title,
  });
  const description = svgElement('desc', {});
  description.textContent =
    'Select a time in the chart or use the sample table. Lines break across missing observations.';
  const plot = svgElement('g', {});
  svg.append(description, plot);
  const caption = element(
    'figcaption',
    'Select a time to inspect its counters.',
  );
  root.append(element('h4', title), legend, svg, caption);
  let samples: readonly TelemetrySample[] = [];
  const x = (sample: TelemetrySample) => {
    const first = samples[0];
    const last = samples.at(-1);
    if (!first || !last) return plotLeft;
    const start = first.elapsedMs;
    const span = last.elapsedMs - start;
    return span > 0
      ? plotLeft + ((sample.elapsedMs - start) / span) * (plotRight - plotLeft)
      : plotLeft;
  };
  svg.addEventListener('click', (event) => {
    if (!samples.length) return;
    const bounds = svg.getBoundingClientRect();
    if (!bounds.width) return;
    const position = ((event.clientX - bounds.left) / bounds.width) * 600;
    const nearest = samples.reduce((nearest, sample) =>
      Math.abs(x(sample) - position) < Math.abs(x(nearest) - position)
        ? sample
        : nearest,
    );
    select(nearest.sequence);
  });
  return {
    element: root,
    update(next: readonly TelemetrySample[], selected: number | undefined) {
      samples = next;
      const maximum = Math.max(
        1,
        ...samples.flatMap((sample) =>
          series.map((item) => item.value(sample) ?? 0),
        ),
      );
      const y = (value: number) => 132 - (value / maximum) * 112;
      plot.replaceChildren();
      for (const value of [0, maximum / 2, maximum]) {
        const label = svgElement('text', {
          x: String(plotLeft - 8),
          y: String(y(value) + 4),
          'text-anchor': 'end',
          class: 'telemetry-axis',
        });
        label.textContent = number.format(value);
        plot.append(
          svgElement('line', {
            x1: String(plotLeft),
            x2: String(plotRight),
            y1: String(y(value)),
            y2: String(y(value)),
            class: 'telemetry-gridline',
          }),
          label,
        );
      }
      for (const item of series) {
        let path = '';
        let connected = false;
        const markers: Array<{ sample: TelemetrySample; value: number }> = [];
        for (const sample of samples) {
          const value = item.value(sample);
          if (sample.gap || value === undefined) connected = false;
          if (value === undefined) continue;
          if (!connected) markers.push({ sample, value });
          path += `${connected ? 'L' : 'M'}${x(sample).toFixed(2)},${y(value).toFixed(2)} `;
          connected = true;
        }
        plot.append(
          svgElement('path', {
            d: path,
            fill: 'none',
            stroke: item.color,
            'stroke-width': '2',
            'vector-effect': 'non-scaling-stroke',
            'data-series': item.label,
          }),
        );
        const sample = samples.find((sample) => sample.sequence === selected);
        const value = sample && item.value(sample);
        if (
          sample &&
          value !== undefined &&
          !markers.some((marker) => marker.sample.sequence === selected)
        )
          markers.push({ sample, value });
        for (const { sample, value } of markers)
          plot.append(
            svgElement('circle', {
              cx: String(x(sample)),
              cy: String(y(value)),
              r: sample.sequence === selected ? '4' : '2.5',
              fill: item.color,
            }),
          );
      }
      const selectedSample = samples.find(
        (sample) => sample.sequence === selected,
      );
      if (selectedSample)
        plot.append(
          svgElement('line', {
            x1: String(x(selectedSample)),
            x2: String(x(selectedSample)),
            y1: '12',
            y2: '138',
            class: 'telemetry-cursor',
          }),
        );
    },
  };
}

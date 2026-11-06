import type { PaintRecord, ScrollRecord } from './perf-stats';

const ms = (value: number) => value.toFixed(1);

export interface PerfPanelProps {
  paints: readonly PaintRecord[];
  scrolls: readonly ScrollRecord[];
  elements: number;
}

/** The demo's measurements; each record is also `console.table`d when taken. */
export function PerfPanel({ paints, scrolls, elements }: PerfPanelProps) {
  return (
    <aside
      aria-label="Measurements"
      className="flex w-80 shrink-0 flex-col gap-3 overflow-auto border-l p-3 text-xs"
    >
      <p>
        Mounted elements: <output>{elements}</output>
      </p>
      <table className="w-full text-left tabular-nums">
        <caption className="text-left font-medium">Paints (ms)</caption>
        <thead>
          <tr>
            <th>What</th>
            <th>layout</th>
            <th>commit</th>
            <th>frame</th>
            <th>total</th>
            <th>sys</th>
          </tr>
        </thead>
        <tbody>
          {paints.map((paint, index) => (
            <tr key={index}>
              <td>{paint.label}</td>
              <td>{ms(paint.layoutMs)}</td>
              <td>{ms(paint.commitMs)}</td>
              <td>{ms(paint.frameMs)}</td>
              <td>{ms(paint.totalMs)}</td>
              <td>{paint.changedSystems ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <table className="w-full text-left tabular-nums">
        <caption className="text-left font-medium">Auto-scroll</caption>
        <thead>
          <tr>
            <th>Run</th>
            <th>fps</th>
            <th>p95 ms</th>
            <th>&gt;20 ms</th>
            <th>els</th>
          </tr>
        </thead>
        <tbody>
          {scrolls.map((scroll, index) => (
            <tr key={index}>
              <td>{scroll.label}</td>
              <td>{scroll.meanFps.toFixed(1)}</td>
              <td>{ms(scroll.p95Ms)}</td>
              <td>
                {scroll.over20Ms}/{scroll.frames}
              </td>
              <td>{scroll.elements}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </aside>
  );
}

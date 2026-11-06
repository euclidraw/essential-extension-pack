import type { WireProps, WireDerivedGeometry } from './types';

export function renderWireSvg(
  props: Readonly<WireProps>,
  derived: WireDerivedGeometry | undefined,
): { svg: string } {
  if (!derived || derived.points.length < 2) return { svg: '' };

  const points = derived.points;
  const d = derived.path ?? points.map((point, index) => `${index ? 'L' : 'M'}${point.x},${point.y}`).join(' ');
  const end = points.at(-1)!;
  let dx = derived.endTangent?.x ?? NaN, dy = derived.endTangent?.y ?? NaN;
  let length = Math.hypot(dx, dy);
  if (!Number.isFinite(length) || length < 1e-9) {
    length = 0;
    for (let index = points.length - 2; index >= 0; index--) {
      dx = end.x - points[index].x; dy = end.y - points[index].y;
      const candidate = Math.hypot(dx, dy);
      if (Number.isFinite(candidate) && candidate >= 1e-9) { length = candidate; break; }
    }
  }
  const ux = length ? dx / length : 0, uy = length ? dy / length : 0;
  const bx = end.x - ux * 7, by = end.y - uy * 7;
  const arrow = length ? `<path d="M${bx + uy * 4},${by - ux * 4}L${end.x},${end.y}L${bx - uy * 4},${by + ux * 4}" fill="none" stroke="#008FF0" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>` : '';
  return {
    svg: `<g><path d="${d}" fill="none" stroke="#008FF0" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>${arrow}</g>`,
  };
}

import { bodyObstacleFromBounds, inside, segmentAvoidsObstacles, type Obstacle } from './routing';
import { cubicAvoidsObstacles } from './curves';
import type { EntityPort, LayoutBounds, Point } from './types';

interface LocalRect { minX: number; minY: number; maxX: number; maxY: number }
export interface EndpointClearance {
  readonly obstacles: readonly Obstacle[];
  readonly halo: Obstacle;
  readonly margin: number;
  readonly clearCurve: (controls: readonly Point[]) => boolean;
}

/** Remove only a port's outward access channel; the actual body is never exempted. */
function subtract(rect: LocalRect, notch: LocalRect): LocalRect[] {
  const minX = Math.max(rect.minX, notch.minX), maxX = Math.min(rect.maxX, notch.maxX);
  const minY = Math.max(rect.minY, notch.minY), maxY = Math.min(rect.maxY, notch.maxY);
  if (minX >= maxX || minY >= maxY) return [rect];
  return [
    { minX: rect.minX, minY: rect.minY, maxX: minX, maxY: rect.maxY },
    { minX: maxX, minY: rect.minY, maxX: rect.maxX, maxY: rect.maxY },
    { minX, minY: rect.minY, maxX, maxY: minY },
    { minX, minY: maxY, maxX, maxY: rect.maxY },
  ].filter(piece => piece.maxX - piece.minX > 1e-7 && piece.maxY - piece.minY > 1e-7);
}

/** A preferred halo with narrow normal-aligned portals, represented by exact rotated rectangles. */
export function endpointClearance(bounds: LayoutBounds, ports: readonly EntityPort[], margin: number): EndpointClearance {
  const body = bodyObstacleFromBounds(bounds), r = body.rect!;
  const halfWidth = bounds.width / 2, halfHeight = bounds.height / 2;
  const local = (point: Point): Point => {
    const dx = point.x - r.cx, dy = point.y - r.cy;
    return { x: dx * r.cos + dy * r.sin, y: -dx * r.sin + dy * r.cos };
  };
  const envelope = { minX: -halfWidth - margin, minY: -halfHeight - margin, maxX: halfWidth + margin, maxY: halfHeight + margin };
  let rectangles: LocalRect[] = [envelope];
  if (margin > 0) for (const port of ports) {
    const p = local(port), width = Math.min(6, Math.max(1, margin / 2));
    let notch: LocalRect;
    if (port.side === 'east') notch = { minX: halfWidth, maxX: halfWidth + margin, minY: p.y - width, maxY: p.y + width };
    else if (port.side === 'west') notch = { minX: -halfWidth - margin, maxX: -halfWidth, minY: p.y - width, maxY: p.y + width };
    else if (port.side === 'north') notch = { minX: p.x - width, maxX: p.x + width, minY: -halfHeight - margin, maxY: -halfHeight };
    else notch = { minX: p.x - width, maxX: p.x + width, minY: halfHeight, maxY: halfHeight + margin };
    rectangles = rectangles.flatMap(rect => subtract(rect, notch));
  }
  // Keep a separate hard body even when floating-point portal subtraction meets a corner.
  if (margin > 0) rectangles.push({ minX: -halfWidth, minY: -halfHeight, maxX: halfWidth, maxY: halfHeight });
  const world = (rect: LocalRect): Obstacle => {
    const x = rect.minX / 2 + rect.maxX / 2, y = rect.minY / 2 + rect.maxY / 2;
    const cx = r.cx + x * r.cos - y * r.sin, cy = r.cy + x * r.sin + y * r.cos;
    const hw = (rect.maxX - rect.minX) / 2, hh = (rect.maxY - rect.minY) / 2;
    const extentX = Math.abs(r.cos) * hw + Math.abs(r.sin) * hh, extentY = Math.abs(r.sin) * hw + Math.abs(r.cos) * hh;
    return { minX: cx - extentX, minY: cy - extentY, maxX: cx + extentX, maxY: cy + extentY, rect: { cx, cy, cos: r.cos, sin: r.sin, halfWidth: hw, halfHeight: hh } };
  };
  return { obstacles: rectangles.map(world), halo: world(envelope), margin, clearCurve: controls => cubicAvoidsObstacles(controls.map(local), rectangles) };
}

/** After leaving the source halo (or, backwards, the target halo), never enter it again. */
export function respectsEndpointAccess(points: readonly Point[], endpoint: EndpointClearance, reverse = false, allowFinalReturn = false): boolean {
  if (!endpoint.margin || points.length < 2) return true;
  let phase = 0;
  const halo = [endpoint.halo];
  for (let offset = 1; offset < points.length; offset++) {
    const before = points[reverse ? points.length - offset : offset - 1];
    const point = points[reverse ? points.length - offset - 1 : offset];
    const within = inside(point, endpoint.halo);
    if (phase === 1 && !segmentAvoidsObstacles(before, point, halo)) {
      if (!allowFinalReturn || !within) return false;
      phase = 2;
    }
    if (phase === 2 && !within) return false;
    if (phase === 0 && !within) phase = 1;
  }
  return true;
}

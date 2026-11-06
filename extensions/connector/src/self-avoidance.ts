import type { Point } from './types';

const EPS = 1e-7;
const finite = (point: Point): boolean => Number.isFinite(point.x) && Number.isFinite(point.y);
const samePoint = (a: Point, b: Point): boolean => Math.hypot(a.x - b.x, a.y - b.y) <= EPS;

function onSegment(point: Point, a: Point, b: Point, length: number): boolean {
  if (length <= EPS) return samePoint(point, a);
  const ux = (b.x - a.x) / length, uy = (b.y - a.y) / length;
  const dx = point.x - a.x, dy = point.y - a.y;
  const along = dx * ux + dy * uy;
  return Math.abs(dx * uy - dy * ux) <= EPS && along >= -EPS && along <= length + EPS;
}

/** Crossings, touches and positive-length overlaps conflict, including degenerate points. */
export function segmentsConflict(a: Point, b: Point, c: Point, d: Point, allowSharedEndpoint = false): boolean {
  if (!finite(a) || !finite(b) || !finite(c) || !finite(d)) return true;
  if (Math.max(a.x, b.x) < Math.min(c.x, d.x) - EPS || Math.max(c.x, d.x) < Math.min(a.x, b.x) - EPS || Math.max(a.y, b.y) < Math.min(c.y, d.y) - EPS || Math.max(c.y, d.y) < Math.min(a.y, b.y) - EPS) return false;
  const ab = Math.hypot(b.x - a.x, b.y - a.y), cd = Math.hypot(d.x - c.x, d.y - c.y);
  if (!Number.isFinite(ab) || !Number.isFinite(cd)) return true;
  if (ab > EPS && cd > EPS) {
    const ux = (b.x - a.x) / ab, uy = (b.y - a.y) / ab, vx = (d.x - c.x) / cd, vy = (d.y - c.y) / cd;
    const sideC = (c.x - a.x) * uy - (c.y - a.y) * ux, sideD = (d.x - a.x) * uy - (d.y - a.y) * ux;
    const sideA = (a.x - c.x) * vy - (a.y - c.y) * vx, sideB = (b.x - c.x) * vy - (b.y - c.y) * vx;
    if (((sideC > EPS && sideD < -EPS) || (sideC < -EPS && sideD > EPS)) && ((sideA > EPS && sideB < -EPS) || (sideA < -EPS && sideB > EPS))) return true;
  }
  const cOnAB = onSegment(c, a, b, ab), dOnAB = onSegment(d, a, b, ab), aOnCD = onSegment(a, c, d, cd), bOnCD = onSegment(b, c, d, cd);
  if (!cOnAB && !dOnAB && !aOnCD && !bOnCD) return false;
  if (!allowSharedEndpoint) return true;
  const shared = samePoint(a, c) || samePoint(a, d) ? a : samePoint(b, c) || samePoint(b, d) ? b : undefined;
  if (!shared) return true;
  // A collinear overlap has another contact away from the sole permitted endpoint.
  return cOnAB && !samePoint(c, shared) || dOnAB && !samePoint(d, shared) || aOnCD && !samePoint(a, shared) || bOnCD && !samePoint(b, shared);
}

function distinct(points: readonly Point[]): Point[] | undefined {
  const result: Point[] = [];
  for (const point of points) {
    if (!finite(point)) return undefined;
    if (!result.length || !samePoint(result[result.length - 1], point)) result.push(point);
  }
  return result;
}

/** Adjacent corners may meet; a reversal or any nonadjacent contact is rejected. */
export function isSimplePolyline(points: readonly Point[]): boolean {
  const vertices = distinct(points);
  if (!vertices) return false;
  for (let i = 0; i + 1 < vertices.length; i++) {
    for (let j = i + 1; j + 1 < vertices.length; j++) {
      if (segmentsConflict(vertices[i], vertices[i + 1], vertices[j], vertices[j + 1], j === i + 1)) return false;
    }
  }
  return true;
}

function pointSegmentDistance(point: Point, a: Point, b: Point): number {
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  if (length <= EPS) return Math.hypot(point.x - a.x, point.y - a.y);
  const ux = (b.x - a.x) / length, uy = (b.y - a.y) / length;
  const along = Math.max(0, Math.min(length, (point.x - a.x) * ux + (point.y - a.y) * uy));
  return Math.hypot(point.x - (a.x + ux * along), point.y - (a.y + uy * along));
}

/** Worst local clearance deficit, bounded by preferred and independent of the sample count. */
export function selfClearancePenalty(points: readonly Point[], preferred = 8): number {
  if (!Number.isFinite(preferred) || preferred <= 0) return 0;
  const vertices = distinct(points);
  if (!vertices) return Infinity;
  if (vertices.length < 4) return 0;
  const arc = [0];
  for (let i = 1; i < vertices.length; i++) {
    const distance = Math.hypot(vertices[i].x - vertices[i - 1].x, vertices[i].y - vertices[i - 1].y);
    if (!Number.isFinite(distance) || !Number.isFinite(arc[i - 1] + distance)) return Infinity;
    arc.push(arc[i - 1] + distance);
  }
  let closest = preferred;
  for (let i = 0; i + 1 < vertices.length; i++) {
    const a = vertices[i], b = vertices[i + 1], middle = arc[i] / 2 + arc[i + 1] / 2;
    for (let j = i + 2; j + 1 < vertices.length; j++) {
      // Nearby curve samples describe the same local stroke, rather than a return segment.
      if (arc[j] / 2 + arc[j + 1] / 2 - middle < 2 * preferred) continue;
      const c = vertices[j], d = vertices[j + 1];
      const dx = Math.max(Math.min(a.x, b.x) - Math.max(c.x, d.x), Math.min(c.x, d.x) - Math.max(a.x, b.x), 0);
      const dy = Math.max(Math.min(a.y, b.y) - Math.max(c.y, d.y), Math.min(c.y, d.y) - Math.max(a.y, b.y), 0);
      if (Math.hypot(dx, dy) >= closest) continue;
      const distance = segmentsConflict(a, b, c, d) ? 0 : Math.min(pointSegmentDistance(a, c, d), pointSegmentDistance(b, c, d), pointSegmentDistance(c, a, b), pointSegmentDistance(d, a, b));
      closest = Math.min(closest, distance);
      if (closest <= EPS) return preferred;
    }
  }
  return preferred * (1 - closest / preferred) ** 2;
}

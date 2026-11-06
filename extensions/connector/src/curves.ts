import type { EntityPort, Point } from './types';
import { finitePoint, inside, midpoint, type Obstacle } from './routing';
import { isSimplePolyline, segmentsConflict } from './self-avoidance';

export interface CurveGeometry { points: Point[]; path: string }
export type CurveCheck = (controls: readonly Point[]) => boolean;
export const MAX_CURVE_POINTS = 512;
const half = (a: Point, b: Point): Point => ({ x: midpoint(a.x, b.x), y: midpoint(a.y, b.y) });
function split(c: readonly Point[]): [Point[], Point[]] {
  const a = half(c[0], c[1]), b = half(c[1], c[2]), d = half(c[2], c[3]), e = half(a, b), f = half(b, d), m = half(e, f);
  return [[c[0], a, e, m], [m, f, d, c[3]]];
}

const SELF_EPS = 1e-10;
const cross = (a: Point, b: Point): number => a.x * b.y - a.y * b.x;
function normalized(points: readonly Point[]): { points: Point[]; scale: number } | undefined {
  if (!points.length || !points.every(finitePoint)) return undefined;
  const origin = points[0];
  const scale = Math.max(...points.map(p => Math.max(Math.abs(p.x - origin.x), Math.abs(p.y - origin.y))));
  if (!Number.isFinite(scale) || scale === 0) return undefined;
  return { points: points.map(p => ({ x: (p.x - origin.x) / scale, y: (p.y - origin.y) / scale })), scale };
}
function roots(a: number, b: number, c: number): number[] {
  if (Math.abs(a) < 1e-12) return Math.abs(b) < 1e-12 ? [] : [-c / b];
  const discriminant = b * b - 4 * a * c;
  if (discriminant < -1e-12) return [];
  const square = Math.sqrt(Math.max(0, discriminant));
  const q = -0.5 * (b + (b < 0 ? -square : square));
  return q === 0 ? [-b / (2 * a)] : [q / a, c / q];
}

/** Analytic cubic double-point test, plus conservative rejection of interior stationary cusps/retracing. */
export function cubicIsSimple(controls: readonly Point[]): boolean {
  if (controls.length !== 4) return false;
  const values = normalized(controls); if (!values) return false;
  const [p, q, r, s] = values.points;
  if (Math.hypot(s.x - p.x, s.y - p.y) <= SELF_EPS) return false;
  const a = { x: -p.x + 3 * q.x - 3 * r.x + s.x, y: -p.y + 3 * q.y - 3 * r.y + s.y };
  const b = { x: 3 * p.x - 6 * q.x + 3 * r.x, y: 3 * p.y - 6 * q.y + 3 * r.y };
  const c = { x: 3 * (q.x - p.x), y: 3 * (q.y - p.y) };
  const candidates = [...roots(3 * a.x, 2 * b.x, c.x), ...roots(3 * a.y, 2 * b.y, c.y)];
  for (const t of candidates) {
    if (t > SELF_EPS && t < 1 - SELF_EPS && Math.hypot(3 * a.x * t * t + 2 * b.x * t + c.x, 3 * a.y * t * t + 2 * b.y * t + c.y) <= 1e-8) return false;
  }
  // B(t)=B(u), t!=u gives a*(sum²-product)+b*sum+c=0.
  const denominator = cross(a, b);
  if (Math.abs(denominator) > 1e-12) {
    const sum = -cross(a, c) / denominator;
    const component = Math.abs(a.x) >= Math.abs(a.y) ? 'x' : 'y';
    const squareMinusProduct = -(b[component] * sum + c[component]) / a[component];
    const discriminant = 4 * squareMinusProduct - 3 * sum * sum;
    if (!Number.isFinite(sum) || !Number.isFinite(discriminant)) return false;
    if (discriminant >= -1e-12) {
      const distance = Math.sqrt(Math.max(0, discriminant)), first = (sum - distance) / 2, last = (sum + distance) / 2;
      if (first >= -SELF_EPS && last <= 1 + SELF_EPS && last > SELF_EPS && first < 1 - SELF_EPS) return false;
    }
  } else if (Math.abs(cross(a, c)) <= 1e-12) {
    // Nearly degenerate elimination is not evidence of safety. A monotone
    // coordinate still proves injectivity; otherwise leave it to a sharp route.
    const monotone = (axis: 'x' | 'y') => {
      const values = [c[axis], 3 * a[axis] + 2 * b[axis] + c[axis]];
      if (Math.abs(a[axis]) > 1e-12) { const t = -b[axis] / (3 * a[axis]); if (t > 0 && t < 1) values.push(3 * a[axis] * t * t + 2 * b[axis] * t + c[axis]); }
      return Math.min(...values) > 1e-10 || Math.max(...values) < -1e-10;
    };
    if (!monotone('x') && !monotone('y')) return false;
  }
  return true;
}

function splitHull(controls: readonly Point[]): [Point[], Point[]] {
  let level = [...controls]; const left = [level[0]], right = [level.at(-1)!];
  while (level.length > 1) { level = level.slice(1).map((p, i) => half(level[i], p)); left.push(level[0]); right.push(level.at(-1)!); }
  return [left, right.reverse()];
}
function quadraticIsSimple(c: readonly Point[]): boolean {
  const n = normalized(c); if (!n) return false;
  const [a, b, d] = n.points, x = d.x - 2 * b.x + a.x, y = d.y - 2 * b.y + a.y;
  const t = Math.abs(x) >= Math.abs(y) ? (a.x - b.x) / x : (a.y - b.y) / y;
  return !Number.isFinite(t) || t <= SELF_EPS || t >= 1 - SELF_EPS || Math.hypot(b.x - a.x + t * x, b.y - a.y + t * y) > 1e-8;
}
function axes(a: readonly Point[], b: readonly Point[]): Point[] {
  const result = [{ x: 1, y: 0 }, { x: 0, y: 1 }];
  for (const controls of [a, b]) for (let i = 0; i < controls.length; i++) {
    const next = controls[(i + 1) % controls.length], dx = next.x - controls[i].x, dy = next.y - controls[i].y, length = Math.hypot(dx, dy);
    if (length > 1e-14) { result.push({ x: -dy / length, y: dx / length }, { x: dx / length, y: dy / length }); }
  }
  return result;
}
function hullsClear(a: readonly Point[], b: readonly Point[], join?: Point): boolean {
  const scale = normalized([...a, ...b, ...(join ? [join] : [])]); if (!scale) return false;
  const first = scale.points.slice(0, a.length), second = scale.points.slice(a.length, a.length + b.length), shared = join ? scale.points.at(-1)! : undefined;
  for (const axis of axes(first, second)) {
    const av = first.map(p => p.x * axis.x + p.y * axis.y), bv = second.map(p => p.x * axis.x + p.y * axis.y);
    const lowA = Math.min(...av), highA = Math.max(...av), lowB = Math.min(...bv), highB = Math.max(...bv);
    if (highA < lowB - 1e-12 || highB < lowA - 1e-12) return true;
    if (shared && Math.hypot(a.at(-1)!.x - join!.x, a.at(-1)!.y - join!.y) <= 1e-7 && Math.hypot(b[0].x - join!.x, b[0].y - join!.y) <= 1e-7) {
      const center = shared.x * axis.x + shared.y * axis.y;
      // Positive Bernstein weights put both open curves strictly on opposite
      // sides of this support plane; only their known endpoint may meet.
      if (highA <= center + 1e-12 && lowB >= center - 1e-12 && lowA < center - 1e-12 && highB > center + 1e-12 || highB <= center + 1e-12 && lowA >= center - 1e-12 && lowB < center - 1e-12 && highA > center + 1e-12) return true;
    }
  }
  return false;
}

/** Exact SVG line/quadratic pieces, proved disjoint by bounded control-hull subdivision. */
export function roundedSvgIsSimple(pieces: readonly (readonly Point[])[]): boolean {
  if (!pieces.length || pieces.length > MAX_CURVE_POINTS * 2 || pieces.some(c => (c.length !== 2 && c.length !== 3) || !c.every(finitePoint) || !Number.isFinite(Math.hypot(c.at(-1)!.x - c[0].x, c.at(-1)!.y - c[0].y)) || c.length === 3 && !quadraticIsSimple(c))) return false;
  let remaining = 8192;
  const clear = (a: readonly Point[], b: readonly Point[], join: Point | undefined, depth: number): boolean => {
    for (const first of [a[0], a.at(-1)!]) for (const last of [b[0], b.at(-1)!]) if (Math.hypot(first.x - last.x, first.y - last.y) <= 1e-7 && (!join || Math.hypot(first.x - join.x, first.y - join.y) > 1e-7 || Math.hypot(last.x - join.x, last.y - join.y) > 1e-7)) return false;
    if (a.length === 2 && b.length === 2) return !segmentsConflict(a[0], a[1], b[0], b[1], !!join);
    if (hullsClear(a, b, join)) return true;
    if (--remaining < 0 || depth >= 18) return false;
    const extent = (c: readonly Point[]) => Math.max(Math.max(...c.map(p => p.x)) - Math.min(...c.map(p => p.x)), Math.max(...c.map(p => p.y)) - Math.min(...c.map(p => p.y)));
    if (extent(a) >= extent(b)) { const [left, right] = splitHull(a); return clear(left, b, join, depth + 1) && clear(right, b, join, depth + 1); }
    const [left, right] = splitHull(b); return clear(a, left, join, depth + 1) && clear(a, right, join, depth + 1);
  };
  for (let i = 0; i < pieces.length; i++) {
    if (i && Math.hypot(pieces[i - 1].at(-1)!.x - pieces[i][0].x, pieces[i - 1].at(-1)!.y - pieces[i][0].y) > 1e-7) return false;
    for (let j = i + 1; j < pieces.length; j++) if (!clear(pieces[i], pieces[j], j === i + 1 ? pieces[i].at(-1)! : undefined, 0)) return false;
  }
  return true;
}

/** A control-hull proof, not a test of a fixed number of sampled points. */
export function cubicAvoidsObstacles(controls: readonly Point[], obstacles: readonly Obstacle[]): boolean {
  if (!controls.every(finitePoint)) return false;
  const clear = (c: readonly Point[], box: Obstacle, depth: number): boolean => {
    const minX = Math.min(...c.map(p => p.x)), maxX = Math.max(...c.map(p => p.x));
    const minY = Math.min(...c.map(p => p.y)), maxY = Math.max(...c.map(p => p.y));
    if (maxX <= box.minX + 1e-7 || minX >= box.maxX - 1e-7 || maxY <= box.minY + 1e-7 || minY >= box.maxY - 1e-7) return true;
    if (inside(c[0], box) || inside(c[3], box)) return false;
    if (depth === 22) return false; // Unresolved contact is conservatively blocked.
    const [left, right] = split(c);
    return clear(left, box, depth + 1) && clear(right, box, depth + 1);
  };
  const minX = Math.min(controls[0].x, controls[1].x, controls[2].x, controls[3].x), maxX = Math.max(controls[0].x, controls[1].x, controls[2].x, controls[3].x);
  const minY = Math.min(controls[0].y, controls[1].y, controls[2].y, controls[3].y), maxY = Math.max(controls[0].y, controls[1].y, controls[2].y, controls[3].y);
  for (const box of obstacles) {
    if (maxX <= box.minX || minX >= box.maxX || maxY <= box.minY || minY >= box.maxY) continue;
    if (!clear(controls, box, 0)) return false;
  }
  return true;
}

// Directional control-offset rule adapted from xyflow's MIT-licensed bezier-edge.ts.
// See NOTICE and docs/connector-routing.md for the pinned source.
export function bezierControl(port: EntityPort, other: Point): Point {
  const projected = (other.x - port.x) * port.nx + (other.y - port.y) * port.ny;
  const offset = projected >= 0 ? projected / 2 : 6.25 * Math.sqrt(-projected);
  return { x: port.x + port.nx * Math.max(1e-4, offset), y: port.y + port.ny * Math.max(1e-4, offset) };
}
function pointAt(c: readonly Point[], t: number): Point {
  const s = 1 - t;
  return { x: s ** 3 * c[0].x + 3 * s * s * t * c[1].x + 3 * s * t * t * c[2].x + t ** 3 * c[3].x, y: s ** 3 * c[0].y + 3 * s * s * t * c[1].y + 3 * s * t * t * c[2].y + t ** 3 * c[3].y };
}
function flatness(c: readonly Point[]): number {
  const dx = c[3].x - c[0].x, dy = c[3].y - c[0].y, length = Math.hypot(dx, dy);
  if (length < 1e-12) return Math.max(Math.hypot(c[1].x - c[0].x, c[1].y - c[0].y), Math.hypot(c[2].x - c[0].x, c[2].y - c[0].y));
  return Math.max(Math.abs((c[1].x - c[0].x) * dy - (c[1].y - c[0].y) * dx), Math.abs((c[2].x - c[0].x) * dy - (c[2].y - c[0].y) * dx)) / length;
}
/** At least 32 intervals, refined until the control hull is within 1/8 world pixel. */
function sampleCubic(c: readonly Point[], intervals = 32): Point[] | undefined {
  const points: Point[] = [c[0]]; let exceeded = false;
  const append = (part: readonly Point[], depth: number) => {
    if (exceeded) return;
    if (points.length >= MAX_CURVE_POINTS) { exceeded = true; return; }
    if (flatness(part) <= 0.125) { points.push(part[3]); return; }
    if (depth === 10) { exceeded = true; return; }
    const [a, b] = split(part); append(a, depth + 1); append(b, depth + 1);
  };
  const derivative = (t: number): Point => { const s = 1 - t; return { x: 3 * s * s * (c[1].x - c[0].x) + 6 * s * t * (c[2].x - c[1].x) + 3 * t * t * (c[3].x - c[2].x), y: 3 * s * s * (c[1].y - c[0].y) + 6 * s * t * (c[2].y - c[1].y) + 3 * t * t * (c[3].y - c[2].y) }; };
  for (let i = 0; i < intervals; i++) {
    if (exceeded) break;
    const t = i / intervals, u = (i + 1) / intervals, a = pointAt(c, t), b = pointAt(c, u), da = derivative(t), db = derivative(u);
    append([a, { x: a.x + da.x / (3 * intervals), y: a.y + da.y / (3 * intervals) }, { x: b.x - db.x / (3 * intervals), y: b.y - db.y / (3 * intervals) }, b], 0);
  }
  if (exceeded) return undefined;
  points[0] = c[0]; points[points.length - 1] = c[3];
  return points;
}
export function cubicGeometry(c: readonly Point[]): CurveGeometry | undefined {
  if (!cubicIsSimple(c)) return undefined;
  const points = sampleCubic(c); if (!points) return undefined;
  return { points, path: `M${c[0].x},${c[0].y} C${c[1].x},${c[1].y} ${c[2].x},${c[2].y} ${c[3].x},${c[3].y}` };
}
export function polylineGeometry(points: Point[]): CurveGeometry {
  return { points, path: points.map((point, index) => `${index ? 'L' : 'M'}${point.x},${point.y}`).join(' ') };
}
/** Rounded detours keep the same checked shape for SVG and GPU tessellation. */
export function roundedGeometry(route: Point[], clear: CurveCheck, maxRadius = 9): CurveGeometry {
  if (route.length < 2 || route.length > MAX_CURVE_POINTS || !isSimplePolyline(route)) return { points: [], path: '' };
  const fallback = () => polylineGeometry(route);
  const pieces: Point[][] = []; let cursor = route[0];
  const line = (end: Point) => { if (Math.hypot(end.x - cursor.x, end.y - cursor.y) > 1e-7) pieces.push([cursor, end]); cursor = end; };
  const points: Point[] = [route[0]];
  let path = `M${route[0].x},${route[0].y}`;
  for (let i = 1; i < route.length - 1; i++) {
    const before = route[i - 1], corner = route[i], after = route[i + 1];
    const incoming = Math.hypot(corner.x - before.x, corner.y - before.y), outgoing = Math.hypot(after.x - corner.x, after.y - corner.y);
    const cross = (corner.x - before.x) * (after.y - corner.y) - (corner.y - before.y) * (after.x - corner.x);
    if (Math.abs(cross) < 1e-7) { path += ` L${corner.x},${corner.y}`; points.push(corner); line(corner); continue; }
    let radius = Math.min(maxRadius, incoming / 2, outgoing / 2), accepted = false;
    let a = corner, b = corner;
    for (let attempt = 0; attempt < 12 && radius > 1e-4; attempt++, radius /= 2) {
      a = { x: corner.x + (before.x - corner.x) * radius / incoming, y: corner.y + (before.y - corner.y) * radius / incoming };
      b = { x: corner.x + (after.x - corner.x) * radius / outgoing, y: corner.y + (after.y - corner.y) * radius / outgoing };
      const cubic = [a, { x: a.x / 3 + corner.x * 2 / 3, y: a.y / 3 + corner.y * 2 / 3 }, { x: b.x / 3 + corner.x * 2 / 3, y: b.y / 3 + corner.y * 2 / 3 }, b];
      if (!clear(cubic)) continue;
      const samples = sampleCubic(cubic, 4); if (!samples) continue;
      path += ` L${a.x},${a.y} Q${corner.x},${corner.y} ${b.x},${b.y}`;
      if (points.length + samples.length > MAX_CURVE_POINTS - 1) return fallback();
      line(a); pieces.push([a, corner, b]); cursor = b;
      points.push(a, ...samples.slice(1)); accepted = true; break;
    }
    if (!accepted) { path += ` L${corner.x},${corner.y}`; points.push(corner); line(corner); }
  }
  const end = route.at(-1)!; path += ` L${end.x},${end.y}`; points.push(end); line(end);
  if (!roundedSvgIsSimple(pieces)) return fallback();
  return { points, path };
}

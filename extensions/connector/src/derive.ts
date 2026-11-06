import type { ComputedReadView, EntityId } from '@alid/kernel';
import { getEntityLayoutBounds, getEntityPorts } from './ports';
import { finitePoint, obstacleFromBounds, bodyObstacleFromBounds, routeOrthogonal, segmentAvoidsObstacles, simplify, type Obstacle } from './routing';
import { bezierControl, cubicAvoidsObstacles, cubicGeometry, polylineGeometry, roundedGeometry, MAX_CURVE_POINTS, type CurveCheck } from './curves';
import { endpointClearance, respectsEndpointAccess } from './endpoint-clearance';
import { isSimplePolyline, selfClearancePenalty } from './self-avoidance';
import type { EntityPort, WireProps, Point, WireDerivedGeometry } from './types';

function facingPenalty(from: EntityPort, to: EntityPort): number {
  const dx = to.x - from.x, dy = to.y - from.y;
  return (Math.max(0, -(from.nx * dx + from.ny * dy)) + Math.max(0, to.nx * dx + to.ny * dy)) * 0.7;
}
function boxDistance(point: Point, box: Obstacle): number {
  return Math.max(box.minX - point.x, point.x - box.maxX, box.minY - point.y, point.y - box.maxY, 0);
}
function firstHit(port: EntityPort, box: Obstacle): number {
  let x = port.x, y = port.y, nx = port.nx, ny = port.ny;
  let minX = box.minX, maxX = box.maxX, minY = box.minY, maxY = box.maxY;
  if (box.rect) {
    const r = box.rect, dx = x - r.cx, dy = y - r.cy;
    x = dx * r.cos + dy * r.sin; y = -dx * r.sin + dy * r.cos;
    nx = port.nx * r.cos + port.ny * r.sin; ny = -port.nx * r.sin + port.ny * r.cos;
    minX = -r.halfWidth; maxX = r.halfWidth; minY = -r.halfHeight; maxY = r.halfHeight;
  }
  let enter = -Infinity, exit = Infinity;
  if (Math.abs(nx) < 1e-12) { if (x <= minX || x >= maxX) return Infinity; }
  else { const a = (minX - x) / nx, b = (maxX - x) / nx; enter = Math.max(enter, Math.min(a, b)); exit = Math.min(exit, Math.max(a, b)); }
  if (Math.abs(ny) < 1e-12) { if (y <= minY || y >= maxY) return Infinity; }
  else { const a = (minY - y) / ny, b = (maxY - y) / ny; enter = Math.max(enter, Math.min(a, b)); exit = Math.min(exit, Math.max(a, b)); }
  return enter < exit && exit > 1e-7 ? Math.max(0, enter) : Infinity;
}
/** Follow the actual rotated normal, shortening the escape before nearby bodies. */
function escape(port: EntityPort, desired: number, obstacles: readonly Obstacle[]): Point | undefined {
  let distance = Math.max(desired, 1e-4);
  for (const box of obstacles) distance = Math.min(distance, firstHit(port, box) / 2);
  const point = { x: port.x + port.nx * distance, y: port.y + port.ny * distance };
  if (!Number.isFinite(distance) || distance <= 1e-7 || !finitePoint(point) || Math.hypot(point.x - port.x, point.y - port.y) < 1e-7 || !segmentAvoidsObstacles(port, point, obstacles)) return undefined;
  return point;
}
function routeCost(points: readonly Point[], countBends: boolean): number {
  let cost = 0;
  for (let i = 1; i < points.length; i++) {
    cost += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    if (countBends && i > 1) { const a = points[i - 2], b = points[i - 1], c = points[i]; if (Math.abs((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)) > 1e-7) cost += 12; }
  }
  return cost;
}

/** Default and upper bound of `cornerRadius` for orthogonal routes, in world units. */
export const WIRE_DEFAULT_CORNER_RADIUS = 8;
export const WIRE_MAX_CORNER_RADIUS = 48;
const BEZIER_DETOUR_RADIUS = 9;

/** Invalid or missing values fall back to the default; corners never exceed half of a neighbouring segment. */
export function wireCornerRadius(props: Readonly<WireProps>): number {
  const value = props.cornerRadius;
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.min(value, WIRE_MAX_CORNER_RADIUS) : WIRE_DEFAULT_CORNER_RADIUS;
}

export function deriveWire(props: Readonly<WireProps>, _id: EntityId, view: ComputedReadView): WireDerivedGeometry {
  if (!props.from || !props.to) return { points: [] };
  const radiusLimit = wireCornerRadius(props);
  const sourceBounds = getEntityLayoutBounds(props.from, view), targetBounds = getEntityLayoutBounds(props.to, view);
  if (!sourceBounds || !targetBounds) return { points: [] };
  const sourcePorts = getEntityPorts(props.from, view), targetPorts = getEntityPorts(props.to, view);
  // Explicit port IDs are user intent; a removed/disabled port must not silently reconnect elsewhere.
  const sources = props.fromPort != null ? sourcePorts.filter(p => p.id === props.fromPort) : sourcePorts;
  const targets = props.toPort != null ? targetPorts.filter(p => p.id === props.toPort) : targetPorts;
  if (!sources.length || !targets.length) return { points: [] };
  const sourceBox = bodyObstacleFromBounds(sourceBounds), targetBox = bodyObstacleFromBounds(targetBounds);
  if (![sourceBox, targetBox].every(box => [box.minX, box.minY, box.maxX, box.maxY].every(Number.isFinite))) return { points: [] };
  const scene = view as ComputedReadView & { listEntityIds?(): readonly EntityId[] };
  const otherBoxes: Obstacle[] = [];
  for (const id of [...(scene.listEntityIds?.() ?? [])].sort()) {
    if (id === props.from || id === props.to || !view.isAlive(id)) continue;
    const bounds = getEntityLayoutBounds(id, view);
    if (bounds) { const box = obstacleFromBounds(bounds, 0); if ([box.minX, box.minY, box.maxX, box.maxY].every(Number.isFinite)) otherBoxes.push(box); }
  }
  const padded = otherBoxes.map(box => ({ minX: box.minX - 12, minY: box.minY - 12, maxX: box.maxX + 12, maxY: box.maxY + 12 }));
  const pairs = sources.flatMap(from => targets.filter(to => props.from !== props.to || from.id !== to.id).map(to => ({ from, to, lower: Math.hypot(to.x - from.x, to.y - from.y) + facingPenalty(from, to) }))).filter(pair => Number.isFinite(pair.lower)).sort((a, b) => a.lower - b.lower);
  const baseJobs = pairs.map(pair => {
    const { from, to } = pair;
    const obstacles = otherBoxes.map((box, i) => {
      const padding = Math.min(12, boxDistance(from, box) / 2, boxDistance(to, box) / 2);
      return padding === 12 ? padded[i] : { minX: box.minX - padding, minY: box.minY - padding, maxX: box.maxX + padding, maxY: box.maxY + padding };
    });
    const distance = Math.hypot(to.x - from.x, to.y - from.y);
    let stub = Math.max(18, Math.min(36, distance / 5));
    const projected = (to.x - from.x) * from.nx + (to.y - from.y) * from.ny;
    if (from.nx * to.nx + from.ny * to.ny < -0.9 && projected > 0) stub = Math.min(stub, projected / 3);
    const first = escape(from, stub, props.from === props.to ? obstacles : [...obstacles, targetBox]);
    const last = escape(to, stub, props.from === props.to ? obstacles : [...obstacles, sourceBox]);
    const margin = first && last ? Math.min(12, Math.hypot(first.x - from.x, first.y - from.y) * 0.75, Math.hypot(last.x - to.x, last.y - to.y) * 0.75) : 0;
    return { ...pair, obstacles, first, last, margin };
  });
  const budget = { states: 2048, checks: 65536 };
  // Prefer the largest feasible endpoint clearance before optimizing distance/bends.
  // The hard body and self-contact guards remain active even at zero preferred margin.
  for (const scale of [1, 0.5, 0]) {
    let best: WireDerivedGeometry = { points: [] }, bestCost = Infinity;
    const jobs = baseJobs.map(job => {
      const { from, to, obstacles } = job, margin = job.margin * scale;
      const source = endpointClearance(sourceBounds, props.from === props.to ? [from, to] : [from], margin);
      const target = props.from === props.to ? source : endpointClearance(targetBounds, [to], margin);
      const bodies = target === source ? source.obstacles : [...source.obstacles, ...target.obstacles];
      // Only the terminal leads may use portals. The middle sees whole halos,
      // keeping re-entry impossible and the search grid independent of portal cuts.
      const all = target === source ? [...obstacles, source.halo] : [...obstacles, source.halo, target.halo];
      const pathObstacles = [...obstacles, ...bodies];
      const clear: CurveCheck = c => cubicAvoidsObstacles(c, obstacles) && source.clearCurve(c) && (target === source || target.clearCurve(c));
      const sampledClear = (points: readonly Point[]) => points.every((point, index) => !index || segmentAvoidsObstacles(points[index - 1], point, pathObstacles))
        && respectsEndpointAccess(points, source, false, target === source) && (target === source || respectsEndpointAccess(points, target, true));
      return { ...job, all, clear, sampledClear, fastRouted: false };
    });
    // Find an inexpensive valid incumbent across all ports before spending any A* budget.
    for (let phase = 0; phase < 2; phase++) for (const job of jobs) {
      const { from, to, lower, all, clear, sampledClear, first, last } = job;
      if (lower > bestCost || phase === 1 && (job.fastRouted || budget.states <= 0 || budget.checks <= 0)) continue;
      let geometry, costPoints: readonly Point[] | undefined;
      if (phase === 0 && props.routing === 'bezier') {
        const controls = [{ x: from.x, y: from.y }, bezierControl(from, to), bezierControl(to, from), { x: to.x, y: to.y }];
        if (clear(controls)) { const curve = cubicGeometry(controls); if (curve && sampledClear(curve.points) && isSimplePolyline(curve.points)) geometry = curve; }
      }
      if (!geometry) {
        if (!first || !last) continue;
        const leadCost = Math.hypot(first.x - from.x, first.y - from.y) + Math.hypot(last.x - to.x, last.y - to.y);
        const middle = routeOrthogonal(first, last, all, { source: { x: from.nx, y: from.ny }, target: { x: to.nx, y: to.ny }, terminals: { source: from, target: to }, fastOnly: phase === 0, budget, maxCost: props.routing === 'bezier' ? Infinity : bestCost - facingPenalty(from, to) - leadCost });
        if (!middle.length) continue;
        const route = simplify([{ x: from.x, y: from.y }, ...middle, { x: to.x, y: to.y }]);
        if (route.length < 2 || !sampledClear(route) || !isSimplePolyline(route)) continue;
        const radius = props.routing === 'bezier' ? BEZIER_DETOUR_RADIUS : radiusLimit;
        geometry = radius > 0 ? roundedGeometry(route, clear, radius) : polylineGeometry(route);
        if (!sampledClear(geometry.points) || !isSimplePolyline(geometry.points)) geometry = polylineGeometry(route);
        // Rounded corners sample into many short segments; rank orthogonal routes by their corners.
        if (props.routing !== 'bezier') costPoints = route;
      }
      job.fastRouted = true;
      if (geometry.points.length > MAX_CURVE_POINTS || !geometry.points.every(finitePoint) || !geometry.path || /NaN|Infinity/.test(geometry.path)) continue;
      const cost = routeCost(costPoints ?? geometry.points, props.routing !== 'bezier') + facingPenalty(from, to) + selfClearancePenalty(geometry.points);
      if (cost < bestCost) { bestCost = cost; best = { ...geometry, fromPort: from, toPort: to, endTangent: { x: -to.nx, y: -to.ny } }; }
    }
    if (best.points.length) return best;
  }
  return { points: [] };
}

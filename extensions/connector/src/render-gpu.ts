import type { CanvasWorld, EntityId, GpuPolylineGeometry } from '@alid/kernel';
import { wireGpuArrowhead } from './render-defs';
import type { WireProps, WireDerivedGeometry } from './types';

const lines = new WeakMap<CanvasWorld, Map<EntityId, GpuPolylineGeometry>>();

/** Generic GPU polyline contribution for a routed wire, including its own arrowhead. */
export function getWireGpuPolyline(id: EntityId, world: CanvasWorld): GpuPolylineGeometry | undefined {
  if (!world.getExtension('connector.wire')) return undefined;
  const geometry = world.getCanonical<WireProps>(id, 'connector.wire') ? world.getComputed<WireDerivedGeometry>(id, 'computed.connector.wire') : undefined;
  if (!geometry) return undefined;
  let cache = lines.get(world);
  if (!cache) { cache = new Map(); lines.set(world, cache); }
  let line = cache.get(id);
  if (!line) { line = { points: geometry.points, endDecoration: wireGpuArrowhead }; cache.set(id, line); }
  // Reuse one object per entity so the frame loop does not allocate.
  line.points = geometry.points; line.endTangent = geometry.endTangent;
  return line;
}

import type { CanvasWorld, EntityId, GpuPolylineGeometry } from '@alid/kernel';
import type { VectorDerivedGeometry } from './types';

const cache = new WeakMap<Readonly<VectorDerivedGeometry>, GpuPolylineGeometry>();

/** Opt in only when the generic GPU polyline preserves the authored SVG style. */
export function getVectorGpuPolyline(id: EntityId, world: CanvasWorld): GpuPolylineGeometry | undefined {
  if (!world.getExtension('vector.path')) return undefined;
  const geometry = world.getComputed<VectorDerivedGeometry>(id, 'computed.vector.path');
  if (!geometry) return undefined;
  const props = geometry.style;
  if (geometry.sampledContours.length !== 1 || geometry.sampledContours[0].closed
    || props.fill !== 'none' && props.fill !== 'transparent' && props.fillOpacity > 0
    || props.strokeDash !== 'solid' || props.strokeCap !== 'round' || props.strokeJoin !== 'round'
    || props.arrowStart || props.arrowEnd || props.strokeWidth <= 0 || !/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(props.stroke)) return undefined;
  const existing = cache.get(geometry);
  if (existing) return existing;
  const hex = props.stroke.length === 4 ? props.stroke.slice(1).split('').map(value => value + value).join('') : props.stroke.slice(1);
  const rgb = Number.parseInt(hex, 16);
  const line: GpuPolylineGeometry = {
    points: geometry.sampledContours[0].points, endTangent: geometry.sampledContours[0].endTangent,
    strokeWidth: props.strokeWidth,
    strokeCap: 'round', strokeJoin: 'round', color: [(rgb >> 16) / 255, ((rgb >> 8) & 255) / 255, (rgb & 255) / 255, 1],
  };
  cache.set(geometry, line);
  return line;
}

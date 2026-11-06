import { readLayoutBounds, type ComputedReadView, type EntityId, type LayoutBounds, type PorcelainExtensionSpec } from '@alid/kernel';
import type { ConnectorPortsProps, EntityPort, PortSide } from './types';

const sides: readonly PortSide[] = ['north', 'east', 'south', 'west'];

export interface NearestPortQuery {
  readonly x: number;
  readonly y: number;
  /** World-space radius. Hosts divide their screen-space hit radius by zoom. */
  readonly radius: number;
  readonly entityIds?: Iterable<EntityId>;
}

/** Global distance wins before stacking order; ties are independent of document iteration order. */
export function findNearestEntityPort(view: ComputedReadView, query: NearestPortQuery): EntityPort | undefined {
  if (![query.x, query.y, query.radius].every(Number.isFinite) || query.radius < 0) return undefined;
  let best: EntityPort | undefined, distance = query.radius * query.radius, zOrder = -Infinity;
  for (const id of query.entityIds ?? view.listEntityIds?.() ?? []) {
    const order = view.getPaintRank?.(id) ?? view.getComputed<{zOrder?:number}>(id, 'computed.effectiveBounds')?.zOrder;
    const z = typeof order === 'number' && Number.isFinite(order) ? order : 0;
    for (const port of getEntityPorts(id, view)) {
      const dx = port.x - query.x, dy = port.y - query.y, squared = dx * dx + dy * dy;
      if (!Number.isFinite(squared) || squared > query.radius * query.radius) continue;
      const tie = Math.abs(squared - distance) <= 1e-9;
      if (!best || squared < distance - 1e-9 || tie && (z > zOrder || z === zOrder && (id < best.entityId || id === best.entityId && port.id < best.id))) {
        best = port; distance = squared; zOrder = z;
      }
    }
  }
  return best;
}

/** @deprecated Use `readLayoutBounds` from `@alid/kernel`. */
export function getEntityLayoutBounds(id: EntityId, view: ComputedReadView): Readonly<LayoutBounds> | undefined {
  return readLayoutBounds(view, id);
}

/** A ports aspect is attachable to any entity with the public layout-bounds projection. */
export function getEntityPorts(id: EntityId, view: ComputedReadView, authored?: Readonly<ConnectorPortsProps>): EntityPort[] {
  if (!view.isAlive(id)) return [];
  const bounds = getEntityLayoutBounds(id, view); if (!bounds) return [];
  const props = authored ?? view.getCanonical<ConnectorPortsProps>(id, 'connector.ports');
  if (props?.enabled === false) return [];
  const enabled = Array.isArray(props?.sides) ? sides.filter(side => props.sides.includes(side)) : sides;
  const offset = Number.isFinite(props?.offset) ? Math.max(0, Math.min(1, props!.offset)) : 0.5;
  const rotation = Number.isFinite(bounds.rotation) ? bounds.rotation! : 0;
  const cosine = Math.cos(rotation), sine = Math.sin(rotation);
  const cx = bounds.x + bounds.width / 2, cy = bounds.y + bounds.height / 2;
  const clean = (value: number) => Math.abs(value) < 1e-9 ? 0 : value;
  return enabled.map(side => {
    let x = 0, y = 0, nx = 0, ny = 0;
    if (side === 'north') { x = bounds.width * (offset - 0.5); y = -bounds.height / 2; ny = -1; }
    else if (side === 'south') { x = bounds.width * (offset - 0.5); y = bounds.height / 2; ny = 1; }
    else if (side === 'east') { x = bounds.width / 2; y = bounds.height * (offset - 0.5); nx = 1; }
    else { x = -bounds.width / 2; y = bounds.height * (offset - 0.5); nx = -1; }
    return { id: side, entityId: id, side, x: clean(cx + x * cosine - y * sine), y: clean(cy + x * sine + y * cosine), nx: clean(nx * cosine - ny * sine), ny: clean(nx * sine + ny * cosine) };
  });
}

export const ConnectorPortsExtension: PorcelainExtensionSpec<ConnectorPortsProps, EntityPort[]> = {
  id: 'connector.ports',
  summary: '어떤 바운딩 엔티티에도 부착할 수 있는 상하좌우 연결 포트',
  defaults: { enabled: true, sides: ['north', 'east', 'south', 'west'], offset: 0.5 },
  dependsOnCanonical: ['connector.ports', 'core.transform', 'core.bounds'],
  dependsOnComputed: ['computed.layoutBounds'],
  derive: (props, id, view) => getEntityPorts(id, view, props),
  ui: {
    controls: [
      { id: 'ports.enabled.inspector', kind: 'toggle', field: 'enabled', label: '연결 포트 사용', mnemonic: 'p', placement: 'inspector' },
      { id: 'ports.offset.inspector', kind: 'slider', field: 'offset', label: '포트 위치', min: 0, max: 1, step: 0.05, placement: 'inspector' },
    ],
  },
};

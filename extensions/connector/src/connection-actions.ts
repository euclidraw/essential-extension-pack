import type { CanonicalPatchOp, CanvasWorld, EffectiveBounds, MutablePoint } from '@alid/kernel';
import { getEntityPorts } from './ports';
import type { PortSide } from './types';

export type WireRouting = 'orthogonal' | 'bezier';

/** Port sides the wire may land on, chosen by where the user released relative to the source. */
function facingSide(bounds: Readonly<EffectiveBounds>, point: Readonly<MutablePoint>): PortSide {
  const dx = point.x - bounds.x - bounds.width / 2, dy = point.y - bounds.y - bounds.height / 2;
  return Math.abs(dx) >= Math.abs(dy) ? dx >= 0 ? 'west' : 'east' : dy >= 0 ? 'north' : 'south';
}

/** Endpoints get default ports only when they have none, so authored port settings are never overwritten. */
function ensurePorts(world: CanvasWorld, ids: readonly string[]): CanonicalPatchOp[] {
  return ids.filter(id => !world.getCanonical(id, 'connector.ports')).map(id => ({ id, aspect: 'connector.ports', patch: { enabled: true } }));
}

/**
 * Validate both endpoints again at commit time and build the connector batch.
 * Returns undefined when an explicit port disappeared since the gesture began.
 */
export function connectOps(world: CanvasWorld, wire: string, from: string, to: string, routing: WireRouting, fromPort?: string, toPort?: string): CanonicalPatchOp[] | undefined {
  const sources = getEntityPorts(from, world), targets = getEntityPorts(to, world);
  if (from === to || !sources.length || !targets.length || fromPort && !sources.some(port => port.id === fromPort) || toPort && !targets.some(port => port.id === toPort)) return undefined;
  return [...ensurePorts(world, [from, to]), { id: wire, aspect: 'connector.wire', patch: { from, to, routing, ...(fromPort ? { fromPort } : {}), ...(toPort ? { toPort } : {}) } }];
}

export const QUICK_CARD_SIZE = { width: 300, height: 220 } as const;

/**
 * A new markdown card placed against the release point, facing the source,
 * and a connector into it. Returns undefined if the source port vanished.
 */
export function quickCreateOps(world: CanvasWorld, ids: { card: string; wire: string }, from: string, fromPort: string | undefined, point: Readonly<MutablePoint>, body: string, routing: WireRouting): CanonicalPatchOp[] | undefined {
  const ports = getEntityPorts(from, world), source = fromPort ? ports.find(port => port.id === fromPort) : ports[0];
  const bounds = world.getComputed<EffectiveBounds>(from, 'computed.layoutBounds');
  if (!source || !bounds) return undefined;
  const side = facingSide(bounds, point), { width, height } = QUICK_CARD_SIZE;
  const x = point.x - (side === 'east' ? width : side === 'west' ? 0 : width / 2);
  const y = point.y - (side === 'south' ? height : side === 'north' ? 0 : height / 2);
  return [
    ...ensurePorts(world, [from]),
    { id: ids.card, aspect: 'core.transform', patch: { x, y } }, { id: ids.card, aspect: 'core.bounds', patch: { width, height } },
    { id: ids.card, aspect: 'markdown.card', patch: { body } }, { id: ids.card, aspect: 'connector.ports', patch: { enabled: true } },
    { id: ids.wire, aspect: 'connector.wire', patch: { from, to: ids.card, ...(fromPort ? { fromPort } : {}), toPort: side, routing } },
  ];
}

export const QUICK_CARD_TEMPLATES = [
  { id: 'markdown', label: '마크다운 카드로 연결', detail: '새 카드를 만들고 연결합니다.', value: '# 새로운 생각\n\n여기에 내용을 적어 보세요.' },
  { id: 'math-code', label: '수식·코드 카드로 연결', detail: '수식과 코드 예제 카드로 연결합니다.', value: '# 수식과 코드\n\n$E = mc^2$\n\n```ts\nconst idea = "alid";\n```' },
] as const;

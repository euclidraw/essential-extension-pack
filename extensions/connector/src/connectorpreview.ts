import type { CanvasWorld, CanonicalPatchOp, ComputedReadView, EntityId } from '@alid/kernel';
import { findNearestEntityPort, getEntityLayoutBounds, getEntityPorts } from './ports';
import type { EntityPort, WireProps, Point, PortSide, WireDerivedGeometry } from './types';

export type ConnectorPreviewStatus = 'idle' | 'free' | 'snapped' | 'invalid-source' | 'invalid-target' | 'blocked';
export interface ConnectorPreviewSnapshot {
  readonly active: boolean;
  readonly status: ConnectorPreviewStatus;
  readonly sourceId?: EntityId;
  readonly sourcePort?: EntityPort;
  readonly targetId?: EntityId;
  readonly targetPort?: EntityPort;
  readonly cursor: Readonly<Point>;
  readonly geometry: Readonly<WireDerivedGeometry>;
  /** Only a live, compatible snapped target with a usable route can be committed. */
  readonly valid: boolean;
  readonly label: string;
}
export interface ConnectorPreviewOptions {
  readonly world: CanvasWorld;
  readonly ownerId?: string;
  readonly snapRadiusScreenPx?: number;
  readonly canConnect?: (source: EntityPort, target: EntityPort) => boolean | string;
}
export interface ConnectorPreviewBegin {
  readonly sourceId: EntityId;
  readonly sourcePortId?: string;
  readonly x: number;
  readonly y: number;
  readonly routing?: WireProps['routing'];
}
export interface ConnectorPreviewUpdate {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
  /** An explicit target is validated even if its port was disabled or removed. */
  readonly targetId?: EntityId;
  readonly targetPortId?: string;
  readonly routing?: WireProps['routing'];
}
export interface ConnectorPreviewController {
  readonly cursorId: EntityId;
  readonly wireId: EntityId;
  begin(input: ConnectorPreviewBegin): ConnectorPreviewSnapshot;
  update(input: ConnectorPreviewUpdate): ConnectorPreviewSnapshot;
  getSnapshot(): ConnectorPreviewSnapshot;
  clear(): void;
  dispose(): void;
}

const emptyGeometry: WireDerivedGeometry = { points: [] };
Object.freeze(emptyGeometry.points); Object.freeze(emptyGeometry);
let previewSequence = 0;
const idle = (): ConnectorPreviewSnapshot => ({ active: false, status: 'idle', cursor: { x: 0, y: 0 }, geometry: emptyGeometry, valid: false, label: '' });
const hasRoute = (geometry: Readonly<WireDerivedGeometry> | undefined): geometry is Readonly<WireDerivedGeometry> => !!geometry && geometry.points.length >= 2 && geometry.points.every(point => Number.isFinite(point.x) && Number.isFinite(point.y)) && geometry.points.some(point => Math.hypot(point.x - geometry.points[0].x, point.y - geometry.points[0].y) > 1e-7);

/** A private memory overlay reuses the installed connector derive, without document writes. */
export function createConnectorPreview(options: ConnectorPreviewOptions): ConnectorPreviewController {
  const { world } = options;
  const ownerId = options.ownerId ?? `connector-preview-${++previewSequence}`;
  const suffix = `${ownerId}:${++previewSequence}`;
  const cursorId = `scratch:cursor:${suffix}`, wireId = `scratch:wire:${suffix}`;
  const scratch = world.createScratchOverlay(ownerId);
  let source: ConnectorPreviewBegin | undefined, snapshot = idle(), disposed = false;
  let draftKey = '';
  let currentRouting: WireProps['routing'] = 'orthogonal';
  const view = () => world.getPreviewView();
  const invalidSource = (cursor: Point, sourcePort?: EntityPort) => {
    scratch.clear(); draftKey = '';
    return snapshot = { active: false, status: 'invalid-source', sourceId: source?.sourceId, sourcePort, cursor, geometry: emptyGeometry, valid: false, label: '출발 포트를 사용할 수 없습니다.' };
  };
  const sourcePorts = (read: ComputedReadView) => source && world.isAlive(source.sourceId) ? getEntityPorts(source.sourceId, read).filter(port => source!.sourcePortId === undefined || port.id === source!.sourcePortId) : [];
  const candidateView = (read: ComputedReadView): ComputedReadView => ({
    listEntityIds: () => world.listEntityIds(), isAlive: id => read.isAlive(id),
    getComputed: (id, aspect) => read.getComputed(id, aspect), getIntrinsicDomSize: id => read.getIntrinsicDomSize(id),
    getCanonical<T extends Record<string, unknown>>(id: string, aspect: `${string}.${string}`): Readonly<T> | undefined {
      const props = read.getCanonical<T>(id, aspect);
      // Disabled ports remain discoverable as invalid snap feedback, without enabling them.
      return aspect === 'connector.ports' && props?.enabled === false ? { ...props, enabled: true } as Readonly<T> : props;
    },
  });
  const resolveTarget = (input: ConnectorPreviewUpdate, read: ComputedReadView): { port?: EntityPort; id?: string; invalid?: string } => {
    const candidates = candidateView(read);
    let port: EntityPort | undefined;
    if (input.targetId !== undefined) {
      if (!world.isAlive(input.targetId)) return { id: input.targetId, invalid: '도착 대상이 사라졌습니다.' };
      const ports = getEntityPorts(input.targetId, candidates);
      port = input.targetPortId !== undefined ? ports.find(item => item.id === input.targetPortId) : ports.reduce<EntityPort | undefined>((best, item) => !best || Math.hypot(item.x - input.x, item.y - input.y) < Math.hypot(best.x - input.x, best.y - input.y) ? item : best, undefined);
      if (!port) return { id: input.targetId, invalid: '도착 포트를 사용할 수 없습니다.' };
    } else {
      const radius = (options.snapRadiusScreenPx ?? 14) / input.zoom;
      port = findNearestEntityPort(candidates, { x: input.x, y: input.y, radius, entityIds: world.listEntityIds().filter(id=>id!==source!.sourceId) });
    }
    if (!port) return {};
    if (!getEntityPorts(port.entityId, read).some(item => item.id === port!.id)) return { port, id: port.entityId, invalid: '사용할 수 없는 포트입니다.' };
    if (source!.sourceId === port.entityId) return { port, id: port.entityId, invalid: '다른 카드를 선택하세요.' };
    return { port, id: port.entityId };
  };
  const update = (input: ConnectorPreviewUpdate): ConnectorPreviewSnapshot => {
    if (disposed || !source) return snapshot;
    const cursor = { x: input.x, y: input.y };
    if (![input.x, input.y, input.zoom].every(Number.isFinite) || input.zoom <= 0) {
      scratch.clear(); draftKey = '';
      return snapshot = { active: true, status: 'blocked', sourceId: source.sourceId, cursor, geometry: emptyGeometry, valid: false, label: '연결할 위치를 확인하세요.' };
    }
    const read = view(), ports = sourcePorts(read);
    if (!ports.length) return invalidSource(cursor, snapshot.sourcePort);
    const target = resolveTarget(input, read);
    if (input.routing !== undefined) currentRouting = input.routing;
    const routing = currentRouting;
    const targetId = target.port && !target.invalid ? target.port.entityId : cursorId;
    let targetPortId = target.port && !target.invalid ? target.port.id : '';
    const bounds = getEntityLayoutBounds(source.sourceId, read)!;
    const origin = ports.find(port => port.id === source!.sourcePortId) ?? { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
    const dx = origin.x - cursor.x, dy = origin.y - cursor.y;
    const side: PortSide = Math.abs(dx) >= Math.abs(dy) ? dx >= 0 ? 'east' : 'west' : dy >= 0 ? 'south' : 'north';
    const free = targetId === cursorId;
    if (free) targetPortId = side;
    const size = free ? Math.max(1e-4, Math.max(Math.abs(cursor.x), Math.abs(cursor.y)) * Number.EPSILON * 8) : 0;
    const x = cursor.x - (side === 'east' ? size : side === 'west' ? 0 : size / 2);
    const y = cursor.y - (side === 'south' ? size : side === 'north' ? 0 : size / 2);
    const key = `${source.sourceId}\0${source.sourcePortId ?? ''}\0${targetId}\0${targetPortId}\0${routing}\0${free ? x : 0}\0${free ? y : 0}\0${size}`;
    if (key !== draftKey) {
      const ops: CanonicalPatchOp[] = [
        { id: cursorId, aspect: 'core.transform', patch: { x: free ? x : 0, y: free ? y : 0, rotation: 0 } },
        // An inactive zero-size anchor is deliberately omitted by public layout/port validation.
        { id: cursorId, aspect: 'core.bounds', patch: { width: size, height: size } },
        { id: cursorId, aspect: 'connector.ports', patch: { enabled: free, sides: [side], offset: 0.5 } },
        { id: wireId, aspect: 'connector.wire', patch: { from: source.sourceId, to: targetId, fromPort: source.sourcePortId ?? null, toPort: targetPortId, routing } },
        // The draft connector previews above every object, like a newly created one.
        { id: wireId, aspect: 'core.stacking', patch: { order: 'zzzzzzzz' } },
      ];
      scratch.setBatch(ops); draftKey = key;
    }
    const geometry = world.getComputed<WireDerivedGeometry>(wireId, 'computed.connector.wire') ?? emptyGeometry;
    const route = hasRoute(geometry);
    const fromPort = geometry.fromPort ?? ports[0];
    let invalid = target.invalid;
    if (!invalid && target.port) {
      const compatible = options.canConnect?.(fromPort, target.port);
      if (compatible === false || typeof compatible === 'string') invalid = typeof compatible === 'string' ? compatible : '이 포트에는 연결할 수 없습니다.';
    }
    const status: ConnectorPreviewStatus = invalid ? 'invalid-target' : !route ? 'blocked' : target.port ? 'snapped' : 'free';
    const valid = status === 'snapped';
    return snapshot = {
      active: true, status, sourceId: source.sourceId, sourcePort: fromPort, targetId: target.id, targetPort: target.port,
      cursor, geometry, valid,
      label: invalid ?? (status === 'snapped' ? `연결 가능 · ${target.port!.id}` : status === 'blocked' ? '이 위치로 연결할 수 없습니다.' : '빈 공간에 놓아 새 카드를 연결하세요.'),
    };
  };
  return {
    cursorId, wireId,
    begin(input) { if (disposed) return snapshot; scratch.clear(); draftKey = ''; source = { ...input }; currentRouting = input.routing ?? 'orthogonal'; return update({ x: input.x, y: input.y, zoom: 1 }); },
    update, getSnapshot: () => snapshot,
    clear() { if (disposed) return; scratch.clear(); draftKey = ''; source = undefined; snapshot = idle(); },
    dispose() { if (disposed) return; disposed = true; source = undefined; scratch.dispose(); snapshot = idle(); },
  };
}

export interface ConnectorPreviewPainterOptions { readonly surface: HTMLElement; readonly gizmoPlane: HTMLElement; readonly hudPlane?: HTMLElement }
export interface ConnectorPreviewPainter { render(snapshot: ConnectorPreviewSnapshot, camera: Readonly<{ x: number; y: number; zoom: number }>): void; dispose(): void }

const PREVIEW_ACCENT = 'var(--alid-accent, #008FF0)';

/** A host-driven Plane 3 SVG overlay; no private frame or pointer loop. */
export function mountConnectorPreviewPainter({ surface, gizmoPlane }: ConnectorPreviewPainterOptions): ConnectorPreviewPainter {
  const ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg');
  svg.dataset.role = 'connector-preview'; svg.setAttribute('aria-hidden', 'true');
  svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;overflow:visible;pointer-events:none;z-index:5';
  const group = document.createElementNS(ns, 'g'), path = document.createElementNS(ns, 'path'), arrow = document.createElementNS(ns, 'path'), ring = document.createElementNS(ns, 'circle');
  for (const element of [path, arrow]) {
    element.setAttribute('fill', 'none');
    element.setAttribute('stroke', PREVIEW_ACCENT);
    element.setAttribute('stroke-width', '1.75');
    element.setAttribute('stroke-linecap', 'round');
    element.setAttribute('stroke-linejoin', 'round');
    element.setAttribute('vector-effect', 'non-scaling-stroke');
  }
  ring.setAttribute('r', '6');
  ring.setAttribute('stroke', PREVIEW_ACCENT);
  ring.setAttribute('stroke-width', '1.5');
  ring.setAttribute('fill', 'var(--alid-accent-soft, #e5f4fe)');
  ring.setAttribute('fill-opacity', '0.35');
  group.append(path); svg.append(group, arrow, ring); gizmoPlane.append(svg);
  let disposed = false;
  svg.style.display = 'none';
  return {
    render(state, camera) {
      if (disposed) return;
      const visible = state.active && state.status !== 'idle';
      svg.style.display = visible ? '' : 'none';
      if (!visible) return;
      const width = surface.clientWidth, height = surface.clientHeight;
      svg.setAttribute('width', String(width)); svg.setAttribute('height', String(height)); svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
      group.setAttribute('transform', `translate(${width / 2} ${height / 2}) scale(${camera.zoom}) translate(${-camera.x} ${-camera.y})`);
      const muted = state.status === 'invalid-target' || state.status === 'blocked';
      const opacity = state.valid ? '1' : muted ? '0.38' : '0.82';
      path.setAttribute('stroke', PREVIEW_ACCENT);
      arrow.setAttribute('stroke', PREVIEW_ACCENT);
      path.setAttribute('stroke-opacity', opacity);
      arrow.setAttribute('stroke-opacity', opacity);
      path.setAttribute('stroke-dasharray', state.valid ? 'none' : '5 4');
      path.setAttribute('d', state.geometry.path ?? state.geometry.points.map((point, index) => `${index ? 'L' : 'M'}${point.x},${point.y}`).join(' '));
      const points = state.geometry.points, end = points.at(-1), tangent = state.geometry.endTangent;
      let dx = tangent?.x ?? 0, dy = tangent?.y ?? 0, length = Math.hypot(dx, dy);
      if (!Number.isFinite(length) || length < 1e-9) for (let i = points.length - 2; end && i >= 0; i--) { dx = end.x - points[i].x; dy = end.y - points[i].y; length = Math.hypot(dx, dy); if (length >= 1e-9 && Number.isFinite(length)) break; }
      if (end && Number.isFinite(length) && length >= 1e-9) {
        const x = (end.x - camera.x) * camera.zoom + width / 2, y = (end.y - camera.y) * camera.zoom + height / 2, ux = dx / length, uy = dy / length;
        arrow.setAttribute('d', `M${x - ux * 6.5 + uy * 3.5},${y - uy * 6.5 - ux * 3.5}L${x},${y}L${x - ux * 6.5 - uy * 3.5},${y - uy * 6.5 + ux * 3.5}`);
      } else arrow.setAttribute('d', '');
      if (state.valid && state.targetPort) {
        ring.style.display = '';
        ring.setAttribute('cx', String((state.targetPort.x - camera.x) * camera.zoom + width / 2));
        ring.setAttribute('cy', String((state.targetPort.y - camera.y) * camera.zoom + height / 2));
      } else {
        ring.style.display = 'none';
      }
    },
    dispose() { if (disposed) return; disposed = true; svg.remove(); },
  };
}

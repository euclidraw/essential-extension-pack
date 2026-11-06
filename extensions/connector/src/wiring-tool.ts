import type { CanvasWorld, MutablePoint } from '@alid/kernel';
import { createConnectorPreview, mountConnectorPreviewPainter } from './connectorpreview';
import { findNearestEntityPort, getEntityPorts } from './ports';
type SelectSuiteController = { stateMachine: { mountChildState(parent: string, state: {id:string; onExit?:()=>void}):()=>void; transition(id:string):void; stateId:string } };

const CONNECT_STATE = 'root.select.connector.smart-wire:connect';
const IDLE_STATE = 'root.select.core.select-suite:idle';
const DRAG_SLOP = 3.5;

export interface WiringToolHost {
  surface: HTMLElement;
  gizmoPlane: HTMLElement;
  hudPlane: HTMLElement;
  world: CanvasWorld;
  selection: SelectSuiteController;
  camera: { x: number; y: number; zoom: number };
  getMode(): 'select' | 'connect';
  isInputBlocked(): boolean;
  isPanGesture(event: PointerEvent): boolean;
  getRouting(): 'orthogonal' | 'bezier';
  requestRender(): void;
  onBegin(sourceId: string): void;
  onCancel?(): void;
  onCommit(sourceId: string, targetId: string, sourcePortId?: string, targetPortId?: string): void;
  onQuickCreate(sourceId: string, sourcePortId: string | undefined, point: Readonly<MutablePoint>, signal: AbortSignal): Promise<void>;
  onError(error: Error): void;
}

/** Per-view input/HSM owner. Pointer movement only records scalars for the host's single frame. */
export class WiringTool {
  private readonly preview;
  private readonly painter;
  private readonly abort = new AbortController();
  private readonly disposers: Array<() => void> = [];
  private readonly worldPoint = { x: 0, y: 0 };
  private readonly update = { x: 0, y: 0, zoom: 1, targetId: undefined as string | undefined, targetPortId: undefined as string | undefined, routing: 'orthogonal' as 'orthogonal' | 'bezier' };
  private readonly hidden = { active: false, status: 'idle' as const, cursor: { x: 0, y: 0 }, geometry: { points: [] }, valid: false, label: '' };
  private sourceId?: string;
  private sourcePortId?: string;
  private pointerId: number | null = null;
  private startX = 0;
  private startY = 0;
  private clientX = 0;
  private clientY = 0;
  private dragging = false;
  private dirty = false;
  private composing = false;
  private compositionEndedAt = -Infinity;
  private awaiting?: AbortController;
  private revision = 0;
  private disposed = false;
  private lastCameraX = NaN;
  private lastCameraY = NaN;
  private lastZoom = NaN;

  constructor(private readonly host: WiringToolHost) {
    this.preview = createConnectorPreview({ world: host.world });
    this.painter = mountConnectorPreviewPainter({ surface: host.surface, gizmoPlane: host.gizmoPlane, hudPlane: host.hudPlane });
    this.disposers.push(host.selection.stateMachine.mountChildState('root.select', { id: 'connector.smart-wire:connect', onExit: () => this.reset() }));
    for (const id of ['wiring', 'creating']) this.disposers.push(host.selection.stateMachine.mountChildState(CONNECT_STATE, { id }));
    const signal = this.abort.signal;
    host.surface.addEventListener('pointerdown', this.onPointerDown, { signal });
    host.surface.addEventListener('pointermove', this.onPointerMove, { signal });
    host.surface.addEventListener('pointerup', this.onPointerUp, { signal });
    host.surface.addEventListener('pointercancel', this.onPointerCancel, { signal });
    host.surface.addEventListener('lostpointercapture', this.onPointerCancel, { signal });
    host.surface.addEventListener('compositionstart', () => { this.composing = true; this.cancel(); }, { signal });
    host.surface.addEventListener('compositionend', () => { this.composing = false; this.compositionEndedAt = performance.now(); }, { signal });
    document.addEventListener('keydown', this.onKeyDown, { signal });
    window.addEventListener('blur', () => this.cancel(), { signal });
    this.disposers.push(host.world.subscribe(() => { if (this.sourceId && !this.awaiting) { this.dirty = true; host.requestRender(); } }));
  }

  get active(): boolean { return this.sourceId !== undefined; }
  enter(): void { this.host.selection.stateMachine.transition(CONNECT_STATE); }

  private toWorld(): void {
    const rect = this.host.surface.getBoundingClientRect(), camera = this.host.camera;
    this.worldPoint.x = (this.clientX - rect.left - this.host.surface.clientWidth / 2) / camera.zoom + camera.x;
    this.worldPoint.y = (this.clientY - rect.top - this.host.surface.clientHeight / 2) / camera.zoom + camera.y;
  }

  /** Port gizmos call this before the ordinary selection listener claims a drag. */
  startFromPort(id: string, portId: string, event: PointerEvent): void {
    if (this.disposed || this.composing || this.host.isInputBlocked() || this.host.isPanGesture(event)) return;
    this.record(event);
    if (this.sourceId) { this.complete(id, portId); return; }
    this.begin(id, portId, event);
  }

  private record(event: PointerEvent): void { this.clientX = event.clientX; this.clientY = event.clientY; }
  private begin(id: string, portId: string | undefined, event: PointerEvent): void {
    if(this.host.world.isEntityReadOnly(id))return;
    const ports = getEntityPorts(id, this.host.world);
    if (!ports.length || portId && !ports.some(port => port.id === portId)) return;
    this.toWorld();
    this.sourceId = id; this.sourcePortId = portId;
    this.preview.begin({ sourceId: id, sourcePortId: portId, x: this.worldPoint.x, y: this.worldPoint.y, routing: this.host.getRouting() });
    this.host.onBegin(id);
    this.host.selection.stateMachine.transition(`${CONNECT_STATE}.wiring`);
    this.pointerId = event.pointerId; this.startX = event.clientX; this.startY = event.clientY; this.dragging = false; this.dirty = true;
    this.host.surface.setPointerCapture?.(event.pointerId); this.host.surface.focus({ preventScroll: true });
    this.host.requestRender();
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (this.disposed || this.composing || event.defaultPrevented || event.button !== 0 || this.host.getMode() !== 'connect' || this.host.isInputBlocked() || this.host.isPanGesture(event)) return;
    const element = event.target instanceof Element ? event.target : null;
    if (element?.closest('button,input,textarea,select,[data-canvas-ui]')) return;
    this.record(event); this.toWorld();
    const nearest = findNearestEntityPort(this.host.world, { x: this.worldPoint.x, y: this.worldPoint.y, radius: 14 / this.host.camera.zoom });
    const id = nearest?.entityId ?? element?.closest<HTMLElement>('[data-entity-id]')?.dataset.entityId;
    if (this.sourceId) {
      event.preventDefault();
      if (id) this.complete(id, nearest?.id); else this.quickCreate();
      return;
    }
    if (!id) return;
    event.preventDefault(); this.begin(id, nearest?.id, event);
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (!this.sourceId || this.awaiting || this.disposed || this.composing || this.host.isInputBlocked()) return;
    this.record(event);
    if (this.pointerId === event.pointerId && !this.dragging) {
      const dx = event.clientX - this.startX, dy = event.clientY - this.startY;
      this.dragging = dx * dx + dy * dy >= DRAG_SLOP * DRAG_SLOP;
    }
    this.update.targetId = undefined; this.update.targetPortId = undefined;
    this.dirty = true; this.host.requestRender();
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (!this.sourceId || event.pointerId !== this.pointerId || this.disposed) return;
    this.record(event);
    const dragged = this.dragging; this.releasePointer();
    if (!dragged) return; // A first click keeps the rubber band alive until the second click.
    this.refresh();
    const snapshot = this.preview.getSnapshot();
    if (snapshot.valid && snapshot.targetPort) this.complete(snapshot.targetPort.entityId, snapshot.targetPort.id);
    else if (snapshot.status === 'free') this.quickCreate();
    event.preventDefault();
  };
  private readonly onPointerCancel = (event: PointerEvent): void => { if (event.pointerId === this.pointerId) this.cancel(); };
  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!this.sourceId || event.defaultPrevented || event.key !== 'Escape' || this.composing || event.isComposing || event.keyCode === 229 || performance.now() - this.compositionEndedAt < 16) return;
    event.preventDefault(); this.cancel();
  };

  private refresh(targetId?: string, targetPortId?: string): void {
    if (!this.sourceId || this.awaiting) return;
    this.toWorld();
    this.update.x = this.worldPoint.x; this.update.y = this.worldPoint.y; this.update.zoom = this.host.camera.zoom;
    this.update.targetId = targetId; this.update.targetPortId = targetPortId;
    this.update.routing = this.host.getRouting();
    this.preview.update(this.update); this.dirty = false;
  }

  private complete(id: string, portId?: string): void {
    if (!this.sourceId || this.awaiting) return;
    if(this.host.isInputBlocked()||this.host.world.isEntityReadOnly(this.sourceId)||this.host.world.isEntityReadOnly(id)){this.cancel();return;}
    this.refresh(id, portId);
    const snapshot = this.preview.getSnapshot();
    if (snapshot.status === 'invalid-source') { this.cancel(); return; }
    if (!snapshot.valid || !snapshot.targetPort) { this.host.requestRender(); return; }
    const source = this.sourceId, sourcePort = this.sourcePortId;
    const targetPort = snapshot.targetPort.id;
    this.reset();
    this.host.onCommit(source, id, sourcePort, targetPort);
  }

  private quickCreate(): void {
    if (!this.sourceId || this.awaiting) return;
    this.refresh();
    const snapshot = this.preview.getSnapshot();
    if (snapshot.status !== 'free') { this.host.requestRender(); return; }
    const controller = new AbortController(), revision = ++this.revision, source = this.sourceId, port = this.sourcePortId;
    const point = { x: snapshot.cursor.x, y: snapshot.cursor.y };
    this.awaiting = controller; this.releasePointer();
    this.host.selection.stateMachine.transition(`${CONNECT_STATE}.creating`);
    void this.host.onQuickCreate(source, port, point, controller.signal).catch(error => {
      if (!controller.signal.aborted && !this.disposed) this.host.onError(error instanceof Error ? error : new Error(String(error)));
    }).finally(() => { if (revision === this.revision && !this.disposed) this.cancel(); });
    this.host.requestRender();
  }

  /** Called only by the owning session's compositor; no independent animation loop. */
  render(): void {
    if (this.disposed) return;
    const camera = this.host.camera;
    if (this.sourceId && !this.awaiting && (this.dirty || camera.x !== this.lastCameraX || camera.y !== this.lastCameraY || camera.zoom !== this.lastZoom)) this.refresh();
    const snapshot = this.preview.getSnapshot();
    if (snapshot.status === 'invalid-source') this.cancel();
    const dx=this.clientX-this.startX,dy=this.clientY-this.startY;
    this.painter.render(this.sourceId&&!this.awaiting&&dx*dx+dy*dy<DRAG_SLOP*DRAG_SLOP?this.hidden:this.preview.getSnapshot(), camera);
    this.lastCameraX = camera.x; this.lastCameraY = camera.y; this.lastZoom = camera.zoom;
  }
  private releasePointer(): void {
    const pointer = this.pointerId; this.pointerId = null; this.dragging = false;
    if (pointer !== null && this.host.surface.hasPointerCapture?.(pointer)) this.host.surface.releasePointerCapture(pointer);
  }
  private reset(): void {
    this.revision++; this.awaiting?.abort(); this.awaiting = undefined;
    this.releasePointer(); this.sourceId = undefined; this.sourcePortId = undefined; this.dirty = false;
    this.preview.clear(); this.host.requestRender();
  }
  cancel(): boolean {
    const active = this.active;
    this.reset();
    if (this.host.selection.stateMachine.stateId.startsWith(CONNECT_STATE)) this.host.selection.stateMachine.transition(this.host.getMode()==='connect'?CONNECT_STATE:IDLE_STATE);
    if(active)this.host.onCancel?.();
    return active;
  }
  dispose(): void {
    if (this.disposed) return;
    this.cancel(); this.disposed = true; this.abort.abort();
    for (const off of this.disposers.splice(0).reverse()) off();
    this.preview.dispose(); this.painter.dispose();
  }
}

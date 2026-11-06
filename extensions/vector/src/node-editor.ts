import type { CanonicalPatchOp, EntityId, GizmoHit, MutablePoint, ToolModifiers } from '@alid/kernel';
import { bendSegment, cloneContours, createVectorFrame, cubicAt, normalizeVectorPathProps, pointToLocal, pointToWorld, setVertexHandle, splitSegment, toggleVertex } from './geometry';
import { reboundRotatedVector } from './rebound';
import type { HandleMirroring, VectorContour, VectorFrame, VectorPathProps, VectorVertex } from './types';
import type { VectorEditorOptions } from './vector-host';

export const VECTOR_EDIT_STATE = 'root.select.vector.pen-suite:edit';
const IDLE = 'root.select.core.select-suite:idle', NS = 'http://www.w3.org/2000/svg', SLOP = 3.5;
type MutableVertex = { -readonly [K in keyof VectorVertex]: VectorVertex[K] };
type MutableContour = { vertices: MutableVertex[]; closed: boolean };
export interface VectorVertexAddress { readonly contour: number; readonly index: number }
type HandleKind = 'vertex' | 'in' | 'out' | 'midpoint';
interface Handle { id: string; kind: HandleKind; contour: number; index: number; element: SVGElement; off(): void }
interface Gesture {
  kind: 'vertex' | 'handle' | 'segment' | 'marquee'; pointer: number; contour: number; index: number; handle: 'in' | 'out'; t: number;
  x: number; y: number; clientX: number; clientY: number; moved: boolean; inserted: boolean; extend: boolean;
  alt: boolean; heldInX: number; heldInY: number; heldOutX: number; heldOutY: number;
}
const clone = (contours: readonly VectorContour[]) => cloneContours(contours) as MutableContour[];
const blocked = (target: EventTarget | null) => target instanceof Element && !!target.closest('[data-canvas-ui],button,input,textarea,select,[contenteditable]:not([contenteditable="false"])');
const inputOwned = (event: Event) => blocked(event.target) || event.composedPath().some(blocked);
let instance = 0;

/** Local vertex selection and scratch edits; canonical writes happen only at an explicit commit. */
export class VectorNodeEditor {
  private readonly owner = `vector:node-editor:${++instance}`;
  private readonly scratch;
  private readonly abort = new AbortController();
  private readonly off: Array<() => void> = [];
  private readonly handles: Handle[] = [];
  private readonly chosen: VectorVertexAddress[] = [];
  private readonly hit: GizmoHit = { id: '', priority: 0, distanceScreenPx: 0 };
  private readonly worldPoint: MutablePoint = { x: 0, y: 0 };
  private readonly localPoint: MutablePoint = { x: 0, y: 0 };
  private readonly screenPoint: MutablePoint = { x: 0, y: 0 };
  private readonly segmentPoint: MutablePoint = { x: 0, y: 0 };
  private readonly modifiers: ToolModifiers = { shift: false, alt: false, ctrl: false, meta: false };
  private readonly svg: SVGSVGElement;
  private readonly lines: SVGPathElement;
  private readonly marquee: SVGRectElement;
  private readonly snapGuide: SVGPathElement;
  private entity?: EntityId;
  private originalProps?: Readonly<VectorPathProps>;
  private originalTransform?: Readonly<Record<string, unknown>>;
  private originalBounds?: Readonly<Record<string, unknown>>;
  private frame?: VectorFrame;
  private draft: MutableContour[] = [];
  private baseline: MutableContour[] = [];
  private gesture?: Gesture;
  private dirty = false;
  private change = false;
  private mutating = false;
  private disposed = false;
  private composing = false;
  private compositionEnded = -Infinity;
  private lastX = 0;
  private lastY = 0;
  private pendingOps: CanonicalPatchOp[] = [];
  private previousCursor = '';

  constructor(private readonly options: VectorEditorOptions) {
    this.scratch = options.world.createScratchOverlay(this.owner);
    const doc = options.surface.ownerDocument;
    this.svg = doc.createElementNS(NS, 'svg'); this.svg.dataset.role = 'vector-node-editor';
    this.svg.setAttribute('aria-hidden', 'true'); this.svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;overflow:visible;pointer-events:none;display:none;';
    this.lines = doc.createElementNS(NS, 'path'); this.lines.setAttribute('fill', 'none'); this.lines.setAttribute('stroke', 'var(--alid-accent,#008FF0)'); this.lines.setAttribute('stroke-width', '1');
    this.marquee = doc.createElementNS(NS, 'rect'); this.marquee.dataset.role = 'vector-node-marquee'; this.marquee.setAttribute('fill', 'var(--alid-accent-soft,#e5f4fe)'); this.marquee.setAttribute('fill-opacity', '.35'); this.marquee.setAttribute('stroke', 'var(--alid-accent,#008FF0)'); this.marquee.style.display = 'none';
    this.snapGuide = doc.createElementNS(NS, 'path'); this.snapGuide.setAttribute('fill', 'none'); this.snapGuide.setAttribute('stroke', 'var(--alid-accent,#008FF0)'); this.snapGuide.setAttribute('stroke-dasharray', '3 3');
    this.svg.append(this.lines, this.marquee, this.snapGuide); options.hud.append(this.svg);
    this.off.push(options.selection.stateMachine.mountChildState('root.select', { id: 'vector.pen-suite:edit', onExit: () => this.release(), onModifiersChanged: (_context, modifiers) => this.setModifiers(modifiers) }));
    for (const state of ['idle', 'dragging-vertex', 'dragging-handle', 'bending-segment', 'marquee']) this.off.push(options.selection.stateMachine.mountChildState(VECTOR_EDIT_STATE, { id: state }));
    this.off.push(options.frames?.subscribe(this.render) ?? (() => {}), options.world.subscribe(this.onWorldChanged));
    const signal = this.abort.signal;
    options.surface.addEventListener('pointerdown', this.down, { capture: true, signal });
    options.surface.addEventListener('pointermove', this.move, { capture: true, signal });
    options.surface.addEventListener('pointerup', this.up, { capture: true, signal });
    options.surface.addEventListener('pointercancel', this.cancelPointer, { capture: true, signal });
    options.surface.addEventListener('lostpointercapture', this.cancelPointer, { capture: true, signal });
    options.surface.addEventListener('dblclick', this.doubleClick, { capture: true, signal });
    if (!options.externalKeyboard) doc.addEventListener('keydown', this.keyDown, { signal });
    doc.addEventListener('keyup', this.keyModifiers, { signal });
    doc.addEventListener('compositionstart', () => { this.composing = true; this.cancelGesture(); }, { signal });
    doc.addEventListener('compositionend', () => { this.composing = false; this.compositionEnded = performance.now(); }, { signal });
    doc.defaultView?.addEventListener('blur', this.exit, { signal });
  }

  get editingEntityId(): EntityId | undefined { return this.entity; }
  isEditingEntity = (id: EntityId): boolean => this.entity === id;
  getSelectedVertices(): readonly VectorVertexAddress[] { return this.chosen; }
  setSelectedMirroring(mode: HandleMirroring): boolean {
    if (mode !== 'none' && mode !== 'angle' && mode !== 'angle-and-length') return false;
    return this.changeSelected('vector:set-node-mirroring', point => {
      const side = point.outX || point.outY ? 'out' : 'in';
      return setVertexHandle(point, side, side === 'out' ? point.outX : point.inX, side === 'out' ? point.outY : point.inY, mode);
    });
  }
  /** A radius applies to a corner; converting a smooth point is one undoable edit. */
  setSelectedCornerRadius(radius: number): boolean {
    if (!Number.isFinite(radius)) return false;
    radius = Math.max(0, Math.min(1e6, radius));
    return this.changeSelected('vector:set-corner-radius', point => ({ ...point, cornerRadius: radius, ...(radius > 0 ? { inX: 0, inY: 0, outX: 0, outY: 0, mirroring: 'none' as const } : {}) }));
  }
  private changeSelected(symbol: 'vector:set-node-mirroring' | 'vector:set-corner-radius', change: (point: VectorVertex) => VectorVertex): boolean {
    if (!this.entity || this.gesture || !this.chosen.length || this.options.world.isEntityReadOnly(this.entity)) return false;
    let changed = false;
    for (const address of this.chosen) {
      const previous = this.draft[address.contour]?.vertices[address.index]; if (!previous) continue;
      const next = change(previous);
      if (Object.keys(next).some(key => next[key as keyof VectorVertex] !== previous[key as keyof VectorVertex])) { this.draft[address.contour].vertices[address.index] = { ...next }; changed = true; }
    }
    if (changed) { this.commit(symbol); this.rebuildHandles(); this.options.host.requestRender(); }
    return changed;
  }
  enter(id: EntityId): boolean {
    if (this.disposed || this.options.world.isEntityReadOnly(id) || !this.options.world.isAlive(id) || !this.options.world.getCanonical(id, 'vector.path')) return false;
    if (this.entity === id) return true;
    this.exit(); this.entity = id; this.readCanonical(); this.chosen.length = 0;
    this.options.selection.select(id); this.previousCursor = this.options.surface.style.cursor; this.options.surface.style.cursor = 'default';
    this.options.selection.stateMachine.transition(`${VECTOR_EDIT_STATE}.idle`);
    this.options.surface.focus({ preventScroll: true });
    this.rebuildHandles(); this.options.onEditingChanged?.(id); this.options.host.requestRender(); return true;
  }
  readonly exit = (): void => { if (this.entity) this.options.selection.stateMachine.transition(IDLE); };
  /** Escape cancels the current gesture first, then exits the local editing state. */
  cancel(): boolean { if (!this.entity) return false; if (this.gesture) this.cancelGesture(); else this.exit(); return true; }
  dispose(): void {
    if (this.disposed) return; this.exit(); this.disposed = true; this.abort.abort();
    for (let i = this.off.length - 1; i >= 0; i--) this.off[i](); this.scratch.dispose(); this.svg.remove();
  }

  handleKeyDown(event: KeyboardEvent): boolean {
    if (!this.entity || this.options.host.isSelectionEnabled?.() === false || inputOwned(event) || this.imeLocked(event) || event.getModifierState('AltGraph')) return false;
    this.setModifiers(event);
    if (event.key === 'Escape') { this.cancel(); return true; }
    if (event.key === 'Enter') { if (this.gesture) this.cancelGesture(); else this.exit(); return true; }
    if (event.key === 'Delete' || event.key === 'Backspace') { if (!this.gesture) this.deleteVertices(); return true; }
    if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'a') {
      this.chosen.length = 0; for (let c = 0; c < this.draft.length; c++) for (let index = 0; index < this.draft[c].vertices.length; index++) this.chosen.push({ contour: c, index });
      this.options.host.requestRender(); return true;
    }
    return false;
  }

  private readCanonical(): void {
    const id = this.entity!;
    this.originalProps = this.options.world.getCanonical<VectorPathProps>(id, 'vector.path')!;
    this.originalTransform = this.options.world.getCanonical(id, 'core.transform'); this.originalBounds = this.options.world.getCanonical(id, 'core.bounds');
    const normalized = normalizeVectorPathProps(this.originalProps);
    this.frame = createVectorFrame(normalized, this.originalTransform, this.originalBounds);
    this.draft = clone(normalized.contours); this.baseline = clone(this.draft);
    this.pendingOps = [{ id, aspect: 'vector.path', patch: { contours: this.draft } }]; this.dirty = false; this.change = false;
  }
  private release(): void {
    this.endCapture(); this.scratch.clear(); this.clearHandles(); this.chosen.length = 0; this.entity = undefined; this.frame = undefined;
    this.options.surface.style.cursor = this.previousCursor; this.options.onEditingChanged?.(undefined); this.options.host.requestRender();
  }
  private clearHandles(): void { for (const handle of this.handles) { handle.off(); handle.element.remove(); } this.handles.length = 0; }
  private selected(contour: number, index: number): boolean { for (const address of this.chosen) if (address.contour === contour && address.index === index) return true; return false; }
  private choose(contour: number, index: number, toggle: boolean): void {
    const position = this.chosen.findIndex(value => value.contour === contour && value.index === index);
    if (toggle && position >= 0) this.chosen.splice(position, 1);
    else if (position < 0) { if (!toggle) this.chosen.length = 0; this.chosen.push({ contour, index }); }
  }
  private rebuildHandles(): void {
    this.clearHandles(); if (!this.entity) return;
    const doc = this.options.surface.ownerDocument;
    for (let c = 0; c < this.draft.length; c++) for (let i = 0; i < this.draft[c].vertices.length; i++) {
      for (const kind of ['in', 'out', 'vertex', 'midpoint'] as const) {
        if (kind === 'midpoint' && !this.draft[c].closed && i === this.draft[c].vertices.length - 1) continue;
        const id = `${this.owner}:${c}:${i}:${kind}`, element = doc.createElementNS(NS, kind === 'vertex' ? 'rect' : 'circle');
        element.dataset.gizmoId = id; element.dataset.vectorHandle = kind; element.dataset.contour = String(c); element.dataset.vertex = String(i);
        element.setAttribute('fill', '#fff'); element.setAttribute('stroke', 'var(--alid-accent,#008FF0)'); element.setAttribute('stroke-width', '1.25');
        if (kind === 'vertex') { element.setAttribute('width', '7'); element.setAttribute('height', '7'); }
        else { element.setAttribute('r', kind === 'midpoint' ? '3' : '4'); if (kind === 'midpoint') element.setAttribute('opacity', '.5'); }
        const handle: Handle = { id, kind, contour: c, index: i, element, off: () => {} };
        handle.off = this.options.selection.gizmos.register({ id, priority: kind === 'vertex' ? 30 : kind === 'midpoint' ? 25 : 35,
          shape: kind === 'vertex' ? 'rect' : 'circle', widthScreenPx: 7, heightScreenPx: 7, radiusScreenPx: kind === 'midpoint' ? 5 : 6,
          getWorldPosition: out => this.handlePosition(handle, out), onPointerDown: event => this.beginHandle(handle, event),
        });
        this.handles.push(handle); this.svg.append(element);
      }
    }
  }
  private handlePosition(handle: Handle, out: MutablePoint): boolean {
    if (!this.entity || !this.frame) return false;
    const contour = this.draft[handle.contour], vertex = contour?.vertices[handle.index]; if (!vertex) return false;
    if (handle.kind === 'midpoint') { this.segmentAt(contour, handle.index, .5, this.segmentPoint); pointToWorld(this.frame, this.segmentPoint.x, this.segmentPoint.y, out); }
    else if (handle.kind === 'vertex') pointToWorld(this.frame, vertex.x, vertex.y, out);
    else {
      const x = handle.kind === 'in' ? vertex.inX : vertex.outX, y = handle.kind === 'in' ? vertex.inY : vertex.outY;
      if (x === 0 && y === 0 && (!this.modifiers.alt || handle.kind === 'in')) return false;
      pointToWorld(this.frame, vertex.x + x, vertex.y + y, out);
    }
    return true;
  }
  private screenToLocal(x: number, y: number): void { this.options.host.screenToWorld(x, y, this.worldPoint); pointToLocal(this.frame!, this.worldPoint.x, this.worldPoint.y, this.localPoint); }
  private setModifiers(modifiers: Readonly<ToolModifiers> | MouseEvent | KeyboardEvent): void {
    if ('shiftKey' in modifiers) { this.modifiers.shift = modifiers.shiftKey; this.modifiers.alt = modifiers.altKey; this.modifiers.ctrl = modifiers.ctrlKey; this.modifiers.meta = modifiers.metaKey; }
    else Object.assign(this.modifiers, modifiers);
    if (this.gesture) this.dirty = true; this.options.host.requestRender();
  }
  private readonly keyDown = (event: KeyboardEvent) => { if (!event.defaultPrevented && this.handleKeyDown(event)) { event.preventDefault(); event.stopImmediatePropagation(); } };
  private readonly keyModifiers = (event: KeyboardEvent) => { if (this.entity && !this.imeLocked(event)) this.setModifiers(event); };
  private imeLocked(event?: KeyboardEvent): boolean { return this.composing || !!event && (event.isComposing || event.keyCode === 229 || event.key === 'Process') || performance.now() - this.compositionEnded < 16; }
  private stop(event: PointerEvent | MouseEvent): void { event.preventDefault(); event.stopImmediatePropagation(); }
  private startGesture(kind: Gesture['kind'], contour: number, index: number, event: PointerEvent, handle: 'in' | 'out' = 'out', t = .5, inserted = false): void {
    this.screenToLocal(event.clientX, event.clientY); this.baseline = clone(this.draft); this.lastX = event.clientX; this.lastY = event.clientY;
    const point = this.baseline[contour]?.vertices[index];
    this.gesture = { kind, contour, index, handle, t, x: this.localPoint.x, y: this.localPoint.y, clientX: event.clientX, clientY: event.clientY, pointer: event.pointerId, moved: false, inserted, extend: event.shiftKey,
      alt: event.altKey, heldInX: point?.inX ?? 0, heldInY: point?.inY ?? 0, heldOutX: point?.outX ?? 0, heldOutY: point?.outY ?? 0 };
    this.change = inserted; this.dirty = inserted; this.options.surface.setPointerCapture?.(event.pointerId); this.options.surface.focus({ preventScroll: true });
    this.options.host.requestRender(); this.stop(event);
  }
  private beginHandle(handle: Handle, event: PointerEvent): boolean {
    if (!this.entity || this.gesture || event.button !== 0) return false;
    if (handle.kind === 'vertex') { this.choose(handle.contour, handle.index, event.shiftKey); this.startGesture('vertex', handle.contour, handle.index, event); }
    else if (handle.kind === 'midpoint') {
      this.draft[handle.contour] = clone([splitSegment(this.draft[handle.contour], handle.index, .5)])[0];
      this.chosen.length = 0; this.chosen.push({ contour: handle.contour, index: handle.index + 1 }); this.rebuildHandles();
      this.startGesture('vertex', handle.contour, handle.index + 1, event, 'out', .5, true);
    } else { this.choose(handle.contour, handle.index, false); this.startGesture('handle', handle.contour, handle.index, event, handle.kind); }
    return true;
  }
  private readonly down = (event: PointerEvent) => {
    if (!this.entity || this.gesture || event.button !== 0 || event.defaultPrevented || inputOwned(event) || this.imeLocked() || this.options.host.isPanGesture?.(event) || this.options.host.isSelectionEnabled?.() === false) return;
    this.setModifiers(event);
    if (this.options.selection.gizmos.hitTest(event.clientX, event.clientY, this.options.host.worldToScreen, this.hit)) {
      const handle = this.handles.find(value => value.id === this.hit.id); if (handle && this.beginHandle(handle, event)) return;
    }
    this.screenToLocal(event.clientX, event.clientY); const segment = this.nearestSegment(this.worldPoint.x, this.worldPoint.y);
    if (segment) this.startGesture('segment', segment.contour, segment.index, event, 'out', segment.t);
    else { if (!event.shiftKey) this.chosen.length = 0; this.startGesture('marquee', 0, 0, event); }
  };
  private readonly move = (event: PointerEvent) => {
    if (!this.gesture || this.gesture.pointer !== event.pointerId) return;
    this.lastX = event.clientX; this.lastY = event.clientY; this.modifiers.shift = event.shiftKey; this.modifiers.alt = event.altKey;
    this.gesture.moved ||= Math.hypot(event.clientX - this.gesture.clientX, event.clientY - this.gesture.clientY) >= SLOP;
    this.dirty = true; this.options.host.requestRender(); this.stop(event);
  };
  private applyGesture(): void {
    const gesture = this.gesture; if (!gesture || !this.dirty) return; this.dirty = false;
    if (gesture.kind === 'marquee') { if (gesture.moved) this.options.selection.stateMachine.transition(`${VECTOR_EDIT_STATE}.marquee`); return; }
    if (!gesture.moved && !gesture.inserted) return;
    this.screenToLocal(this.lastX, this.lastY);
    let dx = this.localPoint.x - gesture.x, dy = this.localPoint.y - gesture.y;
    if (this.modifiers.shift && gesture.kind !== 'handle') {
      pointToWorld(this.frame!, gesture.x, gesture.y, this.segmentPoint); const wx = this.worldPoint.x - this.segmentPoint.x, wy = this.worldPoint.y - this.segmentPoint.y;
      const length = Math.hypot(wx, wy), angle = Math.round(Math.atan2(wy, wx) / (Math.PI / 4)) * Math.PI / 4;
      pointToLocal(this.frame!, this.segmentPoint.x + length * Math.cos(angle), this.segmentPoint.y + length * Math.sin(angle), this.localPoint); dx = this.localPoint.x - gesture.x; dy = this.localPoint.y - gesture.y;
    }
    if (gesture.kind === 'vertex') {
      const step = this.options.host.isSnapEnabled?.() === false ? 0 : this.options.host.getSnapStep?.() ?? 0;
      if (step > 0 && !this.modifiers.shift) {
        const anchor = this.baseline[gesture.contour].vertices[gesture.index]; pointToWorld(this.frame!, anchor.x + dx, anchor.y + dy, this.worldPoint);
        pointToLocal(this.frame!, Math.round(this.worldPoint.x / step) * step, Math.round(this.worldPoint.y / step) * step, this.localPoint); dx = this.localPoint.x - anchor.x; dy = this.localPoint.y - anchor.y;
      }
      for (const address of this.chosen) { const source = this.baseline[address.contour]?.vertices[address.index], target = this.draft[address.contour]?.vertices[address.index]; if (source && target) { target.x = source.x + dx; target.y = source.y + dy; } }
    } else if (gesture.kind === 'handle') {
      const source = this.baseline[gesture.contour].vertices[gesture.index]; let x = this.localPoint.x - source.x, y = this.localPoint.y - source.y;
      if (this.modifiers.shift) { const length = Math.hypot(x, y), angle = Math.round(Math.atan2(y, x) / (Math.PI / 4)) * Math.PI / 4; x = length * Math.cos(angle); y = length * Math.sin(angle); }
      if (this.modifiers.alt && !gesture.alt) { const current = this.draft[gesture.contour].vertices[gesture.index]; gesture.heldInX = current.inX; gesture.heldInY = current.inY; gesture.heldOutX = current.outX; gesture.heldOutY = current.outY; }
      gesture.alt = this.modifiers.alt;
      const origin = this.modifiers.alt ? { ...source, inX: gesture.heldInX, inY: gesture.heldInY, outX: gesture.heldOutX, outY: gesture.heldOutY } : source;
      this.draft[gesture.contour].vertices[gesture.index] = { ...setVertexHandle(origin, gesture.handle, x, y, this.modifiers.alt ? 'none' : source.mirroring) };
    } else this.draft[gesture.contour] = clone([bendSegment(this.baseline[gesture.contour], gesture.index, gesture.t, dx, dy)])[0];
    this.change = true; this.pendingOps[0].patch = { contours: this.draft }; this.scratch.setBatch(this.pendingOps);
    this.options.selection.stateMachine.transition(`${VECTOR_EDIT_STATE}.${gesture.kind === 'vertex' ? 'dragging-vertex' : gesture.kind === 'handle' ? 'dragging-handle' : 'bending-segment'}`);
  }
  private readonly up = (event: PointerEvent) => {
    const gesture = this.gesture; if (!gesture || gesture.pointer !== event.pointerId) return;
    this.move(event); this.applyGesture();
    if (gesture.kind === 'marquee') this.selectMarquee(gesture);
    else if (gesture.kind === 'segment' && !gesture.moved) { this.draft[gesture.contour] = clone([splitSegment(this.draft[gesture.contour], gesture.index, gesture.t)])[0]; this.chosen.length = 0; this.chosen.push({ contour: gesture.contour, index: gesture.index + 1 }); this.change = true; }
    this.endCapture(); if (this.change) this.commit('vector:edit-nodes'); else this.scratch.clear();
    if (this.entity) { this.options.selection.stateMachine.transition(`${VECTOR_EDIT_STATE}.idle`); this.rebuildHandles(); }
    this.options.host.requestRender(); this.stop(event);
  };
  private selectMarquee(gesture: Gesture): void {
    if (!gesture.extend) this.chosen.length = 0;
    const minX = Math.min(gesture.clientX, this.lastX), minY = Math.min(gesture.clientY, this.lastY), maxX = Math.max(gesture.clientX, this.lastX), maxY = Math.max(gesture.clientY, this.lastY);
    for (let c = 0; c < this.draft.length; c++) for (let i = 0; i < this.draft[c].vertices.length; i++) {
      const vertex = this.draft[c].vertices[i]; pointToWorld(this.frame!, vertex.x, vertex.y, this.worldPoint); this.options.host.worldToScreen(this.worldPoint.x, this.worldPoint.y, this.screenPoint);
      if (this.screenPoint.x >= minX && this.screenPoint.x <= maxX && this.screenPoint.y >= minY && this.screenPoint.y <= maxY && !this.selected(c, i)) this.chosen.push({ contour: c, index: i });
    }
  }
  private endCapture(): void { const pointer = this.gesture?.pointer; this.gesture = undefined; this.dirty = false; if (pointer !== undefined && this.options.surface.hasPointerCapture?.(pointer)) this.options.surface.releasePointerCapture(pointer); }
  private cancelGesture(): void { if (!this.gesture) return; this.endCapture(); this.scratch.clear(); if (this.entity) { this.readCanonical(); this.rebuildHandles(); this.options.selection.stateMachine.transition(`${VECTOR_EDIT_STATE}.idle`); } this.options.host.requestRender(); }
  private readonly cancelPointer = (event: PointerEvent) => { if (this.gesture?.pointer === event.pointerId) this.cancelGesture(); };
  private readonly doubleClick = (event: MouseEvent) => {
    if (event.button !== 0 || event.defaultPrevented || inputOwned(event) || this.imeLocked() || event.ctrlKey || event.metaKey || event.altKey || this.options.host.isSelectionEnabled?.() === false || this.options.host.isPanGesture?.(event as PointerEvent)) return;
    if (!this.entity) {
      if (this.options.selection.stateMachine.stateId !== IDLE) return;
      const selected = this.options.selection.getSelection(); if (selected.length !== 1 || !this.options.world.getCanonical(selected[0], 'vector.path')) return;
      this.options.host.screenToWorld(event.clientX, event.clientY, this.worldPoint); const contribution = this.options.world.getSelectionContribution(selected[0]);
      if (!contribution || contribution.hitTest(selected[0], this.options.world.getPreviewView(), this.worldPoint.x, this.worldPoint.y, this.options.host.getZoom()) > 8 / this.options.host.getZoom()) return;
      if (this.enter(selected[0])) this.stop(event); return;
    }
    this.setModifiers(event);
    // Anchors own double-click even when a zero-length handle can be pulled with Alt.
    for (const handle of this.handles) if (handle.kind === 'vertex' && this.handlePosition(handle, this.worldPoint)) {
      this.options.host.worldToScreen(this.worldPoint.x, this.worldPoint.y, this.screenPoint);
      if (Math.hypot(event.clientX - this.screenPoint.x, event.clientY - this.screenPoint.y) <= 7) {
        this.cancelGesture(); this.draft[handle.contour] = clone([toggleVertex(this.draft[handle.contour], handle.index)])[0]; this.choose(handle.contour, handle.index, false); this.commit('vector:toggle-node'); this.rebuildHandles(); this.stop(event); break;
      }
    }
  };
  private deleteVertices(): void {
    if (!this.entity || !this.chosen.length) return;
    this.draft = this.draft.map((contour, c) => { const vertices = contour.vertices.filter((_vertex, i) => !this.selected(c, i)); return { closed: contour.closed && vertices.length > 2, vertices }; }).filter(contour => contour.vertices.length >= 2);
    this.chosen.length = 0;
    if (!this.draft.length) {
      const id = this.entity; this.mutating = true; this.options.host.history.begin();
      try { this.options.world.applyCanonicalTransaction('vector:delete-nodes', [{ id, aspect: 'core.transform', patch: null }], 'local:user'); this.options.host.history.commit(); }
      catch (error) { this.options.host.history.abort(); this.report(error); } finally { this.mutating = false; this.exit(); }
    } else { this.commit('vector:delete-nodes'); this.rebuildHandles(); }
    this.options.host.requestRender();
  }
  private commit(symbol: 'vector:edit-nodes' | 'vector:toggle-node' | 'vector:delete-nodes' | 'vector:set-node-mirroring' | 'vector:set-corner-radius'): void {
    if (!this.entity || !this.frame || !this.originalProps) return;
    const result = reboundRotatedVector(this.draft, this.frame, this.frame, undefined, undefined, this.frame);
    const ops: CanonicalPatchOp[] = [{ id: this.entity, aspect: 'vector.path', patch: { contours: result.nextContours, ...result.nextBaseSize } }, { id: this.entity, aspect: 'core.transform', patch: result.nextTransform }, { id: this.entity, aspect: 'core.bounds', patch: result.nextBounds }];
    this.scratch.clear(); this.mutating = true; this.options.host.history.begin();
    try { this.options.world.applyCanonicalTransaction(symbol, ops, 'local:user'); this.options.host.history.commit(); }
    catch (error) { this.options.host.history.abort(); this.report(error); }
    finally { this.mutating = false; if (this.entity) this.readCanonical(); }
  }
  private report(error: unknown): void { this.options.host.onError?.(error instanceof Error ? error : new Error(String(error))); }
  private readonly onWorldChanged = () => {
    if (this.mutating || !this.entity) return;
    if (!this.options.world.isAlive(this.entity) || this.options.world.isEntityReadOnly(this.entity) || !this.options.world.getCanonical(this.entity, 'vector.path')) { this.exit(); return; }
    const changed = this.originalProps !== this.options.world.getCanonical(this.entity, 'vector.path') || this.originalTransform !== this.options.world.getCanonical(this.entity, 'core.transform') || this.originalBounds !== this.options.world.getCanonical(this.entity, 'core.bounds');
    if (changed) {
      // Vertex addresses are positional; remote topology cannot safely reuse them.
      if (this.originalProps?.contours !== this.options.world.getCanonical<VectorPathProps>(this.entity, 'vector.path')?.contours) this.chosen.length = 0;
      this.cancelGesture(); this.readCanonical(); this.rebuildHandles(); this.options.host.requestRender();
    }
  };

  private segmentAt(contour: VectorContour, index: number, t: number, out: MutablePoint): void {
    cubicAt(contour.vertices[index], contour.vertices[(index + 1) % contour.vertices.length], t, out);
  }
  private nearestSegment(x: number, y: number): { contour: number; index: number; t: number } | undefined {
    let best = (8 / this.options.host.getZoom()) ** 2, found: { contour: number; index: number; t: number } | undefined;
    for (let c = 0; c < this.draft.length; c++) {
      const contour = this.draft[c], count = contour.vertices.length - (contour.closed ? 0 : 1);
      for (let index = 0; index < count; index++) {
        let tBest = .5, distance = Infinity;
        for (let sample = 1; sample < 64; sample++) { const t = sample / 64; this.segmentAt(contour, index, t, this.segmentPoint); pointToWorld(this.frame!, this.segmentPoint.x, this.segmentPoint.y, this.worldPoint); const d = (this.worldPoint.x - x) ** 2 + (this.worldPoint.y - y) ** 2; if (d < distance) { distance = d; tBest = t; } }
        let lo = Math.max(.001, tBest - 1 / 64), hi = Math.min(.999, tBest + 1 / 64);
        for (let step = 0; step < 12; step++) { const left = lo + (hi - lo) / 3, right = hi - (hi - lo) / 3; this.segmentAt(contour, index, left, this.segmentPoint); pointToWorld(this.frame!, this.segmentPoint.x, this.segmentPoint.y, this.worldPoint); const d1 = (this.worldPoint.x - x) ** 2 + (this.worldPoint.y - y) ** 2; this.segmentAt(contour, index, right, this.segmentPoint); pointToWorld(this.frame!, this.segmentPoint.x, this.segmentPoint.y, this.worldPoint); const d2 = (this.worldPoint.x - x) ** 2 + (this.worldPoint.y - y) ** 2; if (d1 < d2) hi = right; else lo = left; }
        const t = (lo + hi) / 2; this.segmentAt(contour, index, t, this.segmentPoint); pointToWorld(this.frame!, this.segmentPoint.x, this.segmentPoint.y, this.worldPoint); distance = (this.worldPoint.x - x) ** 2 + (this.worldPoint.y - y) ** 2;
        if (distance <= best) { best = distance; found = { contour: c, index, t }; }
      }
    }
    return found;
  }

  readonly render = (): void => {
    if (!this.entity) { this.svg.style.display = 'none'; return; }
    if (!this.options.selection.getSelection().includes(this.entity) || this.options.world.isEntityReadOnly(this.entity)) { this.exit(); this.svg.style.display = 'none'; return; }
    this.applyGesture(); this.svg.style.display = ''; const rect = this.options.hud.getBoundingClientRect(); let lines = '';
    for (const handle of this.handles) {
      const visible = this.handlePosition(handle, this.worldPoint); handle.element.style.display = visible ? '' : 'none'; if (!visible) continue;
      this.options.host.worldToScreen(this.worldPoint.x, this.worldPoint.y, this.screenPoint); const x = this.screenPoint.x - rect.left, y = this.screenPoint.y - rect.top;
      if (handle.kind === 'vertex') { handle.element.setAttribute('x', String(x - 3.5)); handle.element.setAttribute('y', String(y - 3.5)); handle.element.setAttribute('fill', this.selected(handle.contour, handle.index) ? 'var(--alid-accent,#008FF0)' : '#fff'); }
      else { handle.element.setAttribute('cx', String(x)); handle.element.setAttribute('cy', String(y)); }
      if (handle.kind === 'in' || handle.kind === 'out') { const vertex = this.draft[handle.contour].vertices[handle.index]; pointToWorld(this.frame!, vertex.x, vertex.y, this.worldPoint); this.options.host.worldToScreen(this.worldPoint.x, this.worldPoint.y, this.screenPoint); lines += `M${x},${y}L${this.screenPoint.x - rect.left},${this.screenPoint.y - rect.top}`; }
    }
    this.lines.setAttribute('d', lines);
    const gesture = this.gesture, marquee = gesture?.kind === 'marquee' && gesture.moved;
    this.marquee.style.display = marquee ? '' : 'none';
    if (marquee) { this.marquee.setAttribute('x', String(Math.min(gesture.clientX, this.lastX) - rect.left)); this.marquee.setAttribute('y', String(Math.min(gesture.clientY, this.lastY) - rect.top)); this.marquee.setAttribute('width', String(Math.abs(this.lastX - gesture.clientX))); this.marquee.setAttribute('height', String(Math.abs(this.lastY - gesture.clientY))); }
    let guide = '';
    if (gesture?.kind === 'vertex' && gesture.moved && (this.modifiers.shift || (this.options.host.isSnapEnabled?.() !== false && (this.options.host.getSnapStep?.() ?? 0) > 0))) {
      const anchor = this.draft[gesture.contour].vertices[gesture.index]; pointToWorld(this.frame!, anchor.x, anchor.y, this.worldPoint); this.options.host.worldToScreen(this.worldPoint.x, this.worldPoint.y, this.screenPoint);
      guide = `M${gesture.clientX - rect.left},${gesture.clientY - rect.top}L${this.screenPoint.x - rect.left},${this.screenPoint.y - rect.top}`;
    }
    this.snapGuide.setAttribute('d', guide);
  };
}

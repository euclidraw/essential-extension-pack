import type { CanonicalPatchOp, ToolModifiers } from '@alid/kernel';
import { reboundRotatedVector } from './rebound';
import { defaultVectorPathProps, type VectorVertex } from './types';
import type { VectorPenOptions } from './vector-host';

export const VECTOR_PEN_STATE = 'root.select.vector.pen-suite:pen';
export const VECTOR_PEN_DRAG_SLOP_SCREEN_PX = 3.5;
export const VECTOR_PEN_CLOSE_SCREEN_PX = 10;
const IDLE_STATE = 'root.select.core.select-suite:idle';
const UI_SELECTOR = '[data-canvas-ui],[data-escape-owner],button,a[href],input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="combobox"],[role="dialog"]';
type DraftVertex = { -readonly [K in keyof VectorVertex]: VectorVertex[K] };
let sequence = 0;

/** A local pen draft. Only finishing invokes the host's single creation/Undo transaction. */
export class VectorPenTool {
  private readonly abort = new AbortController();
  private readonly scratch;
  private readonly scratchId = `scratch:vector:pen:${++sequence}`;
  private readonly vertices: DraftVertex[] = [];
  private readonly previewVertices: VectorVertex[] = [];
  private readonly previewContour = { vertices: this.previewVertices, closed: false };
  private readonly previewOps: CanonicalPatchOp[];
  private readonly cursor: DraftVertex = { x: 0, y: 0, inX: 0, inY: 0, outX: 0, outY: 0, mirroring: 'none' };
  private readonly pointerWorld = { x: 0, y: 0 };
  private readonly pointerScreen = { x: 0, y: 0 };
  private readonly startScreen = { x: 0, y: 0 };
  private readonly spacePointer = { x: 0, y: 0 };
  private readonly spaceAnchor = { x: 0, y: 0 };
  private readonly screen = { x: 0, y: 0 };
  private readonly snapped = { x: 0, y: 0 };
  private readonly guide: SVGSVGElement;
  private readonly draftPath: SVGPathElement;
  private readonly rubberPath: SVGPathElement;
  private readonly anchors: SVGPathElement;
  private readonly handles: SVGPathElement;
  private readonly handleDots: SVGPathElement;
  private readonly closeRing: SVGCircleElement;
  private readonly unmountStates: Array<() => void>;
  private readonly unsubscribeFrame: () => void;
  private pointerId: number | null = null;
  private pointerKnown = false;
  private dragged = false;
  private closeHovered = false;
  private shift = false;
  private alt = false;
  private space = false;
  private composing = false;
  private compositionEndedAt = -Infinity;
  private active = false;
  private disposed = false;
  private previousCursor = '';

  constructor(private readonly options: VectorPenOptions) {
    this.scratch = options.world.createScratchOverlay(`vector:pen:${sequence}`);
    this.previewOps = [
      { id: this.scratchId, aspect: 'core.transform', patch: { x: 0, y: 0, rotation: 0 } },
      { id: this.scratchId, aspect: 'core.bounds', patch: { width: 1, height: 1 } },
      { id: this.scratchId, aspect: 'vector.path', patch: { ...defaultVectorPathProps, contours: [this.previewContour] } },
    ];
    const document = options.hud.ownerDocument, ns = 'http://www.w3.org/2000/svg';
    this.guide = document.createElementNS(ns, 'svg');
    this.guide.classList.add('alid-vector-pen-preview'); this.guide.setAttribute('aria-hidden', 'true');
    Object.assign(this.guide.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', pointerEvents: 'none', overflow: 'visible', display: 'none' });
    this.draftPath = document.createElementNS(ns, 'path'); this.rubberPath = document.createElementNS(ns, 'path');
    this.anchors = document.createElementNS(ns, 'path'); this.handles = document.createElementNS(ns, 'path');
    this.handleDots = document.createElementNS(ns, 'path'); this.closeRing = document.createElementNS(ns, 'circle');
    this.draftPath.dataset.vectorPen = 'draft'; this.rubberPath.dataset.vectorPen = 'rubber';
    this.anchors.dataset.vectorPen = 'anchors'; this.handles.dataset.vectorPen = 'handles';
    this.closeRing.dataset.vectorPen = 'close';
    for (const path of [this.draftPath, this.rubberPath, this.anchors, this.handles, this.handleDots, this.closeRing]) {
      path.setAttribute('fill', 'none'); path.setAttribute('stroke', 'var(--alid-accent, #008FF0)'); path.setAttribute('stroke-width', '1');
    }
    this.draftPath.setAttribute('stroke-width', '2'); this.rubberPath.setAttribute('stroke-dasharray', '4 3');
    this.anchors.setAttribute('fill', 'white'); this.handleDots.setAttribute('fill', 'white');
    this.closeRing.setAttribute('r', String(VECTOR_PEN_CLOSE_SCREEN_PX));
    this.guide.append(this.draftPath, this.rubberPath, this.handles, this.handleDots, this.anchors, this.closeRing);
    options.hud.append(this.guide); this.unsubscribeFrame = options.frames?.subscribe(this.render) ?? (() => {});
    const machine = options.selection.stateMachine;
    this.unmountStates = [
      machine.mountChildState('root.select', { id: 'vector.pen-suite:pen',
        onEnter: () => {
          this.active = true; this.previousCursor = options.surface.style.cursor; options.surface.style.cursor = 'crosshair';
          options.selection.select(null); options.host.requestRender();
        },
        onExit: () => { this.active = false; this.clearDraft(); options.surface.style.cursor = this.previousCursor; },
        onModifiersChanged: (_context, modifiers) => this.modifiersChanged(modifiers),
      }),
      machine.mountChildState(VECTOR_PEN_STATE, { id: 'placing' }),
      machine.mountChildState(VECTOR_PEN_STATE, { id: 'pulling-handles' }),
    ];
    const signal = this.abort.signal;
    options.surface.addEventListener('pointerdown', this.down, { signal, capture: true });
    options.surface.addEventListener('pointermove', this.move, { signal, capture: true });
    options.surface.addEventListener('pointerup', this.up, { signal, capture: true });
    options.surface.addEventListener('pointercancel', this.cancelPointer, { signal, capture: true });
    options.surface.addEventListener('lostpointercapture', this.cancelPointer, { signal, capture: true });
    options.surface.addEventListener('pointerleave', this.leave, { signal });
    if (!options.externalKeyboard) document.addEventListener('keydown', this.keyDown, { signal });
    document.addEventListener('keyup', this.keyUp, { signal });
    document.addEventListener('compositionstart', this.compositionStart, { signal, capture: true });
    document.addEventListener('compositionend', this.compositionEnd, { signal, capture: true });
    document.defaultView?.addEventListener('blur', this.cancel, { signal });
  }

  get isActive(): boolean { return this.active; }
  enter(): void {
    if (!this.disposed && !this.active) this.options.selection.stateMachine.transition(`${VECTOR_PEN_STATE}.placing`);
  }

  finish(closed = false): boolean {
    if (!this.active || this.disposed) return false;
    if (this.vertices.length < 2) { this.cancel(); return false; }
    const result = reboundRotatedVector([{ vertices: this.vertices, closed }], { x: 0, y: 0, rotation: 0 }, { width: 1, height: 1 });
    const props = { ...defaultVectorPathProps, ...result.nextBaseSize, contours: result.nextContours };
    this.options.selection.stateMachine.transition(IDLE_STATE);
    try {
      const id = this.options.creation.create({ caller: 'vector:pen', x: result.nextTransform.x, y: result.nextTransform.y,
        width: result.nextBounds.width, height: result.nextBounds.height, aspects: { 'vector.path': props } });
      this.options.selection.select(id); this.options.onCreated?.(id); return true;
    } catch (error) { this.options.host.onError?.(error instanceof Error ? error : new Error(String(error))); return false; }
  }

  readonly cancel = (): void => {
    if (this.active) this.options.selection.stateMachine.transition(IDLE_STATE);
    else this.clearDraft();
  };
  dispose(): void {
    if (this.disposed) return;
    this.cancel(); this.disposed = true; this.abort.abort(); this.unsubscribeFrame();
    for (let i = this.unmountStates.length - 1; i >= 0; i--) this.unmountStates[i]();
    this.scratch.dispose(); this.guide.remove();
  }

  /** Called before global Escape/Backspace/pan arbitration by canvas.tool-input. */
  readonly handleKeyDown = (event: KeyboardEvent): boolean => {
    if (!this.active || this.disposed || event.defaultPrevented || this.options.host.isSelectionEnabled?.() === false || this.ignoresKeyboard(event)) return false;
    if (event.ctrlKey || event.metaKey || event.getModifierState('AltGraph')) return false;
    if (event.key === 'Enter' || event.key === 'Escape') { this.finish(); return true; }
    if (event.key === 'Backspace') {
      this.releasePointer(); this.vertices.pop(); this.dragged = false; this.space = false;
      this.options.selection.stateMachine.transition(`${VECTOR_PEN_STATE}.placing`); this.updatePreview(); return true;
    }
    if (event.code === 'Space' || event.key === ' ') {
      if (this.pointerId === null) return false;
      if (!this.space) {
        const current = this.vertices[this.vertices.length - 1]; this.space = true;
        this.spacePointer.x = this.pointerWorld.x; this.spacePointer.y = this.pointerWorld.y;
        this.spaceAnchor.x = current.x; this.spaceAnchor.y = current.y;
      }
      return true;
    }
    if (event.key === 'Shift' || event.key === 'Alt') {
      this.shift = event.key === 'Shift' || event.shiftKey; this.alt = event.key === 'Alt' || event.altKey;
      this.applyPointer(); this.updatePreview(); return true;
    }
    return false;
  };

  private readonly keyDown = (event: KeyboardEvent): void => {
    if (this.handleKeyDown(event)) { event.preventDefault(); event.stopImmediatePropagation(); }
  };
  private readonly keyUp = (event: KeyboardEvent): void => {
    if (!this.active || this.ignoresKeyboard(event)) return;
    if (event.code === 'Space' || event.key === ' ') this.space = false;
    if (event.key === 'Shift' || event.key === 'Alt') { this.shift = event.shiftKey; this.alt = event.altKey; }
    if (event.key === 'Shift' || event.key === 'Alt' || event.code === 'Space' || event.key === ' ') {
      this.applyPointer(); this.updatePreview();
    }
  };
  private readonly compositionStart = (): void => { this.composing = true; };
  private readonly compositionEnd = (): void => { this.composing = false; this.compositionEndedAt = performance.now(); };
  private ignoresKeyboard(event: KeyboardEvent): boolean {
    if (this.composing || event.isComposing || event.keyCode === 229 || event.key === 'Process'
      || performance.now() - this.compositionEndedAt < 16) return true;
    // composedPath preserves native input ownership inside extension shadow roots.
    for (const target of event.composedPath()) if (target instanceof Element && target.matches(UI_SELECTOR)) return true;
    return event.target instanceof Element && event.target.closest(UI_SELECTOR) !== null;
  }
  private modifiersChanged(modifiers: Readonly<ToolModifiers>): void {
    if (!this.active || (modifiers.shift === this.shift && modifiers.alt === this.alt)) return;
    this.shift = modifiers.shift; this.alt = modifiers.alt; this.applyPointer(); this.updatePreview();
  }
  private releasePointer(): void {
    const pointer = this.pointerId; this.pointerId = null;
    if (pointer !== null && this.options.surface.hasPointerCapture?.(pointer)) this.options.surface.releasePointerCapture(pointer);
  }
  private clearDraft(): void {
    this.releasePointer(); this.vertices.length = 0; this.previewVertices.length = 0;
    this.previewContour.closed = false; this.pointerKnown = false; this.closeHovered = false; this.dragged = false;
    this.space = false; this.shift = false; this.alt = false;
    this.scratch.clear(); this.options.host.requestRender();
  }

  private readonly down = (event: PointerEvent): void => {
    if (!this.active || this.pointerId !== null || event.button !== 0 || event.defaultPrevented || this.composing
      || event.ctrlKey || event.metaKey || event.getModifierState?.('AltGraph')
      || this.options.host.isPanGesture?.(event) || this.options.host.isSelectionEnabled?.() === false) return;
    if (event.target instanceof Element && event.target.closest(UI_SELECTOR)) return;
    this.readPointer(event); this.updateCursor();
    event.preventDefault(); event.stopImmediatePropagation();
    if (this.closeHovered) { this.finish(true); return; }
    this.vertices.push({ x: this.cursor.x, y: this.cursor.y, inX: 0, inY: 0, outX: 0, outY: 0, mirroring: 'none' });
    this.pointerId = event.pointerId; this.startScreen.x = event.clientX; this.startScreen.y = event.clientY;
    this.dragged = false; this.closeHovered = false; this.space = false;
    this.options.surface.setPointerCapture?.(event.pointerId);
    this.options.selection.stateMachine.transition(`${VECTOR_PEN_STATE}.pulling-handles`); this.updatePreview();
  };
  private readonly move = (event: PointerEvent): void => {
    if (!this.active || (this.pointerId !== null && this.pointerId !== event.pointerId)) return;
    if (this.pointerId === null && (this.options.host.isPanGesture?.(event) || (event.target instanceof Element && event.target.closest(UI_SELECTOR)))) return;
    this.readPointer(event); this.applyPointer(); this.updatePreview();
    event.preventDefault(); event.stopImmediatePropagation();
  };
  private readonly up = (event: PointerEvent): void => {
    if (event.pointerId !== this.pointerId) return;
    this.readPointer(event); this.applyPointer(); this.releasePointer(); this.space = false;
    this.options.selection.stateMachine.transition(`${VECTOR_PEN_STATE}.placing`); this.updatePreview();
    event.preventDefault(); event.stopImmediatePropagation();
  };
  private readonly cancelPointer = (event: PointerEvent): void => { if (event.pointerId === this.pointerId) this.cancel(); };
  private readonly leave = (): void => {
    if (this.active && this.pointerId === null) { this.pointerKnown = false; this.updatePreview(); }
  };
  private readPointer(event: PointerEvent): void {
    this.pointerKnown = true; this.pointerScreen.x = event.clientX; this.pointerScreen.y = event.clientY;
    this.options.host.screenToWorld(event.clientX, event.clientY, this.pointerWorld);
    this.shift = event.shiftKey; this.alt = event.altKey;
  }
  private snapAngle(x: number, y: number): void {
    const length = Math.hypot(x, y), angle = Math.round(Math.atan2(y, x) / (Math.PI / 4)) * (Math.PI / 4);
    this.snapped.x = Math.cos(angle) * length; this.snapped.y = Math.sin(angle) * length;
  }
  private updateCursor(): void {
    this.cursor.x = this.pointerWorld.x; this.cursor.y = this.pointerWorld.y;
    const previous = this.vertices[this.vertices.length - 1];
    if (this.shift && previous) {
      this.snapAngle(this.cursor.x - previous.x, this.cursor.y - previous.y);
      this.cursor.x = previous.x + this.snapped.x; this.cursor.y = previous.y + this.snapped.y;
    }
    this.closeHovered = false;
    if (this.vertices.length >= 2 && this.pointerKnown) {
      const first = this.vertices[0]; this.options.host.worldToScreen(first.x, first.y, this.screen);
      this.closeHovered = Math.hypot(this.pointerScreen.x - this.screen.x, this.pointerScreen.y - this.screen.y) <= VECTOR_PEN_CLOSE_SCREEN_PX;
    }
  }
  private applyPointer(): void {
    if (!this.pointerKnown) return;
    if (this.pointerId === null) { this.updateCursor(); return; }
    const current = this.vertices[this.vertices.length - 1];
    if (!current) return;
    if (this.space) {
      current.x = this.spaceAnchor.x + this.pointerWorld.x - this.spacePointer.x;
      current.y = this.spaceAnchor.y + this.pointerWorld.y - this.spacePointer.y;
      return;
    }
    this.dragged ||= Math.hypot(this.pointerScreen.x - this.startScreen.x, this.pointerScreen.y - this.startScreen.y) >= VECTOR_PEN_DRAG_SLOP_SCREEN_PX;
    if (!this.dragged) return;
    let dx = this.pointerWorld.x - current.x, dy = this.pointerWorld.y - current.y;
    if (this.shift) { this.snapAngle(dx, dy); dx = this.snapped.x; dy = this.snapped.y; }
    current.outX = dx; current.outY = dy;
    if (this.alt) current.mirroring = 'none';
    else { current.inX = -dx || 0; current.inY = -dy || 0; current.mirroring = 'angle-and-length'; }
  }
  private updatePreview(): void {
    if (!this.vertices.length) { this.previewVertices.length = 0; this.scratch.clear(); this.options.host.requestRender(); return; }
    if (this.pointerId === null) this.updateCursor();
    this.previewVertices.length = this.vertices.length;
    for (let i = 0; i < this.vertices.length; i++) this.previewVertices[i] = this.vertices[i];
    this.previewContour.closed = this.pointerId === null && this.closeHovered;
    if (this.pointerId === null && this.pointerKnown && !this.closeHovered) this.previewVertices.push(this.cursor);
    this.scratch.setBatch(this.previewOps); this.options.host.requestRender();
  }

  /** Plane 3 paint shares the host camera latch; input handlers never write SVG geometry. */
  readonly render = (): void => {
    if (!this.active || !this.vertices.length) { this.guide.style.display = 'none'; return; }
    const rect = this.options.hud.getBoundingClientRect();
    this.guide.style.display = '';
    let draft = '', anchors = '', lines = '', dots = '';
    for (let i = 0; i < this.vertices.length; i++) {
      const v = this.vertices[i]; this.options.host.worldToScreen(v.x, v.y, this.screen);
      const x = this.screen.x - rect.left, y = this.screen.y - rect.top;
      draft += i === 0 ? `M${x},${y}` : this.segment(this.vertices[i - 1], v, rect.left, rect.top);
      anchors += `M${x - 3},${y - 3}h6v6h-6Z`;
    }
    const last = this.vertices[this.vertices.length - 1];
    this.options.host.worldToScreen(last.x, last.y, this.screen);
    const x = this.screen.x - rect.left, y = this.screen.y - rect.top;
    for (const side of ['in', 'out'] as const) {
      const dx = side === 'in' ? last.inX : last.outX, dy = side === 'in' ? last.inY : last.outY;
      if (!dx && !dy) continue;
      this.options.host.worldToScreen(last.x + dx, last.y + dy, this.screen);
      const hx = this.screen.x - rect.left, hy = this.screen.y - rect.top;
      lines += `M${x},${y}L${hx},${hy}`; dots += `M${hx - 3},${hy}a3,3 0 1,0 6,0a3,3 0 1,0 -6,0`;
    }
    this.draftPath.setAttribute('d', draft); this.anchors.setAttribute('d', anchors);
    this.handles.setAttribute('d', lines); this.handleDots.setAttribute('d', dots);
    this.rubberPath.setAttribute('d', this.pointerId === null && this.pointerKnown
      ? `M${x},${y}${this.segment(last, this.closeHovered ? this.vertices[0] : this.cursor, rect.left, rect.top)}` : '');
    this.closeRing.style.display = this.vertices.length >= 2 && this.pointerId === null && this.pointerKnown ? '' : 'none';
    this.options.host.worldToScreen(this.vertices[0].x, this.vertices[0].y, this.screen);
    this.closeRing.setAttribute('cx', String(this.screen.x - rect.left)); this.closeRing.setAttribute('cy', String(this.screen.y - rect.top));
    this.closeRing.setAttribute('fill', this.closeHovered ? 'var(--alid-accent-soft, #e5f4fe)' : 'none');
    this.closeRing.setAttribute('opacity', this.closeHovered ? '1' : '.4');
  };
  private segment(a: VectorVertex, b: VectorVertex, left: number, top: number): string {
    if (!a.outX && !a.outY && !b.inX && !b.inY) {
      this.options.host.worldToScreen(b.x, b.y, this.screen); return `L${this.screen.x - left},${this.screen.y - top}`;
    }
    this.options.host.worldToScreen(a.x + a.outX, a.y + a.outY, this.screen);
    let d = `C${this.screen.x - left},${this.screen.y - top} `;
    this.options.host.worldToScreen(b.x + b.inX, b.y + b.inY, this.screen); d += `${this.screen.x - left},${this.screen.y - top} `;
    this.options.host.worldToScreen(b.x, b.y, this.screen); return `${d}${this.screen.x - left},${this.screen.y - top}`;
  }
}

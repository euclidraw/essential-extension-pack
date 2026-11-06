import type { CanvasWorld, CanvasEntityCreation, CanvasFrameScheduler, EntityId, GizmoRegistry, MutablePoint, ToolStateMachine } from '@alid/kernel';

export interface VectorSelection {
  readonly stateMachine: ToolStateMachine<any, PointerEvent>;
  readonly gizmos: GizmoRegistry;
  getSelection(): readonly EntityId[];
  select(id: EntityId | null): void;
}
export interface VectorToolHost {
  screenToWorld(x: number, y: number, out: MutablePoint): void;
  worldToScreen(x: number, y: number, out: MutablePoint): void;
  getZoom(): number;
  requestRender(): void;
  readonly history: { begin(): void; commit(): void; abort(): void };
  isPanGesture?(event: PointerEvent): boolean;
  isSelectionEnabled?(): boolean;
  isSnapEnabled?(): boolean;
  getSnapStep?(): number;
  onError?(error: Error): void;
}
export interface VectorToolOptions {
  world: CanvasWorld;
  selection: VectorSelection;
  host: VectorToolHost;
  surface: HTMLElement;
  hud: HTMLElement;
  frames?: CanvasFrameScheduler;
  /** Host IME arbiter supplies keydown through canvas.tool-input. */
  externalKeyboard?: boolean;
}
export interface VectorPenOptions extends VectorToolOptions {
  creation: CanvasEntityCreation;
  onCreated?(id: EntityId): void;
}
export interface VectorEditorOptions extends VectorToolOptions {
  onEditingChanged?(id: EntityId | undefined): void;
}

import type { EntityId } from '@alid/kernel';

export interface WireProps extends Record<string, unknown> {
  from: EntityId | null;
  to: EntityId | null;
  fromPort?: string | null;
  toPort?: string | null;
  routing?: 'orthogonal' | 'bezier';
  /** Maximum corner radius of an orthogonal route in world units; 0 keeps sharp corners. */
  cornerRadius?: number;
}

export interface WireDerivedGeometry {
  points: Array<{ x: number; y: number }>;
  path?: string;
  /** Forward direction at the target; independent of a curve's sampling density. */
  endTangent?: { x: number; y: number };
  fromPort?: EntityPort;
  toPort?: EntityPort;
}

/** Private selection geometry for wire centerlines and their arrow silhouette. */
export interface WireSelectionGeometry {
  readonly points:readonly Readonly<{x:number;y:number}>[];
  readonly arrow?:boolean;
  readonly endTangent?:Readonly<{x:number;y:number}>;
}

export type PortSide = 'north' | 'east' | 'south' | 'west';
export interface ConnectorPortsProps extends Record<string, unknown> {
  enabled: boolean;
  sides: PortSide[];
  offset: number;
}
export interface EntityPort {
  id: string;
  entityId: EntityId;
  side: PortSide;
  x: number;
  y: number;
  nx: number;
  ny: number;
}
/** The kernel's authored layout box; re-exported for existing imports. */
export type { LayoutBounds } from '@alid/kernel';
export interface Point { x: number; y: number }

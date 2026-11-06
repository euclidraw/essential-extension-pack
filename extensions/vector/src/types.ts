
export type HandleMirroring = 'none' | 'angle' | 'angle-and-length';
export interface VectorPoint { x: number; y: number }
export interface VectorVertex {
  readonly x: number; readonly y: number;
  readonly inX: number; readonly inY: number; readonly outX: number; readonly outY: number;
  readonly mirroring: HandleMirroring;
  readonly cornerRadius?: number;
}
export interface VectorContour { readonly vertices: readonly VectorVertex[]; readonly closed: boolean }
export interface VectorPathProps extends Record<string, unknown> {
  contours: VectorContour[]; baseWidth: number; baseHeight: number;
  stroke: string; strokeWidth: number; strokeDash: 'solid' | 'dashed' | 'dotted';
  strokeCap: 'round' | 'butt' | 'square'; strokeJoin: 'round' | 'miter' | 'bevel';
  fill: string; fillOpacity: number; fillRule: 'evenodd' | 'nonzero';
  arrowStart: boolean; arrowEnd: boolean;
}
export interface VectorFrame {
  x: number; y: number; width: number; height: number; rotation: number;
  baseWidth: number; baseHeight: number;
}
export interface SampledContour {
  readonly closed: boolean; readonly points: readonly VectorPoint[];
  readonly startTangent?: VectorPoint; readonly endTangent?: VectorPoint;
}
export interface VectorArrow { readonly points: readonly VectorPoint[] }
export interface VectorDerivedGeometry extends VectorFrame {
  readonly style: Readonly<VectorPathProps>;
  readonly worldPathD: string; readonly localPathD: string; readonly fillPathD: string;
  readonly sampledContours: readonly SampledContour[];
  readonly arrows: readonly VectorArrow[];
  /** Axis-aligned visible ink bounds; object transforms still use the authored frame. */
  readonly inkBounds: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
}
export const defaultVectorPathProps: VectorPathProps = {
  contours: [], baseWidth: 1, baseHeight: 1,
  stroke: '#18181b', strokeWidth: 2, strokeDash: 'solid', strokeCap: 'round', strokeJoin: 'round',
  fill: 'none', fillOpacity: 1, fillRule: 'evenodd', arrowStart: false, arrowEnd: false,
};

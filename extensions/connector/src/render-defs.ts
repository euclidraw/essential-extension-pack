import type { GpuPolylineEndDecoration } from '@alid/kernel';

/** GPU arrowhead: tip at the end point, 9 world units long, at least 7 screen px. */
export const wireGpuArrowhead: GpuPolylineEndDecoration = Object.freeze({
  polygon: Object.freeze([
    Object.freeze({ x: 0, y: 0 }),
    Object.freeze({ x: -1, y: 0.48 }),
    Object.freeze({ x: -1, y: -0.48 }),
  ]),
  size: 9,
  minScreenSize: 7,
});

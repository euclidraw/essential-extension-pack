import { contourBounds, createVectorFrame } from './geometry';
import type { VectorContour, VectorPoint } from './types';

export interface ReboundResult {
  readonly nextTransform: { x:number;y:number;rotation:number };
  readonly nextBounds: { width:number;height:number };
  readonly nextBaseSize: { baseWidth:number;baseHeight:number };
  readonly nextContours: VectorContour[];
}
/** Normalize local origin without moving any world anchor or control point.
 * Preserve the existing axis scales, including nonuniform resizes and fillets.
 * Padding of degenerate dimensions participates in the center compensation.
 */
export function reboundRotatedVector(
  contours:readonly VectorContour[],prevTransform:{x:number;y:number;rotation?:number},prevBounds:{width:number;height:number},
  localMin?:VectorPoint,localMax?:VectorPoint,baseSize?:{baseWidth:number;baseHeight:number},
):ReboundResult{
  const bounds=contourBounds(contours),min=localMin??{x:bounds.minX,y:bounds.minY},max=localMax??{x:bounds.maxX,y:bounds.maxY};
  const frame=createVectorFrame(baseSize??{baseWidth:prevBounds.width,baseHeight:prevBounds.height},prevTransform,prevBounds),sx=frame.width/frame.baseWidth,sy=frame.height/frame.baseHeight;
  const baseWidth=Math.max(1,max.x-min.x,1/sx),baseHeight=Math.max(1,max.y-min.y,1/sy),width=baseWidth*sx,height=baseHeight*sy;
  const dx=(min.x+baseWidth/2)*sx-frame.width/2,dy=(min.y+baseHeight/2)*sy-frame.height/2,cos=Math.cos(frame.rotation),sin=Math.sin(frame.rotation);
  return{
    nextTransform:{x:frame.x+frame.width/2+dx*cos-dy*sin-width/2,y:frame.y+frame.height/2+dx*sin+dy*cos-height/2,rotation:frame.rotation},
    nextBounds:{width,height},nextBaseSize:{baseWidth,baseHeight},
    nextContours:contours.map(contour=>({closed:contour.closed,vertices:contour.vertices.map(v=>({...v,x:v.x-min.x,y:v.y-min.y}))})),
  };
}

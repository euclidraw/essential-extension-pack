import type {WireSelectionGeometry} from './types';

function validPoints(shape:WireSelectionGeometry):boolean {
  if(!shape||!Array.isArray(shape.points)||shape.points.length<2)return false;
  for(let index=0;index<shape.points.length;index++){const point=shape.points[index];if(!point||!Number.isFinite(point.x)||!Number.isFinite(point.y))return false;}
  return true;
}

/** Normalize before subtraction/projection so finite opposite endpoints cannot overflow. */
function segmentDistance(x:number,y:number,ax:number,ay:number,bx:number,by:number):number {
  const scale=Math.max(1,Math.abs(x),Math.abs(y),Math.abs(ax),Math.abs(ay),Math.abs(bx),Math.abs(by));
  const dx=bx/scale-ax/scale,dy=by/scale-ay/scale,qx=x/scale-ax/scale,qy=y/scale-ay/scale;
  const length=Math.hypot(dx,dy);
  if(!length)return Math.hypot(qx,qy)*scale;
  const ux=dx/length,uy=dy/length,along=Math.max(0,Math.min(length,qx*ux+qy*uy));
  return Math.hypot(qx-along*ux,qy-along*uy)*scale;
}

function triangleDistance(x:number,y:number,length:number,width:number):number {
  if(x<=0&&x>=-length&&Math.abs(y)<=-x*(width/length))return 0;
  return Math.min(segmentDistance(x,y,0,0,-length,width),segmentDistance(x,y,0,0,-length,-width),segmentDistance(x,y,-length,width,-length,-width));
}

/** Minimum world-space distance to the rendered stroke centerline and arrow silhouette. */
export function polylineDistance(shape:WireSelectionGeometry,x:number,y:number,zoom:number):number {
  if(!Number.isFinite(x)||!Number.isFinite(y)||!Number.isFinite(zoom)||zoom<=0||!validPoints(shape))return Infinity;
  const points=shape.points;
  let closest=Infinity;
  for(let index=1;index<points.length;index++){
    const a=points[index-1],b=points[index];
    if(a.x===b.x&&a.y===b.y)continue;
    closest=Math.min(closest,segmentDistance(x,y,a.x,a.y,b.x,b.y));
  }
  if(shape.arrow===false)return closest;
  const end=points[points.length-1];
  let dx=shape.endTangent?.x??NaN,dy=shape.endTangent?.y??NaN,length=Math.hypot(dx,dy);
  if(!Number.isFinite(length)||length<1e-9){
    length=0;
    for(let index=points.length-2;index>=0;index--){
      const scale=Math.max(1,Math.abs(end.x),Math.abs(end.y),Math.abs(points[index].x),Math.abs(points[index].y));
      dx=end.x/scale-points[index].x/scale;dy=end.y/scale-points[index].y/scale;
      const normalized=Math.hypot(dx,dy);
      if(normalized>0&&normalized*scale>=1e-9){length=normalized;break;}
    }
  }
  if(!length)return closest;
  const ux=dx/length,uy=dy/length,scale=Math.max(1,Math.abs(x),Math.abs(y),Math.abs(end.x),Math.abs(end.y));
  const qx=x/scale-end.x/scale,qy=y/scale-end.y/scale;
  const along=(qx*ux+qy*uy)*scale,across=(-qx*uy+qy*ux)*scale;
  if(!Number.isFinite(along)||!Number.isFinite(across))return closest;
  const arrowLength=Math.max(7/zoom,9);
  if(Number.isFinite(arrowLength))closest=Math.min(closest,triangleDistance(along,across,arrowLength,arrowLength*.48));
  else{
    // At an extremely small positive zoom, the finite world is covered by the
    // arrow's effectively unbounded cone; avoid constructing infinite vertices.
    if(along<=0&&Math.abs(across)<=-along*.48)closest=0;
    else{
      const norm=Math.hypot(1,.48),vx=-1/norm,vy=.48/norm;
      const upper=Math.max(0,along*vx+across*vy),lower=Math.max(0,along*vx-across*vy);
      closest=Math.min(closest,Math.hypot(along-upper*vx,across-upper*vy),Math.hypot(along-lower*vx,across+lower*vy));
    }
  }
  // SVG uses a 7×4 open chevron, slightly wider than the GPU triangle near its tip.
  return Math.min(closest,segmentDistance(along,across,0,0,-7,4),segmentDistance(along,across,0,0,-7,-4));
}

function segmentIntersectsRect(ax:number,ay:number,bx:number,by:number,minX:number,minY:number,maxX:number,maxY:number):boolean {
  if(Math.max(ax,bx)<minX||Math.min(ax,bx)>maxX||Math.max(ay,by)<minY||Math.min(ay,by)>maxY)return false;
  const scale=Math.max(1,Math.abs(ax),Math.abs(ay),Math.abs(bx),Math.abs(by),Math.abs(minX),Math.abs(minY),Math.abs(maxX),Math.abs(maxY));
  ax/=scale;ay/=scale;bx/=scale;by/=scale;minX/=scale;minY/=scale;maxX/=scale;maxY/=scale;
  let enter=0,exit=1;
  for(let axis=0;axis<2;axis++){
    const origin=axis===0?ax:ay,delta=axis===0?bx-ax:by-ay,minimum=axis===0?minX:minY,maximum=axis===0?maxX:maxY;
    if(delta===0){if(origin<minimum||origin>maximum)return false;continue;}
    const first=(minimum-origin)/delta,last=(maximum-origin)/delta;
    enter=Math.max(enter,Math.min(first,last));exit=Math.min(exit,Math.max(first,last));
    if(enter>exit)return false;
  }
  return true;
}

/** Closed rectangle/actual-segment intersection; an empty bend's AABB is not selectable. */
export function polylineIntersectsRect(shape:WireSelectionGeometry,minX:number,minY:number,maxX:number,maxY:number):boolean {
  if(!Number.isFinite(minX)||!Number.isFinite(minY)||!Number.isFinite(maxX)||!Number.isFinite(maxY)||minX>maxX||minY>maxY||!validPoints(shape))return false;
  for(let index=1;index<shape.points.length;index++){
    const a=shape.points[index-1],b=shape.points[index];
    if(a.x===b.x&&a.y===b.y)continue;
    if(segmentIntersectsRect(a.x,a.y,b.x,b.y,minX,minY,maxX,maxY))return true;
  }
  return false;
}

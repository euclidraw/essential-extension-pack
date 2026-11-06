import type {ComputedReadView,EntityId,EntitySelectionContribution} from '@alid/kernel';
import {polylineDistance,polylineIntersectsRect} from './polyline-selection';
import type {WireProps,WireDerivedGeometry} from './types';

function geometry(id:EntityId,view:ComputedReadView):Readonly<WireDerivedGeometry>|undefined {
  if(!view.isAlive(id)||!view.getCanonical<WireProps>(id,'connector.wire'))return undefined;
  const result=view.getComputed<WireDerivedGeometry>(id,'computed.connector.wire');
  if(!result||result.points.length<2)return undefined;
  for(let index=0;index<result.points.length;index++)if(!Number.isFinite(result.points[index].x)||!Number.isFinite(result.points[index].y))return undefined;
  return result;
}

/** Wire-specific selection stays beside its routing, ports and SVG renderer. */
export const wireSelectionContribution:EntitySelectionContribution={
  priority:20,
  getBounds(id,view,out){
    const wire=geometry(id,view);if(!wire)return false;
    let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    for(let index=0;index<wire.points.length;index++){const point=wire.points[index];minX=Math.min(minX,point.x);minY=Math.min(minY,point.y);maxX=Math.max(maxX,point.x);maxY=Math.max(maxY,point.y);}
    const x=minX-5,y=minY-5,width=maxX-minX+10,height=maxY-minY+10;
    if(!Number.isFinite(x)||!Number.isFinite(y)||!Number.isFinite(width)||!Number.isFinite(height))return false;
    out.x=x;out.y=y;out.width=width;out.height=height;out.rotation=0;return true;
  },
  hitTest(id,view,x,y,zoom){const wire=geometry(id,view);return wire?polylineDistance(wire,x,y,zoom):Infinity;},
  intersectsRect(id,view,minX,minY,maxX,maxY){const wire=geometry(id,view);return !!wire&&polylineIntersectsRect(wire,minX,minY,maxX,maxY);},
  getOutlinePath(id,view,projection){
    const wire=geometry(id,view);if(!wire)return '';
    const out={x:0,y:0};let path='';
    for(let index=0;index<wire.points.length;index++){
      const point=wire.points[index];projection.worldToScreen(point.x,point.y,out);
      if(!Number.isFinite(out.x)||!Number.isFinite(out.y))return '';
      path+=`${index?'L':'M'}${out.x},${out.y}`;
    }
    return path;
  },
  canTransform:()=>false,
};

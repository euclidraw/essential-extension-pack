import type { ComputedReadView, EntityId } from '@alid/kernel';
import { contourSegments, createVectorFrame, includeSegmentBounds, normalizeVectorPathProps, numberText, sampleSegment, segmentPath, transformSegment } from './geometry';
import type { SampledContour, VectorArrow, VectorDerivedGeometry, VectorPathProps, VectorPoint } from './types';

const tangent=(a:VectorPoint,b:VectorPoint,c:VectorPoint,d:VectorPoint):VectorPoint=>{
  let x=b.x-a.x,y=b.y-a.y;if(Math.hypot(x,y)<1e-9){x=c.x-a.x;y=c.y-a.y;}if(Math.hypot(x,y)<1e-9){x=d.x-a.x;y=d.y-a.y;}return{x,y};
};
export function deriveVectorPath(input:Readonly<VectorPathProps>,id:EntityId,view:ComputedReadView):VectorDerivedGeometry{
  const props=normalizeVectorPathProps(input),frame=createVectorFrame(props,view.getCanonical(id,'core.transform'),view.getCanonical(id,'core.bounds'));
  const sampledContours:SampledContour[]=[],arrows:VectorArrow[]=[],ink={minX:Infinity,minY:Infinity,maxX:-Infinity,maxY:-Infinity};
  let worldPathD='',localPathD='',fillPathD='';
  for(const contour of props.contours){
    const local=contourSegments(contour);if(!local.length)continue;
    const segments=local.map(segment=>transformSegment(segment,frame)),first=segments[0],last=segments[segments.length-1],points:VectorPoint[]=[{...first.p0}];
    const worldStart=worldPathD.length;
    localPathD+=`M${numberText(local[0].p0.x)},${numberText(local[0].p0.y)}`;worldPathD+=`M${numberText(first.p0.x)},${numberText(first.p0.y)}`;
    for(let index=0;index<segments.length;index++){const segment=segments[index];worldPathD+=segmentPath(segment);localPathD+=segmentPath(local[index]);sampleSegment(segment,points);includeSegmentBounds(segment,ink);}
    if(contour.closed){worldPathD+='Z';localPathD+='Z';fillPathD+=worldPathD.slice(worldStart);}
    const startTangent=tangent(first.p0,first.c1,first.c2,first.p3),reverse=tangent(last.p3,last.c2,last.c1,last.p0),endTangent={x:-reverse.x,y:-reverse.y};
    sampledContours.push({closed:contour.closed,points,startTangent,endTangent});
    if(!contour.closed&&props.stroke!=='none'&&props.stroke!=='transparent'&&props.strokeWidth>0){
      const addArrow=(tip:VectorPoint,direction:VectorPoint)=>{
        const norm=Math.hypot(direction.x,direction.y);if(norm<1e-9)return;
        const ux=direction.x/norm,uy=direction.y/norm,size=Math.max(7,props.strokeWidth*3.5),half=Math.max(3.5,props.strokeWidth*1.75),bx=tip.x-ux*size,by=tip.y-uy*size;
        const triangle=[{x:bx+uy*half,y:by-ux*half},{...tip},{x:bx-uy*half,y:by+ux*half}];arrows.push({points:triangle});
        for(const point of triangle){ink.minX=Math.min(ink.minX,point.x);ink.minY=Math.min(ink.minY,point.y);ink.maxX=Math.max(ink.maxX,point.x);ink.maxY=Math.max(ink.maxY,point.y);}
      };
      if(props.arrowStart)addArrow(first.p0,{x:-startTangent.x,y:-startTangent.y});if(props.arrowEnd)addArrow(last.p3,endTangent);
    }
  }
  const stroke=props.stroke!=='none'?props.strokeWidth*(props.strokeJoin==='miter'?2:.5):0;
  const inkBounds=Number.isFinite(ink.minX)?{x:ink.minX-stroke,y:ink.minY-stroke,width:ink.maxX-ink.minX+stroke*2,height:ink.maxY-ink.minY+stroke*2}:{x:frame.x,y:frame.y,width:frame.width,height:frame.height};
  return{...frame,style:props,worldPathD,localPathD,fillPathD,sampledContours,arrows,inkBounds};
}

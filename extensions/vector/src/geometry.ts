import type { HandleMirroring, VectorContour, VectorFrame, VectorPathProps, VectorPoint, VectorVertex } from './types';
import { defaultVectorPathProps } from './types';

export const finite = (value: unknown, fallback = 0): number => typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const coordinate = (value: unknown) => Math.max(-1e9, Math.min(1e9, finite(value)));
export const vertex = (x: number, y: number): VectorVertex => ({ x, y, inX: 0, inY: 0, outX: 0, outY: 0, mirroring: 'none' });
export const cloneContours = (contours: readonly VectorContour[]): VectorContour[] => contours.map(contour => ({ closed: contour.closed, vertices: contour.vertices.map(point => ({ ...point })) }));
const color = (value: unknown, fallback: string) => typeof value === 'string' && /^(?:#[0-9a-f]{3,8}|[a-z]+|(?:rgb|hsl)a?\([\d\s.,%+/-]+\))$/i.test(value) ? value : fallback;
export function normalizeVectorPathProps(input: Readonly<Partial<VectorPathProps>>): VectorPathProps {
  const contours: VectorContour[] = [];
  const requestedWidth = finite(input.strokeWidth, 2);
  if (Array.isArray(input.contours)) for (const contour of input.contours) {
    if (!contour || !Array.isArray(contour.vertices)) continue;
    const vertices: VectorVertex[] = [];
    for (const point of contour.vertices) {
      if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
      vertices.push({ x: coordinate(point.x), y: coordinate(point.y), inX: coordinate(point.inX), inY: coordinate(point.inY), outX: coordinate(point.outX), outY: coordinate(point.outY),
        mirroring: point.mirroring === 'angle' || point.mirroring === 'angle-and-length' ? point.mirroring : 'none', ...(point.cornerRadius ? { cornerRadius: Math.max(0, coordinate(point.cornerRadius)) } : {}) });
    }
    if (vertices.length) contours.push({ vertices, closed: !!contour.closed });
  }
  return { ...defaultVectorPathProps, contours,
    baseWidth: Math.max(1, Math.min(1e9, finite(input.baseWidth, 1))), baseHeight: Math.max(1, Math.min(1e9, finite(input.baseHeight, 1))),
    stroke: color(input.stroke, defaultVectorPathProps.stroke), fill: color(input.fill, 'none'),
    strokeWidth: requestedWidth > 0 ? Math.max(.01, Math.min(256, requestedWidth)) : 0, fillOpacity: Math.max(0, Math.min(1, finite(input.fillOpacity, 1))),
    strokeDash: input.strokeDash === 'dashed' || input.strokeDash === 'dotted' ? input.strokeDash : 'solid',
    strokeCap: input.strokeCap === 'butt' || input.strokeCap === 'square' ? input.strokeCap : 'round',
    strokeJoin: input.strokeJoin === 'miter' || input.strokeJoin === 'bevel' ? input.strokeJoin : 'round',
    fillRule: input.fillRule === 'nonzero' ? 'nonzero' : 'evenodd', arrowStart: !!input.arrowStart, arrowEnd: !!input.arrowEnd,
  };
}
export function createVectorFrame(props: Pick<VectorPathProps, 'baseWidth' | 'baseHeight'>, transform?: { x?: number; y?: number; rotation?: number }, bounds?: { width?: number; height?: number }): VectorFrame {
  const baseWidth=Math.max(1,Math.min(1e9,finite(props.baseWidth,1))),baseHeight=Math.max(1,Math.min(1e9,finite(props.baseHeight,1)));
  return { x:coordinate(transform?.x),y:coordinate(transform?.y),width:Math.max(1,Math.min(1e9,finite(bounds?.width,baseWidth))),height:Math.max(1,Math.min(1e9,finite(bounds?.height,baseHeight))),rotation:finite(transform?.rotation),baseWidth,baseHeight };
}
export function pointToWorld(frame: VectorFrame, x: number, y: number, out: VectorPoint): void {
  const dx=x*frame.width/frame.baseWidth-frame.width/2,dy=y*frame.height/frame.baseHeight-frame.height/2,cos=Math.cos(frame.rotation),sin=Math.sin(frame.rotation);
  out.x=frame.x+frame.width/2+dx*cos-dy*sin;out.y=frame.y+frame.height/2+dx*sin+dy*cos;
}
export function pointToLocal(frame: VectorFrame, x: number, y: number, out: VectorPoint): void {
  const dx=x-frame.x-frame.width/2,dy=y-frame.y-frame.height/2,cos=Math.cos(frame.rotation),sin=Math.sin(frame.rotation);
  out.x=(dx*cos+dy*sin+frame.width/2)*frame.baseWidth/frame.width;out.y=(-dx*sin+dy*cos+frame.height/2)*frame.baseHeight/frame.height;
}
export function cubicAt(a: VectorVertex, b: VectorVertex, t: number, out: VectorPoint): void {
  const s=1-t,p=s*s*s,q=3*s*s*t,r=3*s*t*t,u=t*t*t;
  out.x=p*a.x+q*(a.x+a.outX)+r*(b.x+b.inX)+u*b.x;out.y=p*a.y+q*(a.y+a.outY)+r*(b.y+b.inY)+u*b.y;
}
export function splitSegment(contour: VectorContour, index: number, parameter: number): VectorContour {
  const length=contour.vertices.length;if(!Number.isInteger(index)||index<0||index>=length-(contour.closed?0:1)||length<2)return contour;
  const t=Math.max(1e-6,Math.min(1-1e-6,finite(parameter,.5))),next=(index+1)%length,a=contour.vertices[index],b=contour.vertices[next],s=1-t;
  const ax=a.x+a.outX,ay=a.y+a.outY,bx=b.x+b.inX,by=b.y+b.inY;
  const p1x=s*a.x+t*ax,p1y=s*a.y+t*ay,p2x=s*ax+t*bx,p2y=s*ay+t*by,p3x=s*bx+t*b.x,p3y=s*by+t*b.y;
  const q1x=s*p1x+t*p2x,q1y=s*p1y+t*p2y,q2x=s*p2x+t*p3x,q2y=s*p2y+t*p3y,x=s*q1x+t*q2x,y=s*q1y+t*q2y;
  const vertices=contour.vertices.slice();vertices[index]={...a,outX:p1x-a.x,outY:p1y-a.y,mirroring:'none'};vertices[next]={...b,inX:p3x-b.x,inY:p3y-b.y,mirroring:'none'};
  vertices.splice(index+1,0,{x,y,inX:q1x-x,inY:q1y-y,outX:q2x-x,outY:q2y-y,mirroring:'angle'});
  return {closed:contour.closed,vertices};
}
/** Least-squares control displacement: the picked cubic point follows delta exactly. */
export function bendSegment(contour: VectorContour,index:number,t:number,dx:number,dy:number):VectorContour {
  const count=contour.vertices.length;if(!Number.isInteger(index)||index<0||index>=count-(contour.closed?0:1)||count<2||!Number.isFinite(dx)||!Number.isFinite(dy))return contour;
  t=Math.max(.02,Math.min(.98,finite(t,.5)));const s=1-t,aWeight=3*s*s*t,bWeight=3*s*t*t,denom=aWeight*aWeight+bWeight*bWeight;
  const vertices=contour.vertices.slice(),next=(index+1)%count,a=vertices[index],b=vertices[next];
  vertices[index]={...a,outX:a.outX+dx*aWeight/denom,outY:a.outY+dy*aWeight/denom,mirroring:'none',cornerRadius:0};
  vertices[next]={...b,inX:b.inX+dx*bWeight/denom,inY:b.inY+dy*bWeight/denom,mirroring:'none',cornerRadius:0};return{closed:contour.closed,vertices};
}
export function setVertexHandle(point:VectorVertex,side:'in'|'out',dx:number,dy:number,mirroring:HandleMirroring=point.mirroring):VectorVertex {
  let inX=point.inX,inY=point.inY,outX=point.outX,outY=point.outY;
  if(side==='in'){inX=dx;inY=dy;}else{outX=dx;outY=dy;}
  if(mirroring!=='none'){
    const length=Math.hypot(dx,dy),opposite=mirroring==='angle-and-length'?length:side==='in'?Math.hypot(point.outX,point.outY):Math.hypot(point.inX,point.inY);
    const x=length?-dx*opposite/length:0,y=length?-dy*opposite/length:0;
    if(side==='in'){outX=x;outY=y;}else{inX=x;inY=y;}
  }
  return{...point,inX:inX||0,inY:inY||0,outX:outX||0,outY:outY||0,mirroring,cornerRadius:0};
}
export function toggleVertex(contour:VectorContour,index:number):VectorContour {
  const p=contour.vertices[index];if(!p)return contour;const vertices=contour.vertices.slice();
  if(p.inX||p.inY||p.outX||p.outY)vertices[index]={...p,inX:0,inY:0,outX:0,outY:0,mirroring:'none'};
  else{
    const count=vertices.length,prev=vertices[index>0?index-1:contour.closed?count-1:index],next=vertices[index+1<count?index+1:contour.closed?0:index];
    const dx=next.x-prev.x,dy=next.y-prev.y,distance=Math.hypot(dx,dy),before=Math.hypot(p.x-prev.x,p.y-prev.y),after=Math.hypot(next.x-p.x,next.y-p.y),size=(before&&after?Math.min(before,after):Math.max(before,after))/3;
    const x=distance?dx*size/distance:0,y=distance?dy*size/distance:0;vertices[index]={...p,inX:-x,inY:-y,outX:x,outY:y,mirroring:'angle-and-length',cornerRadius:0};
  }return{closed:contour.closed,vertices};
}

export interface CubicSegment { p0:VectorPoint;c1:VectorPoint;c2:VectorPoint;p3:VectorPoint;line:boolean }
const lerp=(a:VectorPoint,b:VectorPoint,t:number):VectorPoint=>({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});
const point=(x:number,y:number):VectorPoint=>({x,y});
/** Fillets exist only in derived geometry; editable anchors retain the authored corner. */
export function contourSegments(contour:VectorContour):CubicSegment[]{
  const vertices=contour.vertices,count=vertices.length;if(count<2)return[];
  const corners=vertices.map((v,index)=>{
    const prev=vertices[(index+count-1)%count],next=vertices[(index+1)%count];
    if(!v.cornerRadius||(!contour.closed&&(index===0||index===count-1))||v.inX||v.inY||v.outX||v.outY||prev.outX||prev.outY||next.inX||next.inY)return undefined;
    const before=Math.hypot(v.x-prev.x,v.y-prev.y),after=Math.hypot(next.x-v.x,next.y-v.y);if(before<1e-9||after<1e-9)return undefined;
    const ix=(v.x-prev.x)/before,iy=(v.y-prev.y)/before,ox=(next.x-v.x)/after,oy=(next.y-v.y)/after,angle=Math.acos(Math.max(-1,Math.min(1,ix*ox+iy*oy)));
    if(angle<1e-6||Math.PI-angle<1e-6)return undefined;
    const tangent=Math.tan(angle/2),distance=Math.min(v.cornerRadius*tangent,before/2,after/2),radius=distance/tangent,handle=4/3*Math.tan(angle/4)*radius;
    const entry=point(v.x-ix*distance,v.y-iy*distance),exit=point(v.x+ox*distance,v.y+oy*distance);
    return{p0:entry,c1:point(entry.x+ix*handle,entry.y+iy*handle),c2:point(exit.x-ox*handle,exit.y-oy*handle),p3:exit,line:false};
  });
  const segments:CubicSegment[]=[];
  for(let index=0;index<count-(contour.closed?0:1);index++){
    const next=(index+1)%count,a=vertices[index],b=vertices[next],cornerA=corners[index],cornerB=corners[next],p0=cornerA?.p3??point(a.x,a.y),p3=cornerB?.p0??point(b.x,b.y);
    segments.push({p0,c1:cornerA?p0:point(a.x+a.outX,a.y+a.outY),c2:cornerB?p3:point(b.x+b.inX,b.y+b.inY),p3,line:!a.outX&&!a.outY&&!b.inX&&!b.inY});
    if(cornerB)segments.push(cornerB);
  }return segments;
}
export function segmentAt(segment:CubicSegment,t:number,out:VectorPoint):void{
  const s=1-t,a=s*s*s,b=3*s*s*t,c=3*s*t*t,d=t*t*t;
  out.x=a*segment.p0.x+b*segment.c1.x+c*segment.c2.x+d*segment.p3.x;out.y=a*segment.p0.y+b*segment.c1.y+c*segment.c2.y+d*segment.p3.y;
}
export function transformSegment(segment:CubicSegment,frame:VectorFrame):CubicSegment{
  const result={p0:point(0,0),c1:point(0,0),c2:point(0,0),p3:point(0,0),line:segment.line};
  for(const key of ['p0','c1','c2','p3'] as const)pointToWorld(frame,segment[key].x,segment[key].y,result[key]);return result;
}
export function sampleSegment(segment:CubicSegment,out:VectorPoint[],tolerance=.125,depth=0):void{
  const {p0,c1,c2,p3}=segment,dx=p3.x-p0.x,dy=p3.y-p0.y,length=Math.hypot(dx,dy);
  const flat=length?Math.max(Math.abs(dy*(c1.x-p0.x)-dx*(c1.y-p0.y)),Math.abs(dy*(c2.x-p0.x)-dx*(c2.y-p0.y)))/length:Math.max(Math.hypot(c1.x-p0.x,c1.y-p0.y),Math.hypot(c2.x-p0.x,c2.y-p0.y));
  // The polygon length guard also catches collinear control points that reverse direction.
  const excess=Math.hypot(c1.x-p0.x,c1.y-p0.y)+Math.hypot(c2.x-c1.x,c2.y-c1.y)+Math.hypot(p3.x-c2.x,p3.y-c2.y)-length;
  if(segment.line||depth>=14||flat<=tolerance&&excess<=tolerance){out.push({...p3});return;}
  const a=lerp(p0,c1,.5),b=lerp(c1,c2,.5),c=lerp(c2,p3,.5),d=lerp(a,b,.5),e=lerp(b,c,.5),m=lerp(d,e,.5);
  sampleSegment({p0,c1:a,c2:d,p3:m,line:false},out,tolerance,depth+1);sampleSegment({p0:m,c1:e,c2:c,p3,line:false},out,tolerance,depth+1);
}
export interface CurveBounds { minX:number;minY:number;maxX:number;maxY:number }
export function includeSegmentBounds(segment:CubicSegment,out:CurveBounds):void{
  const p=point(0,0),include=(t:number)=>{segmentAt(segment,t,p);out.minX=Math.min(out.minX,p.x);out.minY=Math.min(out.minY,p.y);out.maxX=Math.max(out.maxX,p.x);out.maxY=Math.max(out.maxY,p.y);};include(0);include(1);
  for(const axis of ['x','y'] as const){const p0=segment.p0[axis],p1=segment.c1[axis],p2=segment.c2[axis],p3=segment.p3[axis],a=-p0+3*p1-3*p2+p3,b=2*(p0-2*p1+p2),c=p1-p0;
    if(Math.abs(a)<1e-12){if(Math.abs(b)>1e-12){const t=-c/b;if(t>0&&t<1)include(t);}continue;}
    const discriminant=b*b-4*a*c;if(discriminant<0)continue;const root=Math.sqrt(discriminant),t1=(-b+root)/(2*a),t2=(-b-root)/(2*a);if(t1>0&&t1<1)include(t1);if(t2>0&&t2<1)include(t2);
  }
}
export function contourBounds(contours:readonly VectorContour[]):CurveBounds{
  const bounds={minX:Infinity,minY:Infinity,maxX:-Infinity,maxY:-Infinity};
  for(const contour of contours){const segments=contourSegments(contour);if(!segments.length&&contour.vertices.length){const p=contour.vertices[0];bounds.minX=Math.min(bounds.minX,p.x);bounds.minY=Math.min(bounds.minY,p.y);bounds.maxX=Math.max(bounds.maxX,p.x);bounds.maxY=Math.max(bounds.maxY,p.y);}for(const segment of segments)includeSegmentBounds(segment,bounds);}
  return Number.isFinite(bounds.minX)?bounds:{minX:0,minY:0,maxX:0,maxY:0};
}
export const numberText=(value:number):string=>String(Math.round(value*1e8)/1e8);
export function segmentPath(segment:CubicSegment):string{
  const {c1,c2,p3}=segment;return segment.line?`L${numberText(p3.x)},${numberText(p3.y)}`:`C${numberText(c1.x)},${numberText(c1.y)} ${numberText(c2.x)},${numberText(c2.y)} ${numberText(p3.x)},${numberText(p3.y)}`;
}

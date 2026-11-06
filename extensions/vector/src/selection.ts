import type { ComputedReadView, EntityId, EntitySelectionContribution } from '@alid/kernel';
import type { SampledContour, VectorDerivedGeometry, VectorPathProps, VectorPoint } from './types';

export function pointInContours(x:number,y:number,contours:readonly SampledContour[],fillRule:'evenodd'|'nonzero'):boolean{
  let winding=0,crossings=0;
  for(let ci=0;ci<contours.length;ci++){
    const contour=contours[ci],points=contour.points;if(!contour.closed||points.length<3)continue;
    for(let i=0,j=points.length-1;i<points.length;j=i++){
      const a=points[j],b=points[i];if((a.y>y)!==(b.y>y)&&x<a.x+(y-a.y)*(b.x-a.x)/(b.y-a.y))crossings++;
      const cross=(b.x-a.x)*(y-a.y)-(x-a.x)*(b.y-a.y);
      if(a.y<=y){if(b.y>y&&cross>0)winding++;}else if(b.y<=y&&cross<0)winding--;
    }
  }return fillRule==='evenodd'?(crossings&1)===1:winding!==0;
}
const segmentDistance=(x:number,y:number,a:VectorPoint,b:VectorPoint):number=>{
  const dx=b.x-a.x,dy=b.y-a.y,d=dx*dx+dy*dy,t=d?Math.max(0,Math.min(1,((x-a.x)*dx+(y-a.y)*dy)/d)):0;
  return Math.hypot(x-a.x-dx*t,y-a.y-dy*t);
};
const numericSegmentDistance=(x:number,y:number,ax:number,ay:number,bx:number,by:number):number=>{
  const dx=bx-ax,dy=by-ay,length2=dx*dx+dy*dy,t=length2?Math.max(0,Math.min(1,((x-ax)*dx+(y-ay)*dy)/length2)):0;
  return Math.hypot(x-ax-dx*t,y-ay-dy*t);
};
function triangleDistance(x:number,y:number,ax:number,ay:number,bx:number,by:number,cx:number,cy:number):number{
  const a=(bx-ax)*(y-ay)-(by-ay)*(x-ax),b=(cx-bx)*(y-by)-(cy-by)*(x-bx),c=(ax-cx)*(y-cy)-(ay-cy)*(x-cx);
  if((a>=0&&b>=0&&c>=0)||(a<=0&&b<=0&&c<=0))return 0;
  return Math.min(numericSegmentDistance(x,y,ax,ay,bx,by),numericSegmentDistance(x,y,bx,by,cx,cy),numericSegmentDistance(x,y,cx,cy,ax,ay));
}
/** Distance to visible stroke ink, including the authored end caps. All temporaries are numeric. */
function stripDistance(x:number,y:number,ax:number,ay:number,bx:number,by:number,half:number,start:boolean,end:boolean,cap:VectorPathProps['strokeCap']):number{
  const dx=bx-ax,dy=by-ay,length=Math.hypot(dx,dy);if(length<1e-12)return cap==='round'&&(start||end)?Math.max(0,Math.hypot(x-ax,y-ay)-half):Infinity;
  const along=((x-ax)*dx+(y-ay)*dy)/length,normal=Math.abs((x-ax)*dy-(y-ay)*dx)/length;
  const lo=start&&cap==='square'?-half:0,hi=end&&cap==='square'?length+half:length;
  let distance=Math.hypot(Math.max(lo-along,along-hi,0),Math.max(normal-half,0));
  if(cap==='round'){if(start)distance=Math.min(distance,Math.max(0,Math.hypot(x-ax,y-ay)-half));if(end)distance=Math.min(distance,Math.max(0,Math.hypot(x-bx,y-by)-half));}
  return distance;
}
function joinDistance(x:number,y:number,prev:VectorPoint,p:VectorPoint,next:VectorPoint,half:number,join:VectorPathProps['strokeJoin']):number{
  const a=Math.hypot(p.x-prev.x,p.y-prev.y),b=Math.hypot(next.x-p.x,next.y-p.y);if(a<1e-12||b<1e-12)return Infinity;
  const ux=(p.x-prev.x)/a,uy=(p.y-prev.y)/a,vx=(next.x-p.x)/b,vy=(next.y-p.y)/b,cross=ux*vy-uy*vx;
  if(join==='round')return Math.max(0,Math.hypot(x-p.x,y-p.y)-half);
  if(Math.abs(cross)<1e-12)return Infinity;
  const side=cross>0?1:-1,ax=p.x+uy*half*side,ay=p.y-ux*half*side,bx=p.x+vy*half*side,by=p.y-vx*half*side;
  let distance=triangleDistance(x,y,p.x,p.y,ax,ay,bx,by);
  if(join==='miter'){
    const t=((bx-ax)*vy-(by-ay)*vx)/cross,mx=ax+ux*t,my=ay+uy*t;
    // Same miter limit as the SVG publication path.
    if(Math.hypot(mx-p.x,my-p.y)<=half*4)distance=Math.min(distance,triangleDistance(x,y,ax,ay,mx,my,bx,by));
  }
  return distance;
}
function distanceToStroke(contours:readonly SampledContour[],props:Readonly<VectorPathProps>,x:number,y:number):number{
  const half=props.strokeWidth/2,solid=props.strokeDash==='solid',dash=props.strokeDash==='dotted'?Math.max(.01,props.strokeWidth*.05):props.strokeWidth*4,gap=props.strokeWidth*(props.strokeDash==='dotted'?2.5:3),period=dash+gap,cap=props.strokeDash==='dotted'?'round':props.strokeCap;
  let distance=Infinity;
  for(let ci=0;ci<contours.length;ci++){
    const contour=contours[ci],points=contour.points;let offset=0;
    for(let i=1;i<points.length;i++){
      const a=points[i-1],b=points[i],dx=b.x-a.x,dy=b.y-a.y,length=Math.hypot(dx,dy);
      if(solid)distance=Math.min(distance,stripDistance(x,y,a.x,a.y,b.x,b.y,half,!contour.closed&&i===1,!contour.closed&&i===points.length-1,cap));
      else if(length>1e-12){
        // Only the dash nearest the projection and its neighbors can minimize distance.
        // This avoids walking millions of dashes on very long, thin segments.
        const projected=Math.max(0,Math.min(length,((x-a.x)*dx+(y-a.y)*dy)/length)),cycle=Math.floor((offset+projected)/period);
        for(let neighbor=-1;neighbor<=1;neighbor++){
          const k=Math.max(0,cycle+neighbor);
          const start=k*period,end=start+dash,lo=Math.max(offset,start),hi=Math.min(offset+length,end);if(hi<lo)continue;
          const t0=(lo-offset)/length,t1=(hi-offset)/length;
          distance=Math.min(distance,stripDistance(x,y,a.x+dx*t0,a.y+dy*t0,a.x+dx*t1,a.y+dy*t1,half,lo===start||i===1,hi===end||i===points.length-1,cap));
        }
      }
      offset+=length;
      if(i<points.length-1){const phase=offset%period;if(solid||phase>1e-9&&phase<dash-1e-9)distance=Math.min(distance,joinDistance(x,y,a,b,points[i+1],half,props.strokeJoin));}
    }
    if(contour.closed&&points.length>2&&(solid||offset%period>1e-9&&offset%period<dash-1e-9))distance=Math.min(distance,joinDistance(x,y,points[points.length-2],points[0],points[1],half,props.strokeJoin));
  }
  return distance;
}
export function minDistanceToSampledContours(contours:readonly SampledContour[],x:number,y:number):number{
  let distance=Infinity;
  for(let ci=0;ci<contours.length;ci++){const points=contours[ci].points;for(let i=1;i<points.length;i++)distance=Math.min(distance,segmentDistance(x,y,points[i-1],points[i]));}
  return distance;
}
function insideTriangle(x:number,y:number,points:readonly VectorPoint[]):boolean{
  const a=points[0],b=points[1],c=points[2],one=(b.x-a.x)*(y-a.y)-(b.y-a.y)*(x-a.x),two=(c.x-b.x)*(y-b.y)-(c.y-b.y)*(x-b.x),three=(a.x-c.x)*(y-c.y)-(a.y-c.y)*(x-c.x);
  return (one>=0&&two>=0&&three>=0)||(one<=0&&two<=0&&three<=0);
}
function segmentIntersectsRect(a:VectorPoint,b:VectorPoint,minX:number,minY:number,maxX:number,maxY:number):boolean{
  let enter=0,exit=1;const dx=b.x-a.x,dy=b.y-a.y;
  if(dx===0){if(a.x<minX||a.x>maxX)return false;}else{const one=(minX-a.x)/dx,two=(maxX-a.x)/dx;enter=Math.max(enter,Math.min(one,two));exit=Math.min(exit,Math.max(one,two));}
  if(dy===0){if(a.y<minY||a.y>maxY)return false;}else{const one=(minY-a.y)/dy,two=(maxY-a.y)/dy;enter=Math.max(enter,Math.min(one,two));exit=Math.min(exit,Math.max(one,two));}
  return enter<=exit;
}
export function contoursIntersectRect(contours:readonly SampledContour[],minX:number,minY:number,maxX:number,maxY:number):boolean{
  for(let ci=0;ci<contours.length;ci++){const points=contours[ci].points;for(let i=1;i<points.length;i++)if(segmentIntersectsRect(points[i-1],points[i],minX,minY,maxX,maxY))return true;}
  return false;
}
function strokeIntersectsRect(contours:readonly SampledContour[],props:Readonly<VectorPathProps>,minX:number,minY:number,maxX:number,maxY:number):boolean{
  // Test visible caps/joins at marquee corners as well as the centerline footprint.
  if(distanceToStroke(contours,props,minX,minY)===0||distanceToStroke(contours,props,maxX,minY)===0||distanceToStroke(contours,props,minX,maxY)===0||distanceToStroke(contours,props,maxX,maxY)===0)return true;
  const half=props.strokeWidth/2,dash=props.strokeDash==='dotted'?Math.max(.01,props.strokeWidth*.05):props.strokeWidth*4,period=dash+props.strokeWidth*(props.strokeDash==='dotted'?2.5:3);
  minX-=half;minY-=half;maxX+=half;maxY+=half;
  for(let ci=0;ci<contours.length;ci++){
    const points=contours[ci].points;let offset=0;
    for(let i=1;i<points.length;i++){
      const a=points[i-1],b=points[i],dx=b.x-a.x,dy=b.y-a.y,length=Math.hypot(dx,dy);let enter=0,exit=1;
      if(dx===0){if(a.x<minX||a.x>maxX){offset+=length;continue;}}else{const one=(minX-a.x)/dx,two=(maxX-a.x)/dx;enter=Math.max(enter,Math.min(one,two));exit=Math.min(exit,Math.max(one,two));}
      if(dy===0){if(a.y<minY||a.y>maxY){offset+=length;continue;}}else{const one=(minY-a.y)/dy,two=(maxY-a.y)/dy;enter=Math.max(enter,Math.min(one,two));exit=Math.min(exit,Math.max(one,two));}
      if(enter<=exit){
        if(props.strokeDash==='solid')return true;
        const start=offset+length*enter,end=offset+length*exit;
        if(start%period<=dash||Math.floor(end/period)>Math.floor(start/period))return true;
      }
      offset+=length;
    }
  }
  return false;
}
const read=(id:EntityId,view:ComputedReadView):Readonly<VectorDerivedGeometry>|undefined=>view.isAlive(id)&&view.getCanonical(id,'vector.path')?view.getComputed<VectorDerivedGeometry>(id,'computed.vector.path'):undefined;
const visible=(paint:string)=>paint!=='none'&&paint!=='transparent';

export function createVectorSelectionContribution(isEditingEntity:(id:EntityId)=>boolean=()=>false):EntitySelectionContribution{
  const projected={x:0,y:0};
  return{
    priority:20,
    getBounds(id,view,out){const geometry=read(id,view);if(!geometry||!geometry.sampledContours.length)return false;out.x=geometry.x;out.y=geometry.y;out.width=geometry.width;out.height=geometry.height;out.rotation=geometry.rotation;return true;},
    hitTest(id,view,x,y,zoom){
      const geometry=read(id,view);if(!geometry||!Number.isFinite(x)||!Number.isFinite(y)||!Number.isFinite(zoom)||zoom<=0)return Infinity;const props=geometry.style,tolerance=8/zoom,filled=visible(props.fill)&&props.fillOpacity>0;
      if(filled&&pointInContours(x,y,geometry.sampledContours,props.fillRule))return 0;
      let distance=Infinity;
      if(visible(props.stroke)&&props.strokeWidth>0)distance=distanceToStroke(geometry.sampledContours,props,x,y);
      for(let ai=0;ai<geometry.arrows.length;ai++){
        const points=geometry.arrows[ai].points;if(insideTriangle(x,y,points))return 0;
        for(let i=0;i<3;i++)distance=Math.min(distance,segmentDistance(x,y,points[i],points[(i+1)%3]));
      }
      return distance<=tolerance?distance:Infinity;
    },
    intersectsRect(id,view,minX,minY,maxX,maxY){
      const geometry=read(id,view);if(!geometry||!Number.isFinite(minX)||!Number.isFinite(minY)||!Number.isFinite(maxX)||!Number.isFinite(maxY)||minX>maxX||minY>maxY)return false;const props=geometry.style;
      if(visible(props.stroke)&&props.strokeWidth>0&&strokeIntersectsRect(geometry.sampledContours,props,minX,minY,maxX,maxY))return true;
      if(visible(props.fill)&&props.fillOpacity>0){
        if(pointInContours(minX,minY,geometry.sampledContours,props.fillRule)||pointInContours(maxX,minY,geometry.sampledContours,props.fillRule)||pointInContours(minX,maxY,geometry.sampledContours,props.fillRule)||pointInContours(maxX,maxY,geometry.sampledContours,props.fillRule)||pointInContours((minX+maxX)/2,(minY+maxY)/2,geometry.sampledContours,props.fillRule))return true;
        for(let ci=0;ci<geometry.sampledContours.length;ci++){const contour=geometry.sampledContours[ci];if(!contour.closed)continue;const points=contour.points;for(let i=1;i<points.length;i++)if(segmentIntersectsRect(points[i-1],points[i],minX,minY,maxX,maxY))return true;}
      }
      for(let ai=0;ai<geometry.arrows.length;ai++){const points=geometry.arrows[ai].points;if(insideTriangle((minX+maxX)/2,(minY+maxY)/2,points))return true;for(let i=0;i<3;i++)if(segmentIntersectsRect(points[i],points[(i+1)%3],minX,minY,maxX,maxY))return true;}
      return false;
    },
    getOutlinePath(id,view,projection){
      const geometry=read(id,view);if(!geometry)return'';let path='';
      for(let ci=0;ci<geometry.sampledContours.length;ci++){const contour=geometry.sampledContours[ci];for(let i=0;i<contour.points.length;i++){const p=contour.points[i];projection.worldToScreen(p.x,p.y,projected);path+=`${i?'L':'M'}${projected.x},${projected.y}`;}if(contour.closed)path+='Z';}
      for(let ai=0;ai<geometry.arrows.length;ai++){const points=geometry.arrows[ai].points;for(let i=0;i<points.length;i++){projection.worldToScreen(points[i].x,points[i].y,projected);path+=`${i?'L':'M'}${projected.x},${projected.y}`;}path+='Z';}return path;
    },
    canTransform:(id)=>!isEditingEntity(id),
  };
}

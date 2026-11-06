import type { LayoutBounds, Point } from './types';
import {isSimplePolyline,segmentsConflict,selfClearancePenalty} from './self-avoidance';

export interface Obstacle {
  minX: number; minY: number; maxX: number; maxY: number;
  /** The AABB remains the broad phase/grid envelope; clipping uses this exact rotated body. */
  rect?: { cx:number;cy:number;cos:number;sin:number;halfWidth:number;halfHeight:number };
}
export interface RouteBudget { states:number;checks:number }
export interface RouteDirections {
  /** Outward source normal and outward target normal, before entering the target. */
  source?: Point;
  target?: Point;
  fastOnly?: boolean;
  /** Mutable remaining work, shared by every port pair and retry in one derivation. */
  budget?: RouteBudget;
  /** Upper bound on the rectilinear route's distance and bend cost. */
  maxCost?: number;
  /** Actual ports. The source→start and end→target access leads are reserved. */
  terminals?: {source:Point;target:Point};
}
export type RouteSearchOptions = RouteDirections;
const EPS = 1e-7;
export const midpoint = (a: number, b: number): number => a / 2 + b / 2;
export const finitePoint = (p: Point): boolean => Number.isFinite(p.x) && Number.isFinite(p.y);

export function obstacleFromBounds(bounds: LayoutBounds, padding = 12): Obstacle {
  const angle = Number.isFinite(bounds.rotation) ? bounds.rotation! : 0;
  const cosine = Math.abs(Math.cos(angle)), sine = Math.abs(Math.sin(angle));
  const width = bounds.width * cosine + bounds.height * sine, height = bounds.width * sine + bounds.height * cosine;
  const cx = bounds.x + bounds.width / 2, cy = bounds.y + bounds.height / 2;
  return { minX: cx - width / 2 - padding, minY: cy - height / 2 - padding, maxX: cx + width / 2 + padding, maxY: cy + height / 2 + padding };
}
export function bodyObstacleFromBounds(bounds:LayoutBounds):Obstacle {
  const angle=Number.isFinite(bounds.rotation)?bounds.rotation!:0;
  return {...obstacleFromBounds(bounds,0),rect:{cx:bounds.x+bounds.width/2,cy:bounds.y+bounds.height/2,cos:Math.cos(angle),sin:Math.sin(angle),halfWidth:bounds.width/2,halfHeight:bounds.height/2}};
}
function validObstacle(box:Obstacle):boolean {
  if(!Number.isFinite(box.minX)||!Number.isFinite(box.minY)||!Number.isFinite(box.maxX)||!Number.isFinite(box.maxY)||box.minX>box.maxX||box.minY>box.maxY)return false;
  const r=box.rect;
  if(!r)return true;
  if(!Number.isFinite(r.cx)||!Number.isFinite(r.cy)||!Number.isFinite(r.cos)||!Number.isFinite(r.sin)||!Number.isFinite(r.halfWidth)||!Number.isFinite(r.halfHeight)||r.halfWidth<=0||r.halfHeight<=0||Math.abs(Math.hypot(r.cos,r.sin)-1)>1e-6)return false;
  const x=Math.abs(r.cos)*r.halfWidth+Math.abs(r.sin)*r.halfHeight,y=Math.abs(r.sin)*r.halfWidth+Math.abs(r.cos)*r.halfHeight;
  return Number.isFinite(x)&&Number.isFinite(y)&&box.minX<=r.cx-x+EPS&&box.maxX>=r.cx+x-EPS&&box.minY<=r.cy-y+EPS&&box.maxY>=r.cy+y-EPS;
}
export function inside(point: Point, obstacle: Obstacle): boolean {
  if(point.x<=obstacle.minX+EPS||point.x>=obstacle.maxX-EPS||point.y<=obstacle.minY+EPS||point.y>=obstacle.maxY-EPS)return false;
  const r=obstacle.rect;
  if(!r)return true;
  const dx=point.x-r.cx,dy=point.y-r.cy,x=dx*r.cos+dy*r.sin,y=-dx*r.sin+dy*r.cos;
  return x>-r.halfWidth+EPS&&x<r.halfWidth-EPS&&y>-r.halfHeight+EPS&&y<r.halfHeight-EPS;
}
/** 1 = proven clear, 0 = collision/invalid geometry, -1 = collision-check budget exhausted. */
function segmentStatus(a:Point,b:Point,obstacles:readonly Obstacle[],budget?:RouteBudget,collisions?:Set<Obstacle>):number {
  if(!finitePoint(a)||!finitePoint(b)||!Number.isFinite(b.x-a.x)||!Number.isFinite(b.y-a.y))return 0;
  const segmentMinX=Math.min(a.x,b.x),segmentMaxX=Math.max(a.x,b.x),segmentMinY=Math.min(a.y,b.y),segmentMaxY=Math.max(a.y,b.y);
  let clear=true;
  for (const box of obstacles) {
    if(!validObstacle(box))return 0;
    // Disjoint envelopes are a proof, and do not spend an exact collision check.
    if(segmentMaxX<=box.minX+EPS||segmentMinX>=box.maxX-EPS||segmentMaxY<=box.minY+EPS||segmentMinY>=box.maxY-EPS)continue;
    if(budget){if(!(budget.checks>0))return -1;budget.checks=Math.max(0,budget.checks-1);}
    let ax=a.x,ay=a.y,bx=b.x,by=b.y,minX=box.minX,minY=box.minY,maxX=box.maxX,maxY=box.maxY;
    if(box.rect){
      const r=box.rect,adx=ax-r.cx,ady=ay-r.cy,bdx=bx-r.cx,bdy=by-r.cy;
      ax=adx*r.cos+ady*r.sin;ay=-adx*r.sin+ady*r.cos;bx=bdx*r.cos+bdy*r.sin;by=-bdx*r.sin+bdy*r.cos;
      minX=-r.halfWidth;maxX=r.halfWidth;minY=-r.halfHeight;maxY=r.halfHeight;
    }
    if(!Number.isFinite(ax)||!Number.isFinite(ay)||!Number.isFinite(bx)||!Number.isFinite(by)||!Number.isFinite(bx-ax)||!Number.isFinite(by-ay))return 0;
    let enter = 0, exit = 1, misses = false;
    for (let axis=0;axis<2;axis++) {
      const low=(axis===0?minX:minY)+EPS,high=(axis===0?maxX:maxY)-EPS;
      const origin=axis===0?ax:ay,delta=axis===0?bx-ax:by-ay;
      if (low >= high) { misses = true; break; }
      if (delta === 0) { if (origin <= low || origin >= high) { misses = true; break; } }
      else {
        const first = (low-origin)/delta,last=(high-origin)/delta;
        enter = Math.max(enter, Math.min(first, last)); exit = Math.min(exit, Math.max(first, last));
        if (enter >= exit) { misses = true; break; }
      }
    }
    if(!misses&&enter<exit){
      if(!collisions&&!budget)return 0;
      // With a shared budget, finish this broad-phase overlap set so input order
      // cannot change the work charged for the same blocked segment.
      clear=false;collisions?.add(box);
    }
  }
  return clear?1:0;
}
/** Open-body clipping also checks diagonal escapes and sampled curves without temporary points. */
export function segmentAvoidsObstacles(a:Point,b:Point,obstacles:readonly Obstacle[],budget?:RouteBudget):boolean {
  return segmentStatus(a,b,obstacles,budget)===1;
}

/** Drop only monotonic collinear points; never erase a reversal or a port-normal turn. */
export function simplify(points: readonly Point[]): Point[] {
  const result: Point[] = [];
  for (const point of points) {
    const previous = result.at(-1);
    if (previous && Math.hypot(previous.x - point.x, previous.y - point.y) < EPS) continue;
    const before = result.at(-2);
    if (before && previous) {
      const ax = previous.x - before.x, ay = previous.y - before.y, bx = point.x - previous.x, by = point.y - previous.y;
      const cross = ax * by - ay * bx, scale = Math.hypot(ax, ay) * Math.hypot(bx, by);
      if (Number.isFinite(scale) && Math.abs(cross) <= EPS * Math.max(1, scale) && ax * bx + ay * by >= 0) result.pop();
    }
    result.push(point);
  }
  return result;
}
function direction(a: Point, b: Point): number { return Math.abs(b.x - a.x) >= Math.abs(b.y - a.y) ? b.x > a.x ? 1 : 3 : b.y > a.y ? 2 : 4; }
function axis(dir: number): number { return dir % 2 ? 1 : 2; }
function compatible(a: Point, b: Point, normal: Point | undefined, source: boolean): boolean {
  if (!normal) return true;
  const dot = (b.x - a.x) * normal.x + (b.y - a.y) * normal.y;
  return source ? dot >= -EPS : dot <= EPS;
}
function pathCost(points: readonly Point[], normals: RouteDirections): number {
  let cost = 0, previous = 0;
  for (let i = 1; i < points.length; i++) {
    const current = direction(points[i - 1], points[i]);
    cost += Math.abs(points[i].x - points[i - 1].x) + Math.abs(points[i].y - points[i - 1].y);
    if (previous && axis(previous) !== axis(current)) cost += 12;
    previous = current;
  }
  const first = points[1], last = points.at(-2);
  if (first && normals.source && Math.abs((first.x - points[0].x) * normals.source.y - (first.y - points[0].y) * normals.source.x) > EPS) cost += 12;
  if (last && normals.target && Math.abs((points.at(-1)!.x - last.x) * normals.target.y - (points.at(-1)!.y - last.y) * normals.target.x) > EPS) cost += 12;
  return cost;
}

function pathStatus(path:readonly Point[],obstacles:readonly Obstacle[],budget:RouteBudget,collisions?:Set<Obstacle>):number {
  let clear=true;
  for(let index=1;index<path.length;index++){
    const status=segmentStatus(path[index-1],path[index],obstacles,budget,collisions);
    if(status<0)return -1;
    if(status===0){if(!collisions)return 0;clear=false;}
  }
  return clear?1:0;
}
function samePoint(a:Point,b:Point):boolean {return Math.hypot(a.x-b.x,a.y-b.y)<EPS;}
function joinedPath(path:readonly Point[],options:RouteDirections):Point[] {
  return options.terminals?simplify([options.terminals.source,...path,options.terminals.target]):simplify(path);
}
/** Contact/retrace tests share the collision budget; disjoint segment envelopes are free. */
function pairStatus(a:Point,b:Point,c:Point,d:Point,allowSharedEndpoint:boolean,budget:RouteBudget):number {
  if(samePoint(a,b)||samePoint(c,d))return 1;
  if(Math.max(a.x,b.x)<Math.min(c.x,d.x)-EPS||Math.min(a.x,b.x)>Math.max(c.x,d.x)+EPS||Math.max(a.y,b.y)<Math.min(c.y,d.y)-EPS||Math.min(a.y,b.y)>Math.max(c.y,d.y)+EPS)return 1;
  if(!(budget.checks>0))return -1;budget.checks=Math.max(0,budget.checks-1);
  return segmentsConflict(a,b,c,d,allowSharedEndpoint)?0:1;
}
function simplePathStatus(path:readonly Point[],options:RouteDirections,budget:RouteBudget):number {
  const whole=joinedPath(path,options);
  for(let first=1;first<whole.length;first++)for(let second=first+1;second<whole.length;second++){
    const status=pairStatus(whole[first-1],whole[first],whole[second-1],whole[second],second===first+1,budget);
    if(status!==1)return status;
  }
  return isSimplePolyline(whole)?1:0;
}
/** Cheap candidates use only nearby envelopes; every returned route is validated against the full scene. */
function fastRoute(start:Point,end:Point,obstacles:readonly Obstacle[],options:RouteDirections,budget:RouteBudget):Point[]|null {
  const midX = midpoint(start.x, end.x), midY = midpoint(start.y, end.y);
  const horizontal = [start, { x: midX, y: start.y }, { x: midX, y: end.y }, end];
  const vertical = [start, { x: start.x, y: midY }, { x: end.x, y: midY }, end];
  const direct = options.source && Math.abs(options.source.y) > Math.abs(options.source.x) ? [vertical, horizontal] : [horizontal, vertical];
  direct.push([start, { x: end.x, y: start.y }, end], [start, { x: start.x, y: end.y }, end]);
  if(obstacles.length){
    let left=Math.min(start.x,end.x),right=Math.max(start.x,end.x),top=Math.min(start.y,end.y),bottom=Math.max(start.y,end.y);
    for(const box of obstacles){left=Math.min(left,box.minX);right=Math.max(right,box.maxX);top=Math.min(top,box.minY);bottom=Math.max(bottom,box.maxY);}
    left-=1;right+=1;top-=1;bottom+=1;
    direct.push([start,{x:start.x,y:top},{x:end.x,y:top},end],[start,{x:start.x,y:bottom},{x:end.x,y:bottom},end],[start,{x:left,y:start.y},{x:left,y:end.y},end],[start,{x:right,y:start.y},{x:right,y:end.y},end]);
  }
  const candidates=direct.map(simplify).filter(path=>path.length>=2&&path.every(finitePoint)&&compatible(path[0],path[1],options.source,true)&&compatible(path.at(-2)!,path.at(-1)!,options.target,false)).map(path=>({path,cost:pathCost(path,options)+selfClearancePenalty(joinedPath(path,options))})).filter(candidate=>Number.isFinite(candidate.cost)&&candidate.cost<=(options.maxCost??Infinity)).sort((a,b)=>a.cost-b.cost);
  for(const candidate of candidates){
    const simple=simplePathStatus(candidate.path,options,budget);if(simple<0)return null;if(simple===0)continue;
    const status=pathStatus(candidate.path,obstacles,budget);if(status<0)return null;if(status===1)return candidate.path;
  }
  return [];
}

/** A* uses only local grid coordinates and spends the shared budget across every retry. */
function searchRoute(start:Point,end:Point,obstacles:readonly Obstacle[],options:RouteDirections,budget:RouteBudget):Point[] {
  const xs = [...new Set([start.x, end.x, ...obstacles.flatMap(o => [o.minX, o.maxX])])].sort((a, b) => a - b);
  const ys = [...new Set([start.y, end.y, ...obstacles.flatMap(o => [o.minY, o.maxY])])].sort((a, b) => a - b);
  const rows = ys.length, count = xs.length * rows;
  const startNode = xs.indexOf(start.x) * rows + ys.indexOf(start.y), endNode = xs.indexOf(end.x) * rows + ys.indexOf(end.y);
  const scores = new Map<number, number>(), parents = new Map<number, number>(), closed = new Set<number>();
  const heap: number[] = [], priorities: number[] = [];
  const push = (state: number, priority: number) => {
    let index = heap.length; heap.push(state); priorities.push(priority);
    while (index > 0) { const parent = (index - 1) >>> 1; if (priorities[parent] <= priority) break; heap[index] = heap[parent]; priorities[index] = priorities[parent]; index = parent; }
    heap[index] = state; priorities[index] = priority;
  };
  const pop = () => {
    const state = heap[0], last = heap.pop()!, priority = priorities.pop()!;
    if (heap.length) { let i = 0; while (i * 2 + 1 < heap.length) { let child = i * 2 + 1; if (child + 1 < heap.length && priorities[child + 1] < priorities[child]) child++; if (priorities[child] >= priority) break; heap[i] = heap[child]; priorities[i] = priorities[child]; i = child; } heap[i] = last; priorities[i] = priority; }
    return state;
  };
  const lower=Math.abs(start.x-end.x)+Math.abs(start.y-end.y),maxCost=options.maxCost??Infinity;
  if(!Number.isFinite(lower)||lower>maxCost)return [];
  const first = startNode * 5; scores.set(first, 0); push(first,lower);
  let found = -1;
  const point = { x: 0, y: 0 }, next = { x: 0, y: 0 },chainStart={x:0,y:0},chainEnd={x:0,y:0};
  while (heap.length && closed.size<count*5) {
    const state = pop(); if (closed.has(state)) continue;
    if(!(budget.states>0))return [];budget.states=Math.max(0,budget.states-1);closed.add(state);
    const node = Math.floor(state / 5), previousDirection = state % 5;
    if (node === endNode) { found = state; break; }
    const xi = Math.floor(node / rows), yi = node % rows; point.x = xs[xi]; point.y = ys[yi];
    for (let neighbor = 1; neighbor <= 4; neighbor++) {
      if (previousDirection && Math.abs(neighbor - previousDirection) === 2) continue;
      const dx = neighbor === 1 ? 1 : neighbor === 3 ? -1 : 0, dy = neighbor === 2 ? 1 : neighbor === 4 ? -1 : 0;
      const nx = xi + dx, ny = yi + dy;
      if (nx < 0 || ny < 0 || nx >= xs.length || ny >= rows) continue;
      next.x = xs[nx]; next.y = ys[ny]; const nextNode = nx * rows + ny;
      if (node === startNode && !compatible(point, next, options.source, true) || nextNode === endNode && !compatible(point, next, options.target, false)) continue;
      const nextState = nextNode * 5 + neighbor;
      const cost = scores.get(state)! + Math.abs(next.x - point.x) + Math.abs(next.y - point.y) + (previousDirection && axis(previousDirection) !== axis(neighbor) ? 12 : 0);
      const estimate=cost+Math.abs(next.x-end.x)+Math.abs(next.y-end.y);
      if (!Number.isFinite(estimate)||estimate>maxCost||cost >= (scores.get(nextState) ?? Infinity)) continue;
      let simple=1;
      if(options.terminals){
        simple=pairStatus(point,next,options.terminals.source,start,node===startNode,budget);
        if(simple===1)simple=pairStatus(point,next,end,options.terminals.target,nextNode===endNode,budget);
      }
      if(simple<0)return [];if(simple===0)continue;
      // The current state key deliberately does not include its entire history.
      // Reject unsafe ancestry without multiplying state count; this is conservative.
      let cursor=state,parent=parents.get(cursor),adjacent=true,remaining=parents.size+1;
      while(parent!==undefined&&remaining-->0){
        const childNode=Math.floor(cursor/5),parentNode=Math.floor(parent/5);
        chainStart.x=xs[Math.floor(parentNode/rows)];chainStart.y=ys[parentNode%rows];
        chainEnd.x=xs[Math.floor(childNode/rows)];chainEnd.y=ys[childNode%rows];
        simple=pairStatus(point,next,chainStart,chainEnd,adjacent,budget);
        if(simple!==1)break;
        cursor=parent;parent=parents.get(cursor);adjacent=false;
      }
      if(simple<0)return [];if(simple===0||remaining<0)continue;
      const status=segmentStatus(point,next,obstacles,budget);if(status<0)return [];if(status===0)continue;
      scores.set(nextState, cost); parents.set(nextState, state); push(nextState,estimate);
    }
  }
  if (found < 0) return [];
  const path: Point[] = [];
  for (let state = found; state >= 0; state = parents.get(state) ?? -1) { const node = Math.floor(state / 5); path.push({ x: xs[Math.floor(node / rows)], y: ys[node % rows] }); }
  return simplify(path.reverse());
}

/** Direction-aware candidates and a bounded local search, with full-scene collision proofs. */
export function routeOrthogonal(start:Point,end:Point,obstacles:readonly Obstacle[],options:RouteDirections={}):Point[] {
  if(!finitePoint(start)||!finitePoint(end)||!Number.isFinite(end.x-start.x)||!Number.isFinite(end.y-start.y)||obstacles.some(box=>!validObstacle(box))||Number.isNaN(options.maxCost)||options.maxCost!==undefined&&options.maxCost<0)return [];
  if(options.source&&!finitePoint(options.source)||options.target&&!finitePoint(options.target))return [];
  if(options.terminals&&(!finitePoint(options.terminals.source)||!finitePoint(options.terminals.target)||!Number.isFinite(start.x-options.terminals.source.x)||!Number.isFinite(start.y-options.terminals.source.y)||!Number.isFinite(options.terminals.target.x-end.x)||!Number.isFinite(options.terminals.target.y-end.y)||samePoint(options.terminals.source,options.terminals.target)))return [];
  if(obstacles.some(box=>inside(start,box)||inside(end,box)))return [];
  const budget=options.budget??{states:100000,checks:Infinity};
  if(Math.hypot(end.x-start.x,end.y-start.y)<EPS)return simplePathStatus([start],options,budget)===1?[start]:[];
  if(options.terminals){const status=pairStatus(options.terminals.source,start,end,options.terminals.target,false,budget);if(status!==1)return [];}
  const minX=Math.min(start.x,end.x)-64,maxX=Math.max(start.x,end.x)+64,minY=Math.min(start.y,end.y)-64,maxY=Math.max(start.y,end.y)+64;
  const active=obstacles.filter(box=>box.maxX>=minX&&box.minX<=maxX&&box.maxY>=minY&&box.minY<=maxY),included=new Set(active);
  // A large detour can encounter omitted boxes; add every colliding one and solve again.
  for(let attempt=0;attempt<8;attempt++){
    const fast=fastRoute(start,end,active,options,budget);
    if(fast===null)return [];
    const path=fast.length?fast:options.fastOnly?[]:searchRoute(start,end,active,options,budget);
    if(!path.length)return [];
    const collisions=new Set<Obstacle>(),status=pathStatus(path,obstacles,budget,collisions);
    if(status<0)return [];
    if(status===1)return simplePathStatus(path,options,budget)===1?path:[];
    let added=false;
    for(const box of collisions)if(!included.has(box)){included.add(box);active.push(box);added=true;}
    if(!added)return [];
  }
  return [];
}

export function joinOrthogonalPath(start: Point, startLead: Point, endLead: Point, end: Point, obstacles: readonly Obstacle[]): Point[] {
  const middle = routeOrthogonal(startLead, endLead, obstacles, { source: { x: startLead.x - start.x, y: startLead.y - start.y }, target: { x: endLead.x - end.x, y: endLead.y - end.y },terminals:{source:start,target:end} });
  return middle.length ? simplify([start, ...middle, end]) : [];
}

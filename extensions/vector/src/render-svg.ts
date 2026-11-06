import { normalizeVectorPathProps, numberText } from './geometry';
import type { VectorDerivedGeometry, VectorPathProps } from './types';

export function renderVectorPathSvg(input:Readonly<VectorPathProps>,geometry:VectorDerivedGeometry|undefined):{svg:string}{
  const props=geometry?.style??normalizeVectorPathProps(input);if(!geometry?.worldPathD)return{svg:''};
  const width=props.strokeWidth,dash=props.strokeDash==='dashed'?` stroke-dasharray="${width*4} ${width*3}"`:props.strokeDash==='dotted'?` stroke-dasharray="${Math.max(.01,width*.05)} ${width*2.5}"`:'';
  const cap=props.strokeDash==='dotted'?'round':props.strokeCap;
  const arrows=geometry.arrows.map(arrow=>`<path d="${arrow.points.map((point,index)=>`${index?'L':'M'}${numberText(point.x)},${numberText(point.y)}`).join('')}Z" fill="${props.stroke}"/>`).join('');
  const fill=props.fill!=='none'&&geometry.fillPathD?`<path d="${geometry.fillPathD}" fill="${props.fill}" fill-opacity="${props.fillOpacity}" fill-rule="${props.fillRule}"/>`:'';
  return{svg:`<g>${fill}<path d="${geometry.worldPathD}" fill="none" stroke="${props.stroke}" stroke-width="${width}" stroke-linecap="${cap}" stroke-linejoin="${props.strokeJoin}" stroke-miterlimit="4"${dash}/>${arrows}</g>`};
}

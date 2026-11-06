import type { PorcelainExtensionSpec } from '@alid/kernel';
import { deriveWire, WIRE_DEFAULT_CORNER_RADIUS, WIRE_MAX_CORNER_RADIUS } from './derive';
import { renderWireSvg } from './render-svg';
import {wireSelectionContribution} from './selection';
import type { WireProps, WireDerivedGeometry } from './types';

/** The routed polyline's box, padded for the stroke and arrowhead. */
export function wirePaintBounds(wire: WireDerivedGeometry | undefined): { x: number; y: number; width: number; height: number } | undefined {
  if (!wire?.points.length) return undefined;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const point of wire.points) { minX = Math.min(minX, point.x); minY = Math.min(minY, point.y); maxX = Math.max(maxX, point.x); maxY = Math.max(maxY, point.y); }
  return { x: minX - 5, y: minY - 5, width: maxX - minX + 10, height: maxY - minY + 10 };
}

export const WireExtension: PorcelainExtensionSpec<WireProps, WireDerivedGeometry> = {
  id: 'connector.wire',
  summary: '상하좌우 포트·장애물 회피·직교/베지어 경로를 지원하는 스마트 화살표',
  defaults: { from: null, to: null },
  refs: { from: 'cascade-hide', to: 'cascade-hide' },
  dependsOnComputed: ['computed.layoutBounds', 'computed.connector.ports'],
  derive: deriveWire,
  paintBounds: wirePaintBounds,
  renderSvg: renderWireSvg,
  selection:wireSelectionContribution,
  ui: {
    modeline:[{id:'connector.active-routing',align:'right',priority:20,renderText:(world,id)=>{
      const wire=id?world.getCanonical<WireProps>(id,'connector.wire'):undefined;
      return wire?`연결 · ${wire.routing==='bezier'?'베지어':'직교'}`:null;
    }}],
    controls: [
      { id: 'wire.routing.selection', kind: 'segmented', field: 'routing', label: '경로', mnemonic: 'r', defaultValue: 'orthogonal', placement: 'selection-bar', options: [{ label: '직교', value: 'orthogonal' }, { label: '베지어', value: 'bezier' }] },
      { id: 'wire.routing.inspector', kind: 'segmented', field: 'routing', label: '연결 경로', mnemonic: 'r', defaultValue: 'orthogonal', placement: 'inspector', options: [{ label: '직교', value: 'orthogonal' }, { label: '베지어', value: 'bezier' }] },
      { id: 'wire.corner-radius.inspector', kind: 'slider', field: 'cornerRadius', label: '직교 모서리 반경', mnemonic: 'c', defaultValue: WIRE_DEFAULT_CORNER_RADIUS, min: 0, max: WIRE_MAX_CORNER_RADIUS, step: 1, placement: 'inspector' },
      { id: 'wire.configure.inspector', kind: 'action', label: '단계별 설정', commandSymbol: 'connector:configure', placement: 'inspector', requiresSelection: true },
    ],
  },
};

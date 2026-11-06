import type { EntityId, PorcelainExtensionSpec } from '@alid/kernel';
import { deriveVectorPath } from './derive';
import { renderVectorPathSvg } from './render-svg';
import { createVectorSelectionContribution } from './selection';
import { defaultVectorPathProps, type VectorPathProps, type VectorDerivedGeometry } from './types';

export function createVectorPathAspect(isEditingEntity: (id: EntityId) => boolean = () => false): PorcelainExtensionSpec<VectorPathProps, VectorDerivedGeometry> {
  return {
    id: 'vector.path', label: '벡터 경로', summary: '정점과 베지어 핸들로 만드는 자유 벡터 경로',
    defaults: defaultVectorPathProps, layout: true,
    dependsOnCanonical: ['vector.path', 'core.transform', 'core.bounds'], dependsOnComputed: [],
    derive: deriveVectorPath, renderSvg: renderVectorPathSvg, selection: createVectorSelectionContribution(isEditingEntity),
    ui: { controls: [
      { id: 'vector.edit', kind: 'action', label: '경로 편집', icon: 'nodes', mnemonic: 'e', commandSymbol: 'vector:enter-edit', placement: 'selection-bar', requiresSelection: true },
      { id: 'vector.stroke.selection', kind: 'color', field: 'stroke', label: '선 색상', placement: 'selection-bar' },
      { id: 'vector.width.selection', kind: 'slider', field: 'strokeWidth', label: '선 두께', min: 1, max: 24, step: 1, placement: 'selection-bar' },
      { id: 'vector.stroke', kind: 'color', field: 'stroke', label: '선 색상', placement: 'inspector' },
      { id: 'vector.width', kind: 'slider', field: 'strokeWidth', label: '선 두께', min: 0, max: 24, step: 1, placement: 'inspector' },
      { id: 'vector.dash', kind: 'segmented', field: 'strokeDash', label: '선 스타일', placement: 'inspector', options: [{ label: '실선', value: 'solid' }, { label: '파선', value: 'dashed' }, { label: '점선', value: 'dotted' }] },
      { id: 'vector.cap', kind: 'segmented', field: 'strokeCap', label: '끝 모양', placement: 'inspector', options: [{ label: '둥글게', value: 'round' }, { label: '평평하게', value: 'butt' }, { label: '사각형', value: 'square' }] },
      { id: 'vector.join', kind: 'segmented', field: 'strokeJoin', label: '이음 모양', placement: 'inspector', options: [{ label: '둥글게', value: 'round' }, { label: '뾰족하게', value: 'miter' }, { label: '잘라내기', value: 'bevel' }] },
      { id: 'vector.fill', kind: 'color', field: 'fill', label: '채우기 색상', placement: 'inspector' },
      { id: 'vector.fill-toggle', kind: 'action', label: '채우기 켜기 / 끄기', commandSymbol: 'vector:toggle-fill', requiresSelection: true, placement: 'inspector' },
      { id: 'vector.opacity', kind: 'slider', field: 'fillOpacity', label: '채우기 불투명도', min: 0, max: 1, step: .05, placement: 'inspector' },
      { id: 'vector.rule', kind: 'segmented', field: 'fillRule', label: '채우기 규칙', placement: 'inspector', options: [{ label: '홀짝', value: 'evenodd' }, { label: '감김', value: 'nonzero' }] },
      { id: 'vector.arrow-start', kind: 'toggle', field: 'arrowStart', label: '시작 화살표', placement: 'inspector' },
      { id: 'vector.arrow-end', kind: 'toggle', field: 'arrowEnd', label: '끝 화살표', placement: 'inspector' },
    ] },
  };
}
export const VectorPathExtension = createVectorPathAspect();

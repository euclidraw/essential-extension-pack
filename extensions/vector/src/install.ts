import type { CanvasEntityCreation, CanvasFrameScheduler, CanvasToolInputRegistry, CanvasToolSurfaceProvider, ExtensionSpec } from '@alid/kernel';
import { createVectorPathAspect } from './extension';
import { VectorPenTool, VECTOR_PEN_STATE } from './pen-tool';
import { VectorNodeEditor } from './node-editor';
import type { VectorPathProps } from './types';
import type { VectorSelection, VectorToolHost } from './vector-host';

export function createVectorPathExtension(): ExtensionSpec {
  let editor: VectorNodeEditor | undefined;
  return {
    id: 'vector.pen-suite', summary: '자유 벡터 경로를 그리고 정점·핸들·곡선을 직접 편집합니다.',
    aspects: [createVectorPathAspect(id => editor?.isEditingEntity(id) ?? false)],
    ui: { controls: [{ id: 'vector.pen', kind: 'action', icon: 'pen', label: '펜 도구', mnemonic: 'p', commandSymbol: 'vector:pen-tool', placement: 'tool-shelf', activeToolState: VECTOR_PEN_STATE }] },
    activate(context) {
      let surface = context.services.get<{ element: HTMLElement; hud: HTMLElement }>('canvas.surface');
      let host = context.services.get<VectorToolHost>('canvas.interaction');
      if (!surface || !host) return;
      const activeSurface = context.services.get<CanvasToolSurfaceProvider>('canvas.active-tool-surface');
      let pen: VectorPenTool | undefined, boundSelection: VectorSelection | undefined;
      const ensureTools = () => {
        const active = activeSurface?.get();
        if (activeSurface && !active) { pen?.dispose(); editor?.dispose(); pen = undefined; editor = undefined; boundSelection = undefined; return false; }
        const selection = active?.selection ?? context.services.get<VectorSelection>('canvas.selection');
        if (selection !== boundSelection) { pen?.dispose(); editor?.dispose(); pen = undefined; editor = undefined; boundSelection = selection; }
        surface = active?.surface ?? surface; host = active?.host ?? host;
        const creation = context.services.get<CanvasEntityCreation>('canvas.creation');
        if (!selection || !creation || !surface || !host) return false;
        const options = { world: context.world, selection, host, surface: surface.element, hud: surface.hud, frames: context.services.get<CanvasFrameScheduler>('canvas.frames'), externalKeyboard: !!context.services.get('canvas.tool-input') };
        editor ??= new VectorNodeEditor({ ...options, onEditingChanged: () => host?.requestRender() });
        pen ??= new VectorPenTool({ ...options, creation });
        return true;
      };
      const enterEdit = () => {
        if (!ensureTools()) return false;
        if (host?.isSelectionEnabled?.() === false) return false;
        const ids = boundSelection!.getSelection();
        if (ids.length !== 1 || !context.world.getCanonical(ids[0], 'vector.path')) return false;
        pen?.cancel(); return editor!.enter(ids[0]);
      };
      ensureTools();
      const disposers = [
        context.commands.register({ id: 'vector:pen-tool', title: '펜 도구', summary: '클릭으로 직선, 드래그로 곡선 정점을 추가합니다.', keys: ['p'], shortcutScope: 'canvas', run: () => {
          if (context.commands.get('canvas:select-tool')) context.commands.execute('canvas:select-tool');
          if (ensureTools()) { editor?.exit(); pen!.enter(); surface!.element.focus(); }
        } }),
        context.commands.register({ id: 'vector:enter-edit', title: '벡터 경로 편집', summary: '선택한 벡터의 정점과 핸들을 직접 편집합니다.', keys: ['enter'], shortcutScope: 'canvas', shortcutSelectionAspect: 'vector.path', run: enterEdit }),
        context.commands.register({ id: 'vector:toggle-fill', title: '벡터 채우기 켜기 / 끄기', summary: '선택한 벡터의 채우기를 전환합니다.', run: () => {
          ensureTools();
          editor?.exit();
          const patches = (boundSelection?.getSelection() ?? []).flatMap(id => {
            const props = context.world.getCanonical<VectorPathProps>(id, 'vector.path');
            return props && !context.world.isEntityReadOnly(id) ? [{ id, aspect: 'vector.path' as const, patch: { fill: props.fill === 'none' ? '#008FF0' : 'none' } }] : [];
          });
          if (!patches.length) return;
          host!.history.begin();
          try { context.world.applyCanonicalTransaction('vector:toggle-fill', patches, 'local:user'); host!.history.commit(); }
          catch (error) { host!.history.abort(); throw error; }
        } }),
      ];
      if (activeSurface) disposers.push(activeSurface.subscribe(() => { ensureTools(); }));
      for (const [mode, title] of [['none', '독립 핸들'], ['angle', '각도만 대칭'], ['angle-and-length', '각도와 길이 대칭']] as const) {
        disposers.push(context.commands.register({ id: `vector:mirror-${mode}`, title: `벡터 정점 · ${title}`, summary: '정점 편집 중 선택한 정점에 적용합니다.', run: () => editor?.setSelectedMirroring(mode) }));
      }
      for (const [radius, name] of [[12, 'round'], [0, 'sharp']] as const) {
        disposers.push(context.commands.register({ id: `vector:corners-${name}`, title: radius ? '벡터 정점 · 모서리 둥글게' : '벡터 정점 · 둥글기 제거', summary: '정점 편집 중 선택한 모서리에 적용합니다.', run: () => editor?.setSelectedCornerRadius(radius) }));
      }
      const input = context.services.get<CanvasToolInputRegistry>('canvas.tool-input');
      if (input) disposers.push(input.register('vector.pen-suite', { handleKeyDown(event) {
        if (!ensureTools()) return false;
        if (pen?.isActive) return pen.handleKeyDown(event);
        if (editor?.editingEntityId) return editor.handleKeyDown(event);
        return event.key === 'Enter' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && enterEdit();
      } }));
      return () => { for (const off of disposers.reverse()) off(); pen?.dispose(); editor?.dispose(); editor = undefined; };
    },
  };
}

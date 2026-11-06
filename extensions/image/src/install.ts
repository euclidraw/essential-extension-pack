import { CasBlobStore, type CanvasEntityCreation, type CanonicalPatchOp, type ExtensionSpec, type ExtensionContext } from '@alid/kernel';
import { cropAspectRatio, MediaAssetService } from './asset-service';
import { createMediaImageExtension } from './extension';
import { clampCrop, type MediaImageProps } from './types';

interface SelectionService {
  getSelection(): readonly string[];
}

/** 클립보드 확장의 공개 계약 중 이 패키지가 쓰는 최소 부분(확장 간 직접 import 금지). */
interface CanvasClipboardLike {
  registerPasteHandler(handler: {
    id: string; priority: number;
    canHandle(ctx: { clipboardData: Pick<DataTransfer, 'files'> }): boolean;
    buildOps(ctx: { clipboardData: Pick<DataTransfer, 'files'> }): Promise<CanonicalPatchOp[]> | CanonicalPatchOp[];
  }): () => void;
}

const IMAGE_PATTERN = /^image\//;

export function createMediaImageSuite(blobs?: CasBlobStore): ExtensionSpec {
  let store = blobs ?? new CasBlobStore();
  let assets = new MediaAssetService(store), released = false;
  const aspect = createMediaImageExtension(() => assets);

  const insertFiles = async (context: ExtensionContext, files: Iterable<File>, activeAssets: MediaAssetService, isActive: () => boolean) => {
    const creation = context.services.get<CanvasEntityCreation>('canvas.creation');
    if (!creation) throw new Error('이미지 삽입에는 canvas.creation 호스트 서비스가 필요합니다.');
    for (const file of files) {
      if (!IMAGE_PATTERN.test(file.type)) continue;
      if (!isActive()) return;
      const meta = await activeAssets.ingestFile(file);
      if (!isActive()) return;
      const scale = Math.min(1, 480 / meta.naturalWidth); // 고해상도 레티나 캡처의 초기 크기 보정.
      creation.create({
        caller: 'media:insert-image',
        width: Math.max(64, Math.round(meta.naturalWidth * scale)),
        height: Math.max(64, Math.round(meta.naturalHeight * scale)),
        aspects: {
          'media.image': {
            src: meta.ref,
            mimeType: meta.mimeType,
            naturalWidth: meta.naturalWidth,
            naturalHeight: meta.naturalHeight,
            alt: file.name.replace(/\.[^.]+$/, ''),
          } satisfies Partial<MediaImageProps>,
        },
      });
    }
  };

  const containsEditableTarget = (target: EventTarget | null): boolean =>
    target instanceof Element && !!target.closest('input,textarea,[contenteditable]:not([contenteditable="false"]),dialog[open]');

  return {
    id: 'media.image-suite',
    summary: '이미지를 붙여넣거나 파일을 끌어와 추가합니다.',
    aspects: [aspect],
    activate(context) {
      const sharedStore = context.services.get<CasBlobStore>('kernel.blobs');
      if (!blobs && sharedStore && sharedStore !== store) { assets.dispose(); store = sharedStore; assets = new MediaAssetService(store); released = false; }
      if (released) { assets = new MediaAssetService(store); released = false; }
      const activeAssets = assets;
      let active = true;
      const insert = (files: Iterable<File>) => insertFiles(context, files, activeAssets, () => active);
      const offService = context.services.provide('media.assets', assets);

      const offInsert = context.commands.register({
        id: 'media:insert-image',
        title: '이미지 파일 추가',
        summary: '로컬 이미지를 CAS 저장소에 넣고 현재 캔버스 중앙에 배치합니다.',
        run: () => {
          const input = document.createElement('input');
          input.type = 'file';
          input.accept = 'image/*';
          input.multiple = true;
          input.onchange = () => { if (input.files && active) void insert(input.files).catch(error => console.error('[media.image]', error)); };
          input.click();
        },
      });

      const offResetRatio = context.commands.register({
        id: 'media:reset-aspect-ratio',
        title: '이미지 원본 비율 복원',
        summary: '현재 너비를 유지한 채 원본 해상도·크롭 비율에 맞춰 높이를 재조정합니다.',
        run: () => {
          const selection = context.services.get<SelectionService>('canvas.selection')?.getSelection() ?? [];
          const view = context.world.getCanonicalView();
          const ops: CanonicalPatchOp[] = [];
          for (const id of selection) {
            const props = view.getCanonical<MediaImageProps>(id, 'media.image');
            if (!props || !view.isAlive(id)) continue;
            const bounds = view.getCanonical<{ width: number; height?: number }>(id, 'core.bounds');
            const width = bounds?.width && bounds.width > 0 ? bounds.width : Math.min(480, props.naturalWidth);
            const ratio = cropAspectRatio(props.naturalWidth, props.naturalHeight, clampCrop(props.crop));
            const height = Math.max(32, Math.round(width / ratio));
            if (bounds?.height === height) continue;
            ops.push({ id, aspect: 'core.bounds', patch: { width, height } });
          }
          if (ops.length) context.world.applyCanonicalTransaction('media:reset-aspect-ratio', ops, 'local:user');
        },
      });

      // 텍스트 편집기 바깥에서 Ctrl/Cmd+V 시 클립보드 이미지를 즉시 삽입한다.
      // 클립보드 확장이 설치되어 있으면 공개 붙여넣기 핸들러 체인(우선순위 70)으로 위임한다.
      const onPaste = (event: ClipboardEvent) => {
        if (event.defaultPrevented || containsEditableTarget(event.target)) return;
        if (context.services.get('canvas.clipboard')) return;
        const files = Array.from(event.clipboardData?.files ?? []).filter(file => IMAGE_PATTERN.test(file.type));
        if (!files.length) return;
        event.preventDefault();
        void insert(files).catch(error => console.error('[media.image]', error));
      };
      const clipboard = context.services.get<CanvasClipboardLike>('canvas.clipboard');
      const offPasteHandler = clipboard?.registerPasteHandler({
        id: 'media.image-suite:image-files', priority: 70,
        canHandle: ctx => Array.from(ctx.clipboardData.files ?? []).some(file => IMAGE_PATTERN.test(file.type)),
        // 이미지는 비동기 CAS 저장이 필요하므로 canvas.creation 경로로 직접 삽입하고 빈 패치를 반환한다.
        buildOps: async ctx => {
          await insert(Array.from(ctx.clipboardData.files).filter(file => IMAGE_PATTERN.test(file.type)));
          return [];
        },
      });

      // 캔버스 표면으로 이미지 파일을 드래그해 놓으면 유입 파이프라인을 통과한다.
      const surface = context.services.get<{ element: HTMLElement }>('canvas.surface')?.element;
      const onDragOver = (event: DragEvent) => {
        if (![...event.dataTransfer?.items ?? []].some(item => item.kind === 'file' && IMAGE_PATTERN.test(item.type))) return;
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
      };
      const onDrop = (event: DragEvent) => {
        const files = Array.from(event.dataTransfer?.files ?? []).filter(file => IMAGE_PATTERN.test(file.type));
        if (!files.length) return;
        event.preventDefault();
        void insert(files).catch(error => console.error('[media.image]', error));
      };
      document.addEventListener('paste', onPaste);
      surface?.addEventListener('dragover', onDragOver);
      surface?.addEventListener('drop', onDrop);

      return () => {
        active = false;
        offPasteHandler?.();
        surface?.removeEventListener('drop', onDrop);
        surface?.removeEventListener('dragover', onDragOver);
        document.removeEventListener('paste', onPaste);
        offResetRatio();
        offInsert();
        offService();
        activeAssets.dispose();
        if (assets === activeAssets) released = true;
      };
    },
  };
}

import { defineExtension, type CasBlobRef, type ComputedReadView, type EntityId, type PorcelainExtensionSpec } from '@alid/kernel';
import { cropAspectRatio, type MediaAssetService } from './asset-service';
import { clampCrop, FULL_CROP, type ImageDerivedGeometry, type MediaImageProps } from './types';

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, character => (
    character === '&' ? '&amp;' : character === '<' ? '&lt;' : character === '>' ? '&gt;' : character === '"' ? '&quot;' : '&apos;'
  ));
}

export function deriveMediaImage(props: Readonly<MediaImageProps>, _id: EntityId, view: ComputedReadView): ImageDerivedGeometry {
  const transform = view.getCanonical<{ x: number; y: number; rotation?: number }>(_id, 'core.transform') ?? { x: 0, y: 0 };
  const bounds = view.getCanonical<{ width: number; height?: number }>(_id, 'core.bounds');
  const naturalWidth = props.naturalWidth > 0 ? props.naturalWidth : 320;
  const naturalHeight = props.naturalHeight > 0 ? props.naturalHeight : 240;
  const crop = clampCrop(props.crop);
  const aspectRatio = cropAspectRatio(naturalWidth, naturalHeight, crop);
  const width = bounds?.width && bounds.width > 0 ? bounds.width : Math.min(480, naturalWidth);
  const height = bounds?.height && bounds.height > 0 ? bounds.height : Math.round(width / aspectRatio);
  return {
    x: Number.isFinite(transform.x) ? transform.x : 0,
    y: Number.isFinite(transform.y) ? transform.y : 0,
    width,
    height,
    rotation: Number.isFinite(transform.rotation) ? transform.rotation! : 0,
    aspectRatio,
    crop,
  };
}

export function createMediaImageExtension(assets: MediaAssetService | (() => MediaAssetService)): PorcelainExtensionSpec<MediaImageProps, ImageDerivedGeometry> {
  const getAssets = typeof assets === 'function' ? assets : () => assets;
  return defineExtension<MediaImageProps, ImageDerivedGeometry>({
    id: 'media.image',
    layout: true,
    dependsOnComputed: [],
    label: '이미지',
    summary: 'CAS 블롭 외부화·비파괴 UV 크롭·순수 벡터 SVG 출판을 지원하는 이미지 컴포넌트',
    defaults: {
      src: '',
      mimeType: 'image/png',
      naturalWidth: 320,
      naturalHeight: 240,
      fit: 'cover',
      crop: null,
      alt: '',
      caption: '',
      cornerRadius: 8,
    },
    textSearchFields: ['alt', 'caption'],
    dependsOnCanonical: ['core.transform', 'core.bounds', 'media.image'],
    derive: deriveMediaImage,

    renderDom(hostEl, props, derived) {
      const geom = derived ?? { width: 320, height: 240, crop: FULL_CROP };
      hostEl.style.cssText = `width:100%;height:${geom.height}px;position:relative;overflow:hidden;border-radius:${props.cornerRadius}px;background:var(--alid-bg-muted,#f4f4f5);border:1px solid var(--alid-border-subtle,#e4e4e7);user-select:none;`;

      let image = hostEl.querySelector<HTMLImageElement>('img[data-role="media-img"]');
      if (!image) {
        image = document.createElement('img');
        image.dataset.role = 'media-img';
        image.decoding = 'async';
        image.draggable = false; // 브라우저 기본 이미지 고스트 드래그가 캔버스 HSM과 충돌하는 것을 막는다.
        image.crossOrigin = 'anonymous'; // COEP: credentialless 환경 호환.
        hostEl.replaceChildren(image);
      }
      image.alt = props.alt || props.caption || '캔버스 이미지';
      const { x, y, w, h } = geom.crop;
      const isCropped = x > 0 || y > 0 || w < 1 || h < 1;
      image.style.cssText = isCropped
        ? `position:absolute;width:${100 / w}%;height:${100 / h}%;left:${(-x / w) * 100}%;top:${(-y / h) * 100}%;object-fit:fill;pointer-events:none;`
        : `width:100%;height:100%;display:block;object-fit:${props.fit};pointer-events:none;`;

      if (props.src.startsWith('https://')) {
        if (image.src !== props.src) image.src = props.src;
        return;
      }
      if (!props.src.startsWith('sha256:')) return;
      // 참조 카운팅: 마지막 언마운트까지 ObjectURL을 공유하고 해제한다.
      return getAssets().retainObjectUrl(props.src as CasBlobRef, props.mimeType, url => {
        if (image && image.src !== url) image.src = url;
      });
    },

    renderSvg(props, derived, entityId) {
      if (!derived) return { svg: '' };
      const { x, y, width, height, rotation, crop } = derived;
      const degrees = (rotation * 180) / Math.PI;
      const clipId = `img-clip-${escapeXml(entityId)}`;
      const href = getAssets().getSyncExportHref(props.src);
      const preserve = props.fit === 'contain' ? 'xMidYMid meet' : props.fit === 'fill' ? 'none' : 'xMidYMid slice';
      // 정규화 UV 크롭을 SVG 좌표계로 역산한다.
      const imgX = (-crop.x / crop.w) * width;
      const imgY = (-crop.y / crop.h) * height;
      const imgW = width / crop.w;
      const imgH = height / crop.h;
      const body = href
        ? // SVG <image>의 독립 디코딩 컨텍스트만 사용해 업로드 SVG의 스크립트 실행을 차단한다.
          `<image href="${escapeXml(href)}" x="${imgX}" y="${imgY}" width="${imgW}" height="${imgH}" preserveAspectRatio="${preserve}" clip-path="url(#${clipId})"/>`
        : `<rect width="${width}" height="${height}" rx="${props.cornerRadius}" fill="#f4f4f5" stroke="#d4d4d8"/>`;
      return {
        svg: `<g transform="translate(${x},${y}) rotate(${degrees},${width / 2},${height / 2})"><defs><clipPath id="${clipId}"><rect width="${width}" height="${height}" rx="${props.cornerRadius}"/></clipPath></defs>${body}</g>`,
      };
    },

    ui: {
      controls: [
        { id: 'image.add.shelf', kind: 'action', label: '이미지 추가', icon: 'image', commandSymbol: 'media:insert-image', placement: 'tool-shelf', requiresSelection: false },
        {
          id: 'image.fit.selection', kind: 'segmented', field: 'fit', label: '채우기', mnemonic: 'f', placement: 'selection-bar',
          options: [{ label: '채움', value: 'cover' }, { label: '맞춤', value: 'contain' }, { label: '늘림', value: 'fill' }],
        },
        { id: 'image.reset-ratio.selection', kind: 'action', label: '원본 비율', mnemonic: 'a', commandSymbol: 'media:reset-aspect-ratio', placement: 'selection-bar', requiresSelection: true },
        {
          id: 'image.fit.inspector', kind: 'segmented', field: 'fit', label: '맞춤 방식', placement: 'inspector',
          options: [{ label: '채움', value: 'cover' }, { label: '맞춤', value: 'contain' }, { label: '늘림', value: 'fill' }],
        },
        { id: 'image.radius.inspector', kind: 'slider', field: 'cornerRadius', label: '모서리 둥글기', min: 0, max: 32, step: 2, placement: 'inspector' },
        { id: 'image.alt.inspector', kind: 'text', field: 'alt', label: '대체 텍스트 (검색용)', placement: 'inspector' },
        { id: 'image.caption.inspector', kind: 'text', field: 'caption', label: '캡션', placement: 'inspector' },
      ],
    },
  });
}

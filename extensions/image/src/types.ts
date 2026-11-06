import type { CasBlobRef } from '@alid/kernel';

export type ImageFitMode = 'contain' | 'cover' | 'fill';

/** 문서 정본 어스펙트 ID. 논리 설치 단위 ID는 `media.image-suite`다. */
export const MediaImageAspectId = 'media.image';

/** 카드 크기 변화에 영향을 받지 않는 정규화 UV(0..1) 크롭 영역. */
export interface NormalizedCrop {
  readonly x: number; // 0 <= x < 1
  readonly y: number; // 0 <= y < 1
  readonly w: number; // 0 < w <= 1 - x
  readonly h: number; // 0 < h <= 1 - y
}

export interface MediaImageProps extends Record<string, unknown> {
  /** CAS 블롭 참조(`sha256:...`) 또는 외부 `https://` URL. data:·blob: 직접 저장은 금지한다. */
  src: CasBlobRef | `https://${string}` | '';
  mimeType: string;
  /** 유입(ingestion) 시점에 한 번만 측정해 기록한 원본 해상도. 로드 시 재측정하지 않는다. */
  naturalWidth: number;
  naturalHeight: number;
  fit: ImageFitMode;
  crop: NormalizedCrop | null;
  alt: string;
  caption: string;
  cornerRadius: number;
}

export interface ImageDerivedGeometry {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly rotation: number;
  readonly aspectRatio: number;
  readonly crop: NormalizedCrop;
}

export const FULL_CROP: NormalizedCrop = Object.freeze({ x: 0, y: 0, w: 1, h: 1 });

/** 비파괴 UV 크롭을 항상 유효한 0..1 영역으로 clamps 한다. */
export function clampCrop(crop: NormalizedCrop | null | undefined): NormalizedCrop {
  if (!crop) return FULL_CROP;
  const clampUnit = (value: number, fallback: number) => (Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : fallback);
  const x = Math.min(0.95, clampUnit(crop.x, 0));
  const y = Math.min(0.95, clampUnit(crop.y, 0));
  const w = Math.min(1 - x, Math.max(0.05, Number.isFinite(crop.w) ? crop.w : 1 - x));
  const h = Math.min(1 - y, Math.max(0.05, Number.isFinite(crop.h) ? crop.h : 1 - y));
  return { x, y, w, h };
}

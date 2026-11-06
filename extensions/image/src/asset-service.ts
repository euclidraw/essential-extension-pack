import type { CasBlobRef, CasBlobStore } from '@alid/kernel';
import { clampCrop, type NormalizedCrop } from './types';

interface CachedAssetEntry {
  readonly objectUrl: string;
  readonly dataUrl: string;
  readonly mimeType: string;
  refCount: number;
}

const ALLOWED_IMAGE_MIMES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/avif',
  'image/svg+xml',
]);

export function isAllowedImageMime(mimeType: string): boolean {
  return ALLOWED_IMAGE_MIMES.has(mimeType);
}

function bytesToBase64DataUrl(bytes: Uint8Array, mimeType: string): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return `data:${mimeType};base64,${btoa(binary)}`;
}

/**
 * 비동기 `CasBlobStore`와 동기 `compileToPureSvg` 사이의 간극을 메운다.
 * 화면용 `blob:` ObjectURL과 출판용 `data:` URI를 참조 카운팅 캐시로 워밍하며,
 * 정본(CRDT·JSONL)에는 어떤 바이너리도 쓰지 않는다.
 */
export class MediaAssetService {
  private readonly cache = new Map<CasBlobRef, CachedAssetEntry>();
  private readonly inflight = new Map<CasBlobRef, Promise<CachedAssetEntry | undefined>>();
  private readonly listeners = new Map<CasBlobRef, Set<() => void>>();
  private disposed = false;

  constructor(private readonly blobs: CasBlobStore) {}

  /** 파일·클립보드 유입 시 검증 · CAS 저장 · 원본 크기 디코딩을 한 번에 수행한다(Read-Triggers-Write 없음). */
  async ingestFile(file: Blob): Promise<{ ref: CasBlobRef; mimeType: string; naturalWidth: number; naturalHeight: number }> {
    if (this.disposed) throw new Error('MediaAssetService has been disposed.');
    const mimeType = isAllowedImageMime(file.type) ? file.type : 'image/png';
    const bytes = new Uint8Array(await file.arrayBuffer());
    const ref = await this.blobs.put(bytes);
    const { width, height } = await this.decodeDimensions(file);
    this.populateEntry(ref, bytes, mimeType);
    return { ref, mimeType, naturalWidth: width, naturalHeight: height };
  }

  /** Plane 2 DOM 위젯이 마운트될 때 호출하며, 언마운트 클린업 함수를 반환한다. */
  retainObjectUrl(ref: CasBlobRef, mimeType: string, onReady: (objectUrl: string) => void): () => void {
    const existing = this.cache.get(ref);
    if (existing) {
      existing.refCount++;
      onReady(existing.objectUrl);
    } else {
      let subscribers = this.listeners.get(ref);
      if (!subscribers) this.listeners.set(ref, (subscribers = new Set()));
      subscribers.add(() => {
        const loaded = this.cache.get(ref);
        if (loaded) onReady(loaded.objectUrl);
      });
      void this.ensureHydrated(ref, mimeType).then(entry => {
        if (entry && !this.disposed) entry.refCount++;
      });
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const current = this.cache.get(ref);
      if (current) current.refCount = Math.max(0, current.refCount - 1);
    };
  }

  /** `SceneVectorCompiler.compileToPureSvg()` 전용 동기 조회 경로. */
  getSyncExportHref(src: string): string | undefined {
    if (src.startsWith('https://')) return src;
    if (src.startsWith('sha256:')) return this.cache.get(src as CasBlobRef)?.dataUrl;
    return undefined;
  }

  /** JSONL 문서 임포트 직후 모든 이미지 블롭을 선제 워밍한다. */
  async warmRefs(refs: Iterable<{ ref: CasBlobRef; mimeType: string }>): Promise<void> {
    if (this.disposed) return;
    await Promise.all([...refs].map(({ ref, mimeType }) => this.ensureHydrated(ref, mimeType)));
  }

  /** 문서에 남은 이미지 참조 목록을 정본에서 수집한다(아카이브·워밍에 재사용). */
  collectRefs(props: Readonly<Record<string, unknown>>): Array<{ ref: CasBlobRef; mimeType: string }> {
    const src = typeof props.src === 'string' ? props.src : '';
    return src.startsWith('sha256:') ? [{ ref: src as CasBlobRef, mimeType: isAllowedImageMime(String(props.mimeType)) ? String(props.mimeType) : 'image/png' }] : [];
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const entry of this.cache.values()) URL.revokeObjectURL(entry.objectUrl);
    this.cache.clear();
    this.listeners.clear();
    this.inflight.clear();
  }

  private async ensureHydrated(ref: CasBlobRef, mimeType: string): Promise<CachedAssetEntry | undefined> {
    const cached = this.cache.get(ref);
    if (cached) return cached;
    const pending = this.inflight.get(ref);
    if (pending) return pending;
    const job = (async () => {
      const bytes = await this.blobs.get(ref);
      if (!bytes || this.disposed) return undefined;
      return this.populateEntry(ref, bytes, mimeType);
    })();
    this.inflight.set(ref, job);
    try {
      return await job;
    } finally {
      this.inflight.delete(ref);
    }
  }

  private populateEntry(ref: CasBlobRef, bytes: Uint8Array, mimeType: string): CachedAssetEntry {
    const prior = this.cache.get(ref);
    if (prior) return prior;
    const safeMime = isAllowedImageMime(mimeType) ? mimeType : 'image/png';
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    const objectUrl = URL.createObjectURL(new Blob([copy], { type: safeMime }));
    const dataUrl = bytesToBase64DataUrl(copy, safeMime);
    const entry: CachedAssetEntry = { objectUrl, dataUrl, mimeType: safeMime, refCount: 0 };
    this.cache.set(ref, entry);
    const subscribers = this.listeners.get(ref);
    this.listeners.delete(ref);
    for (const notify of subscribers ?? []) notify();
    return entry;
  }

  /** 원본 크기는 유입 시점에 한 번만 디코딩하며, 이후에는 정본 메타데이터만 읽는다. */
  private async decodeDimensions(blob: Blob): Promise<{ width: number; height: number }> {
    if (typeof createImageBitmap === 'function') {
      try {
        const bitmap = await createImageBitmap(blob);
        const size = { width: Math.max(1, bitmap.width), height: Math.max(1, bitmap.height) };
        bitmap.close();
        return size;
      } catch { /* 폭파된 이미지는 기본 폴백으로 진행한다. */ }
    }
    if (typeof document === 'undefined' || typeof URL?.createObjectURL !== 'function') return { width: 320, height: 240 };
    return new Promise(resolve => {
      const url = URL.createObjectURL(blob);
      const image = new Image();
      const settle = (width: number, height: number) => {
        URL.revokeObjectURL(url);
        resolve({ width: Math.max(1, width), height: Math.max(1, height) });
      };
      image.onload = () => settle(image.naturalWidth, image.naturalHeight);
      image.onerror = () => settle(320, 240);
      image.src = url;
    });
  }
}

/** 크롭 영역과 원본 해상도로 카드의 종횡비를 계산하는 순수 함수. */
export function cropAspectRatio(naturalWidth: number, naturalHeight: number, crop: NormalizedCrop): number {
  const width = naturalWidth > 0 ? naturalWidth : 320;
  const height = naturalHeight > 0 ? naturalHeight : 240;
  const safe = clampCrop(crop);
  return (width * safe.w) / Math.max(1, height * safe.h);
}

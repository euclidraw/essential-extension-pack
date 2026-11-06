import { CasBlobStore, defineExtension } from "@alid/kernel";
var extension_default = {
	id: "media.image-suite",
	title: "이미지",
	version: "0.1.0",
	summary: "이미지를 붙여넣거나 파일을 끌어와 추가합니다.",
	engine: "^0.1.0",
	dependencies: { "core.clipboard": "^0.1.0" },
	optionalDependencies: { "core.select-suite": "^0.1.0" },
	conflicts: [],
	provides: {
		"services": ["media.assets"],
		"hsmSlots": []
	}
};
// src/manifest.js
function createPackageManifest(m) {
	return {
		id: m.id,
		version: m.version,
		engine: m.engine,
		dependencies: { ...m.dependencies },
		optionalDependencies: { ...m.optionalDependencies },
		conflicts: [...m.conflicts],
		provides: {
			services: [...m.provides.services],
			aspects: ["media.image"],
			hsmSlots: [...m.provides.hsmSlots]
		}
	};
}
// src/types.ts
var FULL_CROP = Object.freeze({
	x: 0,
	y: 0,
	w: 1,
	h: 1
});
/** 비파괴 UV 크롭을 항상 유효한 0..1 영역으로 clamps 한다. */
function clampCrop(crop) {
	if (!crop) return FULL_CROP;
	const clampUnit = (value, fallback) => Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : fallback;
	const x = Math.min(.95, clampUnit(crop.x, 0));
	const y = Math.min(.95, clampUnit(crop.y, 0));
	return {
		x,
		y,
		w: Math.min(1 - x, Math.max(.05, Number.isFinite(crop.w) ? crop.w : 1 - x)),
		h: Math.min(1 - y, Math.max(.05, Number.isFinite(crop.h) ? crop.h : 1 - y))
	};
}
// src/asset-service.ts
var ALLOWED_IMAGE_MIMES = /* @__PURE__ */ new Set([
	"image/png",
	"image/jpeg",
	"image/webp",
	"image/gif",
	"image/avif",
	"image/svg+xml"
]);
function isAllowedImageMime(mimeType) {
	return ALLOWED_IMAGE_MIMES.has(mimeType);
}
function bytesToBase64DataUrl(bytes, mimeType) {
	let binary = "";
	const chunkSize = 32768;
	for (let index = 0; index < bytes.length; index += chunkSize) binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
	return `data:${mimeType};base64,${btoa(binary)}`;
}
/**
* 비동기 `CasBlobStore`와 동기 `compileToPureSvg` 사이의 간극을 메운다.
* 화면용 `blob:` ObjectURL과 출판용 `data:` URI를 참조 카운팅 캐시로 워밍하며,
* 정본(CRDT·JSONL)에는 어떤 바이너리도 쓰지 않는다.
*/
var MediaAssetService = class {
	blobs;
	cache = /* @__PURE__ */ new Map();
	inflight = /* @__PURE__ */ new Map();
	listeners = /* @__PURE__ */ new Map();
	disposed = false;
	constructor(blobs) {
		this.blobs = blobs;
	}
	/** 파일·클립보드 유입 시 검증 · CAS 저장 · 원본 크기 디코딩을 한 번에 수행한다(Read-Triggers-Write 없음). */
	async ingestFile(file) {
		if (this.disposed) throw new Error("MediaAssetService has been disposed.");
		const mimeType = isAllowedImageMime(file.type) ? file.type : "image/png";
		const bytes = new Uint8Array(await file.arrayBuffer());
		const ref = await this.blobs.put(bytes);
		const { width, height } = await this.decodeDimensions(file);
		this.populateEntry(ref, bytes, mimeType);
		return {
			ref,
			mimeType,
			naturalWidth: width,
			naturalHeight: height
		};
	}
	/** Plane 2 DOM 위젯이 마운트될 때 호출하며, 언마운트 클린업 함수를 반환한다. */
	retainObjectUrl(ref, mimeType, onReady) {
		const existing = this.cache.get(ref);
		if (existing) {
			existing.refCount++;
			onReady(existing.objectUrl);
		} else {
			let subscribers = this.listeners.get(ref);
			if (!subscribers) this.listeners.set(ref, subscribers = /* @__PURE__ */ new Set());
			subscribers.add(() => {
				const loaded = this.cache.get(ref);
				if (loaded) onReady(loaded.objectUrl);
			});
			this.ensureHydrated(ref, mimeType).then((entry) => {
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
	getSyncExportHref(src) {
		if (src.startsWith("https://")) return src;
		if (src.startsWith("sha256:")) return this.cache.get(src)?.dataUrl;
	}
	/** JSONL 문서 임포트 직후 모든 이미지 블롭을 선제 워밍한다. */
	async warmRefs(refs) {
		if (this.disposed) return;
		await Promise.all([...refs].map(({ ref, mimeType }) => this.ensureHydrated(ref, mimeType)));
	}
	/** 문서에 남은 이미지 참조 목록을 정본에서 수집한다(아카이브·워밍에 재사용). */
	collectRefs(props) {
		const src = typeof props.src === "string" ? props.src : "";
		return src.startsWith("sha256:") ? [{
			ref: src,
			mimeType: isAllowedImageMime(String(props.mimeType)) ? String(props.mimeType) : "image/png"
		}] : [];
	}
	dispose() {
		if (this.disposed) return;
		this.disposed = true;
		for (const entry of this.cache.values()) URL.revokeObjectURL(entry.objectUrl);
		this.cache.clear();
		this.listeners.clear();
		this.inflight.clear();
	}
	async ensureHydrated(ref, mimeType) {
		const cached = this.cache.get(ref);
		if (cached) return cached;
		const pending = this.inflight.get(ref);
		if (pending) return pending;
		const job = (async () => {
			const bytes = await this.blobs.get(ref);
			if (!bytes || this.disposed) return void 0;
			return this.populateEntry(ref, bytes, mimeType);
		})();
		this.inflight.set(ref, job);
		try {
			return await job;
		} finally {
			this.inflight.delete(ref);
		}
	}
	populateEntry(ref, bytes, mimeType) {
		const prior = this.cache.get(ref);
		if (prior) return prior;
		const safeMime = isAllowedImageMime(mimeType) ? mimeType : "image/png";
		const copy = new Uint8Array(bytes.byteLength);
		copy.set(bytes);
		const entry = {
			objectUrl: URL.createObjectURL(new Blob([copy], { type: safeMime })),
			dataUrl: bytesToBase64DataUrl(copy, safeMime),
			mimeType: safeMime,
			refCount: 0
		};
		this.cache.set(ref, entry);
		const subscribers = this.listeners.get(ref);
		this.listeners.delete(ref);
		for (const notify of subscribers ?? []) notify();
		return entry;
	}
	/** 원본 크기는 유입 시점에 한 번만 디코딩하며, 이후에는 정본 메타데이터만 읽는다. */
	async decodeDimensions(blob) {
		if (typeof createImageBitmap === "function") try {
			const bitmap = await createImageBitmap(blob);
			const size = {
				width: Math.max(1, bitmap.width),
				height: Math.max(1, bitmap.height)
			};
			bitmap.close();
			return size;
		} catch {}
		if (typeof document === "undefined" || typeof URL?.createObjectURL !== "function") return {
			width: 320,
			height: 240
		};
		return new Promise((resolve) => {
			const url = URL.createObjectURL(blob);
			const image = new Image();
			const settle = (width, height) => {
				URL.revokeObjectURL(url);
				resolve({
					width: Math.max(1, width),
					height: Math.max(1, height)
				});
			};
			image.onload = () => settle(image.naturalWidth, image.naturalHeight);
			image.onerror = () => settle(320, 240);
			image.src = url;
		});
	}
};
/** 크롭 영역과 원본 해상도로 카드의 종횡비를 계산하는 순수 함수. */
function cropAspectRatio(naturalWidth, naturalHeight, crop) {
	const width = naturalWidth > 0 ? naturalWidth : 320;
	const height = naturalHeight > 0 ? naturalHeight : 240;
	const safe = clampCrop(crop);
	return width * safe.w / Math.max(1, height * safe.h);
}
// src/extension.ts
function escapeXml(value) {
	return value.replace(/[&<>"']/g, (character) => character === "&" ? "&amp;" : character === "<" ? "&lt;" : character === ">" ? "&gt;" : character === "\"" ? "&quot;" : "&apos;");
}
function deriveMediaImage(props, _id, view) {
	const transform = view.getCanonical(_id, "core.transform") ?? {
		x: 0,
		y: 0
	};
	const bounds = view.getCanonical(_id, "core.bounds");
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
		rotation: Number.isFinite(transform.rotation) ? transform.rotation : 0,
		aspectRatio,
		crop
	};
}
function createMediaImageExtension(assets) {
	const getAssets = typeof assets === "function" ? assets : () => assets;
	return defineExtension({
		id: "media.image",
		layout: true,
		dependsOnComputed: [],
		label: "이미지",
		summary: "CAS 블롭 외부화·비파괴 UV 크롭·순수 벡터 SVG 출판을 지원하는 이미지 컴포넌트",
		defaults: {
			src: "",
			mimeType: "image/png",
			naturalWidth: 320,
			naturalHeight: 240,
			fit: "cover",
			crop: null,
			alt: "",
			caption: "",
			cornerRadius: 8
		},
		textSearchFields: ["alt", "caption"],
		dependsOnCanonical: [
			"core.transform",
			"core.bounds",
			"media.image"
		],
		derive: deriveMediaImage,
		renderDom(hostEl, props, derived) {
			const geom = derived ?? {
				width: 320,
				height: 240,
				crop: FULL_CROP
			};
			hostEl.style.cssText = `width:100%;height:${geom.height}px;position:relative;overflow:hidden;border-radius:${props.cornerRadius}px;background:var(--alid-bg-muted,#f4f4f5);border:1px solid var(--alid-border-subtle,#e4e4e7);user-select:none;`;
			let image = hostEl.querySelector("img[data-role=\"media-img\"]");
			if (!image) {
				image = document.createElement("img");
				image.dataset.role = "media-img";
				image.decoding = "async";
				image.draggable = false;
				image.crossOrigin = "anonymous";
				hostEl.replaceChildren(image);
			}
			image.alt = props.alt || props.caption || "캔버스 이미지";
			const { x, y, w, h } = geom.crop;
			const isCropped = x > 0 || y > 0 || w < 1 || h < 1;
			image.style.cssText = isCropped ? `position:absolute;width:${100 / w}%;height:${100 / h}%;left:${-x / w * 100}%;top:${-y / h * 100}%;object-fit:fill;pointer-events:none;` : `width:100%;height:100%;display:block;object-fit:${props.fit};pointer-events:none;`;
			if (props.src.startsWith("https://")) {
				if (image.src !== props.src) image.src = props.src;
				return;
			}
			if (!props.src.startsWith("sha256:")) return;
			return getAssets().retainObjectUrl(props.src, props.mimeType, (url) => {
				if (image && image.src !== url) image.src = url;
			});
		},
		renderSvg(props, derived, entityId) {
			if (!derived) return { svg: "" };
			const { x, y, width, height, rotation, crop } = derived;
			const degrees = rotation * 180 / Math.PI;
			const clipId = `img-clip-${escapeXml(entityId)}`;
			const href = getAssets().getSyncExportHref(props.src);
			const preserve = props.fit === "contain" ? "xMidYMid meet" : props.fit === "fill" ? "none" : "xMidYMid slice";
			const imgX = -crop.x / crop.w * width;
			const imgY = -crop.y / crop.h * height;
			const imgW = width / crop.w;
			const imgH = height / crop.h;
			const body = href ? `<image href="${escapeXml(href)}" x="${imgX}" y="${imgY}" width="${imgW}" height="${imgH}" preserveAspectRatio="${preserve}" clip-path="url(#${clipId})"/>` : `<rect width="${width}" height="${height}" rx="${props.cornerRadius}" fill="#f4f4f5" stroke="#d4d4d8"/>`;
			return { svg: `<g transform="translate(${x},${y}) rotate(${degrees},${width / 2},${height / 2})"><defs><clipPath id="${clipId}"><rect width="${width}" height="${height}" rx="${props.cornerRadius}"/></clipPath></defs>${body}</g>` };
		},
		ui: { controls: [
			{
				id: "image.add.shelf",
				kind: "action",
				label: "이미지 추가",
				icon: "image",
				commandSymbol: "media:insert-image",
				placement: "tool-shelf",
				requiresSelection: false
			},
			{
				id: "image.fit.selection",
				kind: "segmented",
				field: "fit",
				label: "채우기",
				mnemonic: "f",
				placement: "selection-bar",
				options: [
					{
						label: "채움",
						value: "cover"
					},
					{
						label: "맞춤",
						value: "contain"
					},
					{
						label: "늘림",
						value: "fill"
					}
				]
			},
			{
				id: "image.reset-ratio.selection",
				kind: "action",
				label: "원본 비율",
				mnemonic: "a",
				commandSymbol: "media:reset-aspect-ratio",
				placement: "selection-bar",
				requiresSelection: true
			},
			{
				id: "image.fit.inspector",
				kind: "segmented",
				field: "fit",
				label: "맞춤 방식",
				placement: "inspector",
				options: [
					{
						label: "채움",
						value: "cover"
					},
					{
						label: "맞춤",
						value: "contain"
					},
					{
						label: "늘림",
						value: "fill"
					}
				]
			},
			{
				id: "image.radius.inspector",
				kind: "slider",
				field: "cornerRadius",
				label: "모서리 둥글기",
				min: 0,
				max: 32,
				step: 2,
				placement: "inspector"
			},
			{
				id: "image.alt.inspector",
				kind: "text",
				field: "alt",
				label: "대체 텍스트 (검색용)",
				placement: "inspector"
			},
			{
				id: "image.caption.inspector",
				kind: "text",
				field: "caption",
				label: "캡션",
				placement: "inspector"
			}
		] }
	});
}
// src/install.ts
var IMAGE_PATTERN = /^image\//;
function createMediaImageSuite(blobs) {
	let store = blobs ?? new CasBlobStore();
	let assets = new MediaAssetService(store), released = false;
	const aspect = createMediaImageExtension(() => assets);
	const insertFiles = async (context, files, activeAssets, isActive) => {
		const creation = context.services.get("canvas.creation");
		if (!creation) throw new Error("이미지 삽입에는 canvas.creation 호스트 서비스가 필요합니다.");
		for (const file of files) {
			if (!IMAGE_PATTERN.test(file.type)) continue;
			if (!isActive()) return;
			const meta = await activeAssets.ingestFile(file);
			if (!isActive()) return;
			const scale = Math.min(1, 480 / meta.naturalWidth);
			creation.create({
				caller: "media:insert-image",
				width: Math.max(64, Math.round(meta.naturalWidth * scale)),
				height: Math.max(64, Math.round(meta.naturalHeight * scale)),
				aspects: { "media.image": {
					src: meta.ref,
					mimeType: meta.mimeType,
					naturalWidth: meta.naturalWidth,
					naturalHeight: meta.naturalHeight,
					alt: file.name.replace(/\.[^.]+$/, "")
				} }
			});
		}
	};
	const containsEditableTarget = (target) => target instanceof Element && !!target.closest("input,textarea,[contenteditable]:not([contenteditable=\"false\"]),dialog[open]");
	return {
		id: "media.image-suite",
		summary: "이미지를 붙여넣거나 파일을 끌어와 추가합니다.",
		aspects: [aspect],
		activate(context) {
			const sharedStore = context.services.get("kernel.blobs");
			if (!blobs && sharedStore && sharedStore !== store) {
				assets.dispose();
				store = sharedStore;
				assets = new MediaAssetService(store);
				released = false;
			}
			if (released) {
				assets = new MediaAssetService(store);
				released = false;
			}
			const activeAssets = assets;
			let active = true;
			const insert = (files) => insertFiles(context, files, activeAssets, () => active);
			const offService = context.services.provide("media.assets", assets);
			const offInsert = context.commands.register({
				id: "media:insert-image",
				title: "이미지 파일 추가",
				summary: "로컬 이미지를 CAS 저장소에 넣고 현재 캔버스 중앙에 배치합니다.",
				run: () => {
					const input = document.createElement("input");
					input.type = "file";
					input.accept = "image/*";
					input.multiple = true;
					input.onchange = () => {
						if (input.files && active) insert(input.files).catch((error) => console.error("[media.image]", error));
					};
					input.click();
				}
			});
			const offResetRatio = context.commands.register({
				id: "media:reset-aspect-ratio",
				title: "이미지 원본 비율 복원",
				summary: "현재 너비를 유지한 채 원본 해상도·크롭 비율에 맞춰 높이를 재조정합니다.",
				run: () => {
					const selection = context.services.get("canvas.selection")?.getSelection() ?? [];
					const view = context.world.getCanonicalView();
					const ops = [];
					for (const id of selection) {
						const props = view.getCanonical(id, "media.image");
						if (!props || !view.isAlive(id)) continue;
						const bounds = view.getCanonical(id, "core.bounds");
						const width = bounds?.width && bounds.width > 0 ? bounds.width : Math.min(480, props.naturalWidth);
						const ratio = cropAspectRatio(props.naturalWidth, props.naturalHeight, clampCrop(props.crop));
						const height = Math.max(32, Math.round(width / ratio));
						if (bounds?.height === height) continue;
						ops.push({
							id,
							aspect: "core.bounds",
							patch: {
								width,
								height
							}
						});
					}
					if (ops.length) context.world.applyCanonicalTransaction("media:reset-aspect-ratio", ops, "local:user");
				}
			});
			const onPaste = (event) => {
				if (event.defaultPrevented || containsEditableTarget(event.target)) return;
				if (context.services.get("canvas.clipboard")) return;
				const files = Array.from(event.clipboardData?.files ?? []).filter((file) => IMAGE_PATTERN.test(file.type));
				if (!files.length) return;
				event.preventDefault();
				insert(files).catch((error) => console.error("[media.image]", error));
			};
			const offPasteHandler = context.services.get("canvas.clipboard")?.registerPasteHandler({
				id: "media.image-suite:image-files",
				priority: 70,
				canHandle: (ctx) => Array.from(ctx.clipboardData.files ?? []).some((file) => IMAGE_PATTERN.test(file.type)),
				buildOps: async (ctx) => {
					await insert(Array.from(ctx.clipboardData.files).filter((file) => IMAGE_PATTERN.test(file.type)));
					return [];
				}
			});
			const surface = context.services.get("canvas.surface")?.element;
			const onDragOver = (event) => {
				if (![...event.dataTransfer?.items ?? []].some((item) => item.kind === "file" && IMAGE_PATTERN.test(item.type))) return;
				event.preventDefault();
				if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
			};
			const onDrop = (event) => {
				const files = Array.from(event.dataTransfer?.files ?? []).filter((file) => IMAGE_PATTERN.test(file.type));
				if (!files.length) return;
				event.preventDefault();
				insert(files).catch((error) => console.error("[media.image]", error));
			};
			document.addEventListener("paste", onPaste);
			surface?.addEventListener("dragover", onDragOver);
			surface?.addEventListener("drop", onDrop);
			return () => {
				active = false;
				offPasteHandler?.();
				surface?.removeEventListener("drop", onDrop);
				surface?.removeEventListener("dragover", onDragOver);
				document.removeEventListener("paste", onPaste);
				offResetRatio();
				offInsert();
				offService();
				activeAssets.dispose();
				if (assets === activeAssets) released = true;
			};
		}
	};
}
// src/plugin.ts
var plugin_default = {
	...createMediaImageSuite(),
	...createPackageManifest(extension_default),
	summary: extension_default.summary
};
export { plugin_default as default };

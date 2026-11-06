var extension_default = {
	id: "example.sticky-notes",
	title: "스티키 노트",
	version: "0.3.0",
	summary: "캔버스에 짧은 메모를 추가하고 내용과 색상을 편집합니다.",
	engine: "^0.1.0",
	dependencies: {},
	optionalDependencies: {},
	conflicts: [],
	provides: {
		"services": [],
		"hsmSlots": []
	}
};
// src/manifest.js
/** Shared by the bundle and build script; keep the reviewed and executed contracts identical. */
function createPackageManifest(metadata) {
	return {
		id: metadata.id,
		version: metadata.version,
		engine: metadata.engine,
		dependencies: { ...metadata.dependencies },
		optionalDependencies: { ...metadata.optionalDependencies },
		conflicts: [...metadata.conflicts],
		provides: {
			services: [...metadata.provides.services],
			aspects: [`${metadata.id}.note`],
			hsmSlots: [...metadata.provides.hsmSlots]
		}
	};
}
// src/index.js
var aspectId = `${extension_default.id}.note`;
var addNoteCommand = `${extension_default.id}:add-note`;
var defaults = {
	title: "작은 생각",
	body: "이 메모를 선택하고 속성에서 내용을 바꿔 보세요.",
	color: "#f5f3ff"
};
var escapeXml = (value) => String(value).replace(/[&<>"']/g, (character) => ({
	"&": "&amp;",
	"<": "&lt;",
	">": "&gt;",
	"\"": "&quot;",
	"'": "&apos;"
})[character]);
var colorOf = (value) => /^#[a-f\d]{6}$/i.test(value) ? value : defaults.color;
var finite = (value, fallback) => Number.isFinite(value) ? value : fallback;
var positive = (value, fallback) => Number.isFinite(value) && value > 0 ? value : fallback;
function derive(_props, id, view) {
	const transform = view.getCanonical(id, "core.transform") ?? {};
	const bounds = view.getCanonical(id, "core.bounds") ?? {};
	return {
		x: finite(transform.x, 0),
		y: finite(transform.y, 0),
		width: positive(bounds.width, 240),
		height: positive(bounds.height, 160),
		rotation: finite(transform.rotation, 0)
	};
}
function noteBody(props, geometry) {
	const { width, height } = geometry;
	const inset = Math.min(16, width / 4, height / 4);
	const body = String(props.body ?? "").split(/\r?\n/).slice(0, Math.max(0, Math.floor((height - 72) / 20) + 1)).map((line, index) => `<tspan x="${inset}" y="${66 + index * 20}">${escapeXml(line)}</tspan>`).join("");
	return `<rect x="0.5" y="0.5" width="${Math.max(0, width - 1)}" height="${Math.max(0, height - 1)}" rx="8" fill="${colorOf(props.color)}" stroke="#ddd6fe"/>
<rect x="${inset}" y="16" width="22" height="3" rx="1.5" fill="#7c3aed"/>
<svg width="${width}" height="${height}" overflow="hidden"><text x="${inset}" y="43" fill="#28203b" font-family="system-ui, sans-serif" font-size="16" font-weight="600">${escapeXml(props.title ?? "")}</text><text fill="#5b5369" font-family="system-ui, sans-serif" font-size="12">${body}</text></svg>`;
}
var note = {
	id: aspectId,
	label: "스티키 노트",
	summary: extension_default.summary,
	defaults,
	textFields: ["title", "body"],
	textSearchFields: ["title", "body"],
	dependsOnCanonical: [
		aspectId,
		"core.transform",
		"core.bounds"
	],
	dependsOnComputed: [],
	derive,
	renderDom(content, props, geometry) {
		if (!geometry) return;
		content.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="${geometry.height}" viewBox="0 0 ${geometry.width} ${geometry.height}" role="img" aria-label="${escapeXml(props.title ?? "스티키 노트")}" style="display:block;user-select:none;pointer-events:none">${noteBody(props, geometry)}</svg>`;
	},
	renderSvg(props, geometry) {
		if (!geometry) return { svg: "" };
		const { x, y, width, height, rotation } = geometry;
		return { svg: `<g transform="translate(${x},${y}) rotate(${rotation * 180 / Math.PI},${width / 2},${height / 2})">${noteBody(props, geometry)}</g>` };
	},
	ui: { controls: [
		{
			id: "note-title",
			kind: "text",
			field: "title",
			label: "제목",
			placement: "inspector"
		},
		{
			id: "note-body",
			kind: "text",
			field: "body",
			label: "메모",
			placement: "inspector"
		},
		{
			id: "note-color",
			kind: "color",
			field: "color",
			label: "배경색",
			placement: "inspector"
		}
	] }
};
var src_default = {
	...createPackageManifest(extension_default),
	summary: extension_default.summary,
	aspects: [note],
	ui: { controls: [{
		id: "add-note",
		kind: "action",
		label: "스티키 노트 추가",
		icon: "document",
		commandSymbol: addNoteCommand,
		placement: "tool-shelf",
		requiresSelection: false
	}] },
	activate(context) {
		const creation = context.services.get("canvas.creation");
		if (!creation) throw new Error("스티키 노트에는 canvas.creation 호스트 서비스가 필요합니다.");
		let active = true;
		const addNote = () => {
			if (!active) throw new Error("스티키 노트 확장이 비활성화되었습니다. 공개 API를 다시 조회하세요.");
			return creation.create({
				caller: addNoteCommand,
				aspects: { [aspectId]: { ...defaults } },
				width: 240,
				height: 160
			});
		};
		const offCommand = context.commands.register({
			id: addNoteCommand,
			title: "스티키 노트 추가",
			summary: "현재 캔버스 중앙에 메모를 추가합니다.",
			shortcutScope: "canvas",
			run: addNote
		});
		return {
			api: Object.freeze({ addNote }),
			dispose() {
				if (!active) return;
				active = false;
				offCommand();
			}
		};
	}
};
export { src_default as default };

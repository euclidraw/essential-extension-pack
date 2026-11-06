var extension_default = {
	id: "space.frame",
	title: "프레임",
	version: "0.1.1",
	summary: "프레임을 만들고 선택한 객체를 프레임에 넣습니다.",
	engine: "^0.1.0",
	dependencies: {
		"space.group": "^0.1.2",
		"core.select-suite": "^0.1.0"
	},
	optionalDependencies: {},
	conflicts: [],
	provides: {
		"services": [],
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
			services: [],
			aspects: ["space.scoped-frame"],
			hsmSlots: []
		}
	};
}
// src/index.js
var ID = "space.scoped-frame";
var escape = (value) => String(value).replace(/[&<>"']/g, (c) => ({
	"&": "&amp;",
	"<": "&lt;",
	">": "&gt;",
	"\"": "&quot;",
	"'": "&apos;"
})[c]);
var geometry = (_props, id, view) => {
	const t = view.getCanonical(id, "core.transform") ?? {}, b = view.getCanonical(id, "core.bounds") ?? {};
	return {
		x: t.x ?? 0,
		y: t.y ?? 0,
		rotation: t.rotation ?? 0,
		width: b.width ?? 640,
		height: b.height ?? 480
	};
};
var body = (p, g) => `<rect x="0.5" y="0.5" width="${Math.max(0, g.width - 1)}" height="${Math.max(0, g.height - 1)}" fill="#ffffff" fill-opacity="0.06" stroke="#7c3aed" stroke-dasharray="6 4"/><text x="12" y="22" fill="#6d28d9" font-family="sans-serif" font-size="14">${escape(p.title)}</text>`;
var aspect = {
	id: ID,
	label: "프레임",
	summary: extension_default.summary,
	defaults: { title: "프레임" },
	textFields: ["title"],
	textSearchFields: ["title"],
	dependsOnCanonical: [
		ID,
		"core.transform",
		"core.bounds"
	],
	dependsOnComputed: [],
	derive: geometry,
	renderDom(el, p, g) {
		if (g) el.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 ${g.width} ${g.height}" style="pointer-events:none">${body(p, g)}</svg>`;
	},
	renderSvg(p, g) {
		return { svg: g ? `<g transform="translate(${g.x},${g.y}) rotate(${g.rotation * 180 / Math.PI},${g.width / 2},${g.height / 2})">${body(p, g)}</g>` : "" };
	},
	ui: { controls: [{
		id: "title",
		kind: "text",
		field: "title",
		label: "제목",
		placement: "inspector"
	}] }
};
var src_default = {
	...createPackageManifest(extension_default),
	summary: extension_default.summary,
	aspects: [aspect],
	ui: { controls: [{
		id: "create",
		kind: "action",
		label: "프레임 추가",
		icon: "plus",
		commandSymbol: "frame:create",
		placement: "tool-shelf",
		requiresSelection: false
	}, {
		id: "attach",
		kind: "action",
		label: "프레임에 넣기",
		icon: "plus",
		commandSymbol: "frame:attach",
		placement: "selection-bar",
		requiresSelection: true,
		minSelectionCount: 2
	}] },
	activate(context) {
		const group = context.requireExtensionApi("space.group"), creation = context.services.require("canvas.creation"), selection = context.services.require("canvas.selection"), surfaces = context.services.require("canvas.active-tool-surface");
		const offExpander = context.world.registerSelectionExpander((ids) => {
			const children = /* @__PURE__ */ new Map(), result = new Set(ids);
			for (const id of context.world.listEntityIds()) {
				const owner = group.getParent(id);
				if (!owner) continue;
				const siblings = children.get(owner) ?? [];
				siblings.push(id);
				children.set(owner, siblings);
			}
			const visit = (node, path) => {
				if (path.has(node)) throw new Error("순환 프레임은 이동할 수 없습니다.");
				const next = new Set(path);
				next.add(node);
				for (const child of children.get(node) ?? []) {
					const isGroup = group.isGroup(child), isFrame = !!context.world.getCanonical(child, ID);
					if (!isGroup) result.add(child);
					if (isGroup || isFrame) visit(child, next);
				}
			};
			for (const id of ids) if (context.world.getCanonical(id, ID)) visit(id, /* @__PURE__ */ new Set());
			return [...result];
		});
		const add = () => creation.create({
			caller: "frame:create",
			aspects: { [ID]: { title: "프레임" } },
			width: 640,
			height: 480
		});
		const attach = () => {
			const ids = [...(surfaces.get()?.selection ?? selection).getSelection()];
			const frames = ids.filter((id) => context.world.getCanonical(id, ID));
			if (frames.length !== 1) throw new Error("프레임 하나와 넣을 객체를 함께 선택하세요.");
			group.setParent(ids.filter((id) => id !== frames[0]), frames[0], "frame:attach");
		};
		const disposers = [context.commands.register({
			id: "frame:create",
			title: "프레임 추가",
			summary: "현재 화면에 프레임을 만듭니다.",
			run: add
		}), context.commands.register({
			id: "frame:attach",
			title: "프레임에 넣기",
			summary: "선택한 객체를 선택한 프레임에 넣습니다.",
			run: attach
		})];
		return () => {
			for (const dispose of disposers.reverse()) dispose();
			offExpander();
		};
	}
};
export { src_default as default };

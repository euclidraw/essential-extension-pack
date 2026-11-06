var extension_default = {
	id: "space.group",
	title: "그룹",
	version: "0.1.0",
	summary: "선택한 객체의 그룹을 만들고 해제합니다.",
	engine: "^0.1.0",
	dependencies: { "core.select-suite": "^0.1.0" },
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
			aspects: ["space.group"],
			hsmSlots: []
		}
	};
}
// src/index.js
var HIERARCHY = "core.hierarchy";
var GROUP = "space.group";
var aspect = {
	id: GROUP,
	label: "그룹",
	summary: extension_default.summary,
	defaults: { label: "그룹" },
	textFields: ["label"]
};
var src_default = {
	...createPackageManifest(extension_default),
	summary: extension_default.summary,
	aspects: [aspect],
	ui: { controls: [
		{
			id: "group",
			kind: "action",
			label: "선택 항목 그룹화",
			icon: "plus",
			commandSymbol: "group:create",
			placement: "selection-bar",
			requiresSelection: true,
			minSelectionCount: 2
		},
		{
			id: "members",
			kind: "action",
			label: "그룹 구성원 선택",
			icon: "plus",
			commandSymbol: "group:select-members",
			placement: "selection-bar",
			requiresSelection: true
		},
		{
			id: "ungroup",
			kind: "action",
			label: "그룹 해제",
			icon: "plus",
			commandSymbol: "group:ungroup",
			placement: "selection-bar",
			requiresSelection: true
		}
	] },
	activate(context) {
		const world = context.world, selection = context.services.require("canvas.selection");
		const surfaces = context.services.require("canvas.active-tool-surface");
		const offSchema = world.hasCanonicalSpec(HIERARCHY) ? () => {} : world.registerCanonical({
			id: HIERARCHY,
			defaults: { parentId: null },
			entityRefs: { parentId: "nullify" }
		});
		let active = true;
		const selected = () => [...(surfaces.get()?.selection ?? selection).getSelection()];
		const parent = (id) => world.getCanonical(id, HIERARCHY)?.parentId ?? null;
		const run = (caller, ops) => {
			if (!active) throw new Error("그룹 확장이 비활성화되었습니다.");
			const history = surfaces.get()?.host.history;
			if (!history) throw new Error("활성 캔버스의 Undo 기록을 사용할 수 없습니다.");
			history.begin();
			try {
				world.applyCanonicalTransaction(caller, ops, "local:user");
				history.commit();
			} catch (error) {
				history.abort();
				throw error;
			}
		};
		const setParent = (ids, target, caller = "group:reparent") => {
			if (!world.hasEntity(target) || !ids.length || new Set(ids).size !== ids.length) throw new Error("유효한 대상과 구성원이 필요합니다.");
			for (const id of ids) {
				if (!world.hasEntity(id) || world.isEntityReadOnly(id)) throw new Error("읽기 전용 또는 없는 객체는 이동할 수 없습니다.");
				const visited = /* @__PURE__ */ new Set();
				let node = target;
				while (node) {
					if (node === id || visited.has(node)) throw new Error("순환 계층을 만들 수 없습니다.");
					visited.add(node);
					node = parent(node);
				}
			}
			run(caller, ids.map((id) => ({
				id,
				aspect: HIERARCHY,
				patch: { parentId: target }
			})));
		};
		const create = () => {
			const ids = selected();
			if (ids.length < 2) throw new Error("두 개 이상의 객체를 선택하세요.");
			const original = parent(ids[0]);
			if (ids.some((id) => parent(id) !== original || world.isEntityReadOnly(id))) throw new Error("같은 부모에 속한 편집 가능한 객체를 선택하세요.");
			const id = `group:${crypto.randomUUID()}`;
			run("group:create", [
				{
					id,
					aspect: GROUP,
					patch: { label: "그룹" }
				},
				...original ? [{
					id,
					aspect: HIERARCHY,
					patch: { parentId: original }
				}] : [],
				...ids.map((child) => ({
					id: child,
					aspect: HIERARCHY,
					patch: { parentId: id }
				}))
			]);
			return id;
		};
		const groupOfSelection = () => {
			const ids = selected();
			const p = ids.length ? parent(ids[0]) : null;
			if (!p || !world.getCanonical(p, GROUP) || ids.some((id) => parent(id) !== p)) throw new Error("같은 그룹의 구성원을 선택하세요.");
			return p;
		};
		const members = (group) => world.listEntityIds().filter((id) => parent(id) === group && !world.isEntityReadOnly(id));
		const selectMembers = () => {
			const group = groupOfSelection();
			const surface = surfaces.get()?.selection ?? selection;
			if (typeof surface.setSelection !== "function") throw new Error("다중 선택을 사용할 수 없습니다.");
			surface.setSelection(members(group));
		};
		const ungroup = () => {
			const group = groupOfSelection(), children = world.listEntityIds().filter((id) => parent(id) === group), target = parent(group);
			if (children.some((id) => world.isEntityReadOnly(id))) throw new Error("읽기 전용 구성원이 있습니다.");
			run("group:ungroup", [
				...children.map((id) => ({
					id,
					aspect: HIERARCHY,
					patch: { parentId: target }
				})),
				{
					id: group,
					aspect: HIERARCHY,
					patch: null
				},
				{
					id: group,
					aspect: GROUP,
					patch: null
				}
			]);
		};
		const disposers = [
			context.commands.register({
				id: "group:create",
				title: "선택 항목 그룹화",
				summary: "같은 부모의 선택 객체를 그룹화합니다.",
				keys: ["Mod-g"],
				run: create
			}),
			context.commands.register({
				id: "group:select-members",
				title: "그룹 구성원 선택",
				summary: "선택한 객체와 같은 그룹의 구성원을 선택합니다.",
				run: selectMembers
			}),
			context.commands.register({
				id: "group:ungroup",
				title: "그룹 해제",
				summary: "선택한 객체의 그룹을 해제합니다.",
				keys: ["Mod-S-g"],
				run: ungroup
			})
		];
		return {
			api: Object.freeze({ setParent }),
			dispose() {
				active = false;
				for (const dispose of disposers.reverse()) dispose();
				offSchema();
			}
		};
	}
};
export { src_default as default };

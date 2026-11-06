import { readLayoutBounds } from "@alid/kernel";
var extension_default = {
	id: "connector.smart-wire",
	title: "스마트 연결선",
	version: "0.1.0",
	summary: "객체 사이를 연결하고 연결선의 경로를 조절합니다.",
	engine: "^0.1.0",
	dependencies: { "core.select-suite": "^0.1.0" },
	optionalDependencies: {},
	conflicts: [],
	provides: {
		"services": ["connector.tools"],
		"hsmSlots": []
	},
	settingsSchema: [{
		"key": "routing",
		"label": "새 연결선 경로",
		"kind": "select",
		"defaultValue": "orthogonal",
		"options": [{
			"label": "직교",
			"value": "orthogonal"
		}, {
			"label": "베지어",
			"value": "bezier"
		}],
		"frameScoped": true
	}]
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
			aspects: ["connector.ports", "connector.wire"],
			hsmSlots: [...m.provides.hsmSlots]
		}
	};
}
// src/ports.ts
var sides = [
	"north",
	"east",
	"south",
	"west"
];
/** Global distance wins before stacking order; ties are independent of document iteration order. */
function findNearestEntityPort(view, query) {
	if (![
		query.x,
		query.y,
		query.radius
	].every(Number.isFinite) || query.radius < 0) return void 0;
	let best, distance = query.radius * query.radius, zOrder = -Infinity;
	for (const id of query.entityIds ?? view.listEntityIds?.() ?? []) {
		const order = view.getPaintRank?.(id) ?? view.getComputed(id, "computed.effectiveBounds")?.zOrder;
		const z = typeof order === "number" && Number.isFinite(order) ? order : 0;
		for (const port of getEntityPorts(id, view)) {
			const dx = port.x - query.x, dy = port.y - query.y, squared = dx * dx + dy * dy;
			if (!Number.isFinite(squared) || squared > query.radius * query.radius) continue;
			const tie = Math.abs(squared - distance) <= 1e-9;
			if (!best || squared < distance - 1e-9 || tie && (z > zOrder || z === zOrder && (id < best.entityId || id === best.entityId && port.id < best.id))) {
				best = port;
				distance = squared;
				zOrder = z;
			}
		}
	}
	return best;
}
/** @deprecated Use `readLayoutBounds` from `@alid/kernel`. */
function getEntityLayoutBounds(id, view) {
	return readLayoutBounds(view, id);
}
/** A ports aspect is attachable to any entity with the public layout-bounds projection. */
function getEntityPorts(id, view, authored) {
	if (!view.isAlive(id)) return [];
	const bounds = getEntityLayoutBounds(id, view);
	if (!bounds) return [];
	const props = authored ?? view.getCanonical(id, "connector.ports");
	if (props?.enabled === false) return [];
	const enabled = Array.isArray(props?.sides) ? sides.filter((side) => props.sides.includes(side)) : sides;
	const offset = Number.isFinite(props?.offset) ? Math.max(0, Math.min(1, props.offset)) : .5;
	const rotation = Number.isFinite(bounds.rotation) ? bounds.rotation : 0;
	const cosine = Math.cos(rotation), sine = Math.sin(rotation);
	const cx = bounds.x + bounds.width / 2, cy = bounds.y + bounds.height / 2;
	const clean = (value) => Math.abs(value) < 1e-9 ? 0 : value;
	return enabled.map((side) => {
		let x = 0, y = 0, nx = 0, ny = 0;
		if (side === "north") {
			x = bounds.width * (offset - .5);
			y = -bounds.height / 2;
			ny = -1;
		} else if (side === "south") {
			x = bounds.width * (offset - .5);
			y = bounds.height / 2;
			ny = 1;
		} else if (side === "east") {
			x = bounds.width / 2;
			y = bounds.height * (offset - .5);
			nx = 1;
		} else {
			x = -bounds.width / 2;
			y = bounds.height * (offset - .5);
			nx = -1;
		}
		return {
			id: side,
			entityId: id,
			side,
			x: clean(cx + x * cosine - y * sine),
			y: clean(cy + x * sine + y * cosine),
			nx: clean(nx * cosine - ny * sine),
			ny: clean(nx * sine + ny * cosine)
		};
	});
}
var ConnectorPortsExtension = {
	id: "connector.ports",
	summary: "어떤 바운딩 엔티티에도 부착할 수 있는 상하좌우 연결 포트",
	defaults: {
		enabled: true,
		sides: [
			"north",
			"east",
			"south",
			"west"
		],
		offset: .5
	},
	dependsOnCanonical: [
		"connector.ports",
		"core.transform",
		"core.bounds"
	],
	dependsOnComputed: ["computed.layoutBounds"],
	derive: (props, id, view) => getEntityPorts(id, view, props),
	ui: { controls: [{
		id: "ports.enabled.inspector",
		kind: "toggle",
		field: "enabled",
		label: "연결 포트 사용",
		mnemonic: "p",
		placement: "inspector"
	}, {
		id: "ports.offset.inspector",
		kind: "slider",
		field: "offset",
		label: "포트 위치",
		min: 0,
		max: 1,
		step: .05,
		placement: "inspector"
	}] }
};
// src/self-avoidance.ts
var EPS$1 = 1e-7;
var finite = (point) => Number.isFinite(point.x) && Number.isFinite(point.y);
var samePoint$1 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) <= EPS$1;
function onSegment(point, a, b, length) {
	if (length <= EPS$1) return samePoint$1(point, a);
	const ux = (b.x - a.x) / length, uy = (b.y - a.y) / length;
	const dx = point.x - a.x, dy = point.y - a.y;
	const along = dx * ux + dy * uy;
	return Math.abs(dx * uy - dy * ux) <= EPS$1 && along >= -1e-7 && along <= length + EPS$1;
}
/** Crossings, touches and positive-length overlaps conflict, including degenerate points. */
function segmentsConflict(a, b, c, d, allowSharedEndpoint = false) {
	if (!finite(a) || !finite(b) || !finite(c) || !finite(d)) return true;
	if (Math.max(a.x, b.x) < Math.min(c.x, d.x) - EPS$1 || Math.max(c.x, d.x) < Math.min(a.x, b.x) - EPS$1 || Math.max(a.y, b.y) < Math.min(c.y, d.y) - EPS$1 || Math.max(c.y, d.y) < Math.min(a.y, b.y) - EPS$1) return false;
	const ab = Math.hypot(b.x - a.x, b.y - a.y), cd = Math.hypot(d.x - c.x, d.y - c.y);
	if (!Number.isFinite(ab) || !Number.isFinite(cd)) return true;
	if (ab > EPS$1 && cd > EPS$1) {
		const ux = (b.x - a.x) / ab, uy = (b.y - a.y) / ab, vx = (d.x - c.x) / cd, vy = (d.y - c.y) / cd;
		const sideC = (c.x - a.x) * uy - (c.y - a.y) * ux, sideD = (d.x - a.x) * uy - (d.y - a.y) * ux;
		const sideA = (a.x - c.x) * vy - (a.y - c.y) * vx, sideB = (b.x - c.x) * vy - (b.y - c.y) * vx;
		if ((sideC > EPS$1 && sideD < -1e-7 || sideC < -1e-7 && sideD > EPS$1) && (sideA > EPS$1 && sideB < -1e-7 || sideA < -1e-7 && sideB > EPS$1)) return true;
	}
	const cOnAB = onSegment(c, a, b, ab), dOnAB = onSegment(d, a, b, ab), aOnCD = onSegment(a, c, d, cd), bOnCD = onSegment(b, c, d, cd);
	if (!cOnAB && !dOnAB && !aOnCD && !bOnCD) return false;
	if (!allowSharedEndpoint) return true;
	const shared = samePoint$1(a, c) || samePoint$1(a, d) ? a : samePoint$1(b, c) || samePoint$1(b, d) ? b : void 0;
	if (!shared) return true;
	return cOnAB && !samePoint$1(c, shared) || dOnAB && !samePoint$1(d, shared) || aOnCD && !samePoint$1(a, shared) || bOnCD && !samePoint$1(b, shared);
}
function distinct(points) {
	const result = [];
	for (const point of points) {
		if (!finite(point)) return void 0;
		if (!result.length || !samePoint$1(result[result.length - 1], point)) result.push(point);
	}
	return result;
}
/** Adjacent corners may meet; a reversal or any nonadjacent contact is rejected. */
function isSimplePolyline(points) {
	const vertices = distinct(points);
	if (!vertices) return false;
	for (let i = 0; i + 1 < vertices.length; i++) for (let j = i + 1; j + 1 < vertices.length; j++) if (segmentsConflict(vertices[i], vertices[i + 1], vertices[j], vertices[j + 1], j === i + 1)) return false;
	return true;
}
function pointSegmentDistance(point, a, b) {
	const length = Math.hypot(b.x - a.x, b.y - a.y);
	if (length <= EPS$1) return Math.hypot(point.x - a.x, point.y - a.y);
	const ux = (b.x - a.x) / length, uy = (b.y - a.y) / length;
	const along = Math.max(0, Math.min(length, (point.x - a.x) * ux + (point.y - a.y) * uy));
	return Math.hypot(point.x - (a.x + ux * along), point.y - (a.y + uy * along));
}
/** Worst local clearance deficit, bounded by preferred and independent of the sample count. */
function selfClearancePenalty(points, preferred = 8) {
	if (!Number.isFinite(preferred) || preferred <= 0) return 0;
	const vertices = distinct(points);
	if (!vertices) return Infinity;
	if (vertices.length < 4) return 0;
	const arc = [0];
	for (let i = 1; i < vertices.length; i++) {
		const distance = Math.hypot(vertices[i].x - vertices[i - 1].x, vertices[i].y - vertices[i - 1].y);
		if (!Number.isFinite(distance) || !Number.isFinite(arc[i - 1] + distance)) return Infinity;
		arc.push(arc[i - 1] + distance);
	}
	let closest = preferred;
	for (let i = 0; i + 1 < vertices.length; i++) {
		const a = vertices[i], b = vertices[i + 1], middle = arc[i] / 2 + arc[i + 1] / 2;
		for (let j = i + 2; j + 1 < vertices.length; j++) {
			if (arc[j] / 2 + arc[j + 1] / 2 - middle < 2 * preferred) continue;
			const c = vertices[j], d = vertices[j + 1];
			const dx = Math.max(Math.min(a.x, b.x) - Math.max(c.x, d.x), Math.min(c.x, d.x) - Math.max(a.x, b.x), 0);
			const dy = Math.max(Math.min(a.y, b.y) - Math.max(c.y, d.y), Math.min(c.y, d.y) - Math.max(a.y, b.y), 0);
			if (Math.hypot(dx, dy) >= closest) continue;
			const distance = segmentsConflict(a, b, c, d) ? 0 : Math.min(pointSegmentDistance(a, c, d), pointSegmentDistance(b, c, d), pointSegmentDistance(c, a, b), pointSegmentDistance(d, a, b));
			closest = Math.min(closest, distance);
			if (closest <= EPS$1) return preferred;
		}
	}
	return preferred * (1 - closest / preferred) ** 2;
}
// src/routing.ts
var EPS = 1e-7;
var midpoint = (a, b) => a / 2 + b / 2;
var finitePoint = (p) => Number.isFinite(p.x) && Number.isFinite(p.y);
function obstacleFromBounds(bounds, padding = 12) {
	const angle = Number.isFinite(bounds.rotation) ? bounds.rotation : 0;
	const cosine = Math.abs(Math.cos(angle)), sine = Math.abs(Math.sin(angle));
	const width = bounds.width * cosine + bounds.height * sine, height = bounds.width * sine + bounds.height * cosine;
	const cx = bounds.x + bounds.width / 2, cy = bounds.y + bounds.height / 2;
	return {
		minX: cx - width / 2 - padding,
		minY: cy - height / 2 - padding,
		maxX: cx + width / 2 + padding,
		maxY: cy + height / 2 + padding
	};
}
function bodyObstacleFromBounds(bounds) {
	const angle = Number.isFinite(bounds.rotation) ? bounds.rotation : 0;
	return {
		...obstacleFromBounds(bounds, 0),
		rect: {
			cx: bounds.x + bounds.width / 2,
			cy: bounds.y + bounds.height / 2,
			cos: Math.cos(angle),
			sin: Math.sin(angle),
			halfWidth: bounds.width / 2,
			halfHeight: bounds.height / 2
		}
	};
}
function validObstacle(box) {
	if (!Number.isFinite(box.minX) || !Number.isFinite(box.minY) || !Number.isFinite(box.maxX) || !Number.isFinite(box.maxY) || box.minX > box.maxX || box.minY > box.maxY) return false;
	const r = box.rect;
	if (!r) return true;
	if (!Number.isFinite(r.cx) || !Number.isFinite(r.cy) || !Number.isFinite(r.cos) || !Number.isFinite(r.sin) || !Number.isFinite(r.halfWidth) || !Number.isFinite(r.halfHeight) || r.halfWidth <= 0 || r.halfHeight <= 0 || Math.abs(Math.hypot(r.cos, r.sin) - 1) > 1e-6) return false;
	const x = Math.abs(r.cos) * r.halfWidth + Math.abs(r.sin) * r.halfHeight, y = Math.abs(r.sin) * r.halfWidth + Math.abs(r.cos) * r.halfHeight;
	return Number.isFinite(x) && Number.isFinite(y) && box.minX <= r.cx - x + EPS && box.maxX >= r.cx + x - EPS && box.minY <= r.cy - y + EPS && box.maxY >= r.cy + y - EPS;
}
function inside(point, obstacle) {
	if (point.x <= obstacle.minX + EPS || point.x >= obstacle.maxX - EPS || point.y <= obstacle.minY + EPS || point.y >= obstacle.maxY - EPS) return false;
	const r = obstacle.rect;
	if (!r) return true;
	const dx = point.x - r.cx, dy = point.y - r.cy, x = dx * r.cos + dy * r.sin, y = -dx * r.sin + dy * r.cos;
	return x > -r.halfWidth + EPS && x < r.halfWidth - EPS && y > -r.halfHeight + EPS && y < r.halfHeight - EPS;
}
/** 1 = proven clear, 0 = collision/invalid geometry, -1 = collision-check budget exhausted. */
function segmentStatus(a, b, obstacles, budget, collisions) {
	if (!finitePoint(a) || !finitePoint(b) || !Number.isFinite(b.x - a.x) || !Number.isFinite(b.y - a.y)) return 0;
	const segmentMinX = Math.min(a.x, b.x), segmentMaxX = Math.max(a.x, b.x), segmentMinY = Math.min(a.y, b.y), segmentMaxY = Math.max(a.y, b.y);
	let clear = true;
	for (const box of obstacles) {
		if (!validObstacle(box)) return 0;
		if (segmentMaxX <= box.minX + EPS || segmentMinX >= box.maxX - EPS || segmentMaxY <= box.minY + EPS || segmentMinY >= box.maxY - EPS) continue;
		if (budget) {
			if (!(budget.checks > 0)) return -1;
			budget.checks = Math.max(0, budget.checks - 1);
		}
		let ax = a.x, ay = a.y, bx = b.x, by = b.y, minX = box.minX, minY = box.minY, maxX = box.maxX, maxY = box.maxY;
		if (box.rect) {
			const r = box.rect, adx = ax - r.cx, ady = ay - r.cy, bdx = bx - r.cx, bdy = by - r.cy;
			ax = adx * r.cos + ady * r.sin;
			ay = -adx * r.sin + ady * r.cos;
			bx = bdx * r.cos + bdy * r.sin;
			by = -bdx * r.sin + bdy * r.cos;
			minX = -r.halfWidth;
			maxX = r.halfWidth;
			minY = -r.halfHeight;
			maxY = r.halfHeight;
		}
		if (!Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(bx) || !Number.isFinite(by) || !Number.isFinite(bx - ax) || !Number.isFinite(by - ay)) return 0;
		let enter = 0, exit = 1, misses = false;
		for (let axis = 0; axis < 2; axis++) {
			const low = (axis === 0 ? minX : minY) + EPS, high = (axis === 0 ? maxX : maxY) - EPS;
			const origin = axis === 0 ? ax : ay, delta = axis === 0 ? bx - ax : by - ay;
			if (low >= high) {
				misses = true;
				break;
			}
			if (delta === 0) {
				if (origin <= low || origin >= high) {
					misses = true;
					break;
				}
			} else {
				const first = (low - origin) / delta, last = (high - origin) / delta;
				enter = Math.max(enter, Math.min(first, last));
				exit = Math.min(exit, Math.max(first, last));
				if (enter >= exit) {
					misses = true;
					break;
				}
			}
		}
		if (!misses && enter < exit) {
			if (!collisions && !budget) return 0;
			clear = false;
			collisions?.add(box);
		}
	}
	return clear ? 1 : 0;
}
/** Open-body clipping also checks diagonal escapes and sampled curves without temporary points. */
function segmentAvoidsObstacles(a, b, obstacles, budget) {
	return segmentStatus(a, b, obstacles, budget) === 1;
}
/** Drop only monotonic collinear points; never erase a reversal or a port-normal turn. */
function simplify(points) {
	const result = [];
	for (const point of points) {
		const previous = result.at(-1);
		if (previous && Math.hypot(previous.x - point.x, previous.y - point.y) < EPS) continue;
		const before = result.at(-2);
		if (before && previous) {
			const ax = previous.x - before.x, ay = previous.y - before.y, bx = point.x - previous.x, by = point.y - previous.y;
			const cross = ax * by - ay * bx, scale = Math.hypot(ax, ay) * Math.hypot(bx, by);
			if (Number.isFinite(scale) && Math.abs(cross) <= EPS * Math.max(1, scale) && ax * bx + ay * by >= 0) result.pop();
		}
		result.push(point);
	}
	return result;
}
function direction(a, b) {
	return Math.abs(b.x - a.x) >= Math.abs(b.y - a.y) ? b.x > a.x ? 1 : 3 : b.y > a.y ? 2 : 4;
}
function axis(dir) {
	return dir % 2 ? 1 : 2;
}
function compatible(a, b, normal, source) {
	if (!normal) return true;
	const dot = (b.x - a.x) * normal.x + (b.y - a.y) * normal.y;
	return source ? dot >= -1e-7 : dot <= EPS;
}
function pathCost(points, normals) {
	let cost = 0, previous = 0;
	for (let i = 1; i < points.length; i++) {
		const current = direction(points[i - 1], points[i]);
		cost += Math.abs(points[i].x - points[i - 1].x) + Math.abs(points[i].y - points[i - 1].y);
		if (previous && axis(previous) !== axis(current)) cost += 12;
		previous = current;
	}
	const first = points[1], last = points.at(-2);
	if (first && normals.source && Math.abs((first.x - points[0].x) * normals.source.y - (first.y - points[0].y) * normals.source.x) > EPS) cost += 12;
	if (last && normals.target && Math.abs((points.at(-1).x - last.x) * normals.target.y - (points.at(-1).y - last.y) * normals.target.x) > EPS) cost += 12;
	return cost;
}
function pathStatus(path, obstacles, budget, collisions) {
	let clear = true;
	for (let index = 1; index < path.length; index++) {
		const status = segmentStatus(path[index - 1], path[index], obstacles, budget, collisions);
		if (status < 0) return -1;
		if (status === 0) {
			if (!collisions) return 0;
			clear = false;
		}
	}
	return clear ? 1 : 0;
}
function samePoint(a, b) {
	return Math.hypot(a.x - b.x, a.y - b.y) < EPS;
}
function joinedPath(path, options) {
	return options.terminals ? simplify([
		options.terminals.source,
		...path,
		options.terminals.target
	]) : simplify(path);
}
/** Contact/retrace tests share the collision budget; disjoint segment envelopes are free. */
function pairStatus(a, b, c, d, allowSharedEndpoint, budget) {
	if (samePoint(a, b) || samePoint(c, d)) return 1;
	if (Math.max(a.x, b.x) < Math.min(c.x, d.x) - EPS || Math.min(a.x, b.x) > Math.max(c.x, d.x) + EPS || Math.max(a.y, b.y) < Math.min(c.y, d.y) - EPS || Math.min(a.y, b.y) > Math.max(c.y, d.y) + EPS) return 1;
	if (!(budget.checks > 0)) return -1;
	budget.checks = Math.max(0, budget.checks - 1);
	return segmentsConflict(a, b, c, d, allowSharedEndpoint) ? 0 : 1;
}
function simplePathStatus(path, options, budget) {
	const whole = joinedPath(path, options);
	for (let first = 1; first < whole.length; first++) for (let second = first + 1; second < whole.length; second++) {
		const status = pairStatus(whole[first - 1], whole[first], whole[second - 1], whole[second], second === first + 1, budget);
		if (status !== 1) return status;
	}
	return isSimplePolyline(whole) ? 1 : 0;
}
/** Cheap candidates use only nearby envelopes; every returned route is validated against the full scene. */
function fastRoute(start, end, obstacles, options, budget) {
	const midX = midpoint(start.x, end.x), midY = midpoint(start.y, end.y);
	const horizontal = [
		start,
		{
			x: midX,
			y: start.y
		},
		{
			x: midX,
			y: end.y
		},
		end
	];
	const vertical = [
		start,
		{
			x: start.x,
			y: midY
		},
		{
			x: end.x,
			y: midY
		},
		end
	];
	const direct = options.source && Math.abs(options.source.y) > Math.abs(options.source.x) ? [vertical, horizontal] : [horizontal, vertical];
	direct.push([
		start,
		{
			x: end.x,
			y: start.y
		},
		end
	], [
		start,
		{
			x: start.x,
			y: end.y
		},
		end
	]);
	if (obstacles.length) {
		let left = Math.min(start.x, end.x), right = Math.max(start.x, end.x), top = Math.min(start.y, end.y), bottom = Math.max(start.y, end.y);
		for (const box of obstacles) {
			left = Math.min(left, box.minX);
			right = Math.max(right, box.maxX);
			top = Math.min(top, box.minY);
			bottom = Math.max(bottom, box.maxY);
		}
		left -= 1;
		right += 1;
		top -= 1;
		bottom += 1;
		direct.push([
			start,
			{
				x: start.x,
				y: top
			},
			{
				x: end.x,
				y: top
			},
			end
		], [
			start,
			{
				x: start.x,
				y: bottom
			},
			{
				x: end.x,
				y: bottom
			},
			end
		], [
			start,
			{
				x: left,
				y: start.y
			},
			{
				x: left,
				y: end.y
			},
			end
		], [
			start,
			{
				x: right,
				y: start.y
			},
			{
				x: right,
				y: end.y
			},
			end
		]);
	}
	const candidates = direct.map(simplify).filter((path) => path.length >= 2 && path.every(finitePoint) && compatible(path[0], path[1], options.source, true) && compatible(path.at(-2), path.at(-1), options.target, false)).map((path) => ({
		path,
		cost: pathCost(path, options) + selfClearancePenalty(joinedPath(path, options))
	})).filter((candidate) => Number.isFinite(candidate.cost) && candidate.cost <= (options.maxCost ?? Infinity)).sort((a, b) => a.cost - b.cost);
	for (const candidate of candidates) {
		const simple = simplePathStatus(candidate.path, options, budget);
		if (simple < 0) return null;
		if (simple === 0) continue;
		const status = pathStatus(candidate.path, obstacles, budget);
		if (status < 0) return null;
		if (status === 1) return candidate.path;
	}
	return [];
}
/** A* uses only local grid coordinates and spends the shared budget across every retry. */
function searchRoute(start, end, obstacles, options, budget) {
	const xs = [.../* @__PURE__ */ new Set([
		start.x,
		end.x,
		...obstacles.flatMap((o) => [o.minX, o.maxX])
	])].sort((a, b) => a - b);
	const ys = [.../* @__PURE__ */ new Set([
		start.y,
		end.y,
		...obstacles.flatMap((o) => [o.minY, o.maxY])
	])].sort((a, b) => a - b);
	const rows = ys.length, count = xs.length * rows;
	const startNode = xs.indexOf(start.x) * rows + ys.indexOf(start.y), endNode = xs.indexOf(end.x) * rows + ys.indexOf(end.y);
	const scores = /* @__PURE__ */ new Map(), parents = /* @__PURE__ */ new Map(), closed = /* @__PURE__ */ new Set();
	const heap = [], priorities = [];
	const push = (state, priority) => {
		let index = heap.length;
		heap.push(state);
		priorities.push(priority);
		while (index > 0) {
			const parent = index - 1 >>> 1;
			if (priorities[parent] <= priority) break;
			heap[index] = heap[parent];
			priorities[index] = priorities[parent];
			index = parent;
		}
		heap[index] = state;
		priorities[index] = priority;
	};
	const pop = () => {
		const state = heap[0], last = heap.pop(), priority = priorities.pop();
		if (heap.length) {
			let i = 0;
			while (i * 2 + 1 < heap.length) {
				let child = i * 2 + 1;
				if (child + 1 < heap.length && priorities[child + 1] < priorities[child]) child++;
				if (priorities[child] >= priority) break;
				heap[i] = heap[child];
				priorities[i] = priorities[child];
				i = child;
			}
			heap[i] = last;
			priorities[i] = priority;
		}
		return state;
	};
	const lower = Math.abs(start.x - end.x) + Math.abs(start.y - end.y), maxCost = options.maxCost ?? Infinity;
	if (!Number.isFinite(lower) || lower > maxCost) return [];
	const first = startNode * 5;
	scores.set(first, 0);
	push(first, lower);
	let found = -1;
	const point = {
		x: 0,
		y: 0
	}, next = {
		x: 0,
		y: 0
	}, chainStart = {
		x: 0,
		y: 0
	}, chainEnd = {
		x: 0,
		y: 0
	};
	while (heap.length && closed.size < count * 5) {
		const state = pop();
		if (closed.has(state)) continue;
		if (!(budget.states > 0)) return [];
		budget.states = Math.max(0, budget.states - 1);
		closed.add(state);
		const node = Math.floor(state / 5), previousDirection = state % 5;
		if (node === endNode) {
			found = state;
			break;
		}
		const xi = Math.floor(node / rows), yi = node % rows;
		point.x = xs[xi];
		point.y = ys[yi];
		for (let neighbor = 1; neighbor <= 4; neighbor++) {
			if (previousDirection && Math.abs(neighbor - previousDirection) === 2) continue;
			const dx = neighbor === 1 ? 1 : neighbor === 3 ? -1 : 0, dy = neighbor === 2 ? 1 : neighbor === 4 ? -1 : 0;
			const nx = xi + dx, ny = yi + dy;
			if (nx < 0 || ny < 0 || nx >= xs.length || ny >= rows) continue;
			next.x = xs[nx];
			next.y = ys[ny];
			const nextNode = nx * rows + ny;
			if (node === startNode && !compatible(point, next, options.source, true) || nextNode === endNode && !compatible(point, next, options.target, false)) continue;
			const nextState = nextNode * 5 + neighbor;
			const cost = scores.get(state) + Math.abs(next.x - point.x) + Math.abs(next.y - point.y) + (previousDirection && axis(previousDirection) !== axis(neighbor) ? 12 : 0);
			const estimate = cost + Math.abs(next.x - end.x) + Math.abs(next.y - end.y);
			if (!Number.isFinite(estimate) || estimate > maxCost || cost >= (scores.get(nextState) ?? Infinity)) continue;
			let simple = 1;
			if (options.terminals) {
				simple = pairStatus(point, next, options.terminals.source, start, node === startNode, budget);
				if (simple === 1) simple = pairStatus(point, next, end, options.terminals.target, nextNode === endNode, budget);
			}
			if (simple < 0) return [];
			if (simple === 0) continue;
			let cursor = state, parent = parents.get(cursor), adjacent = true, remaining = parents.size + 1;
			while (parent !== void 0 && remaining-- > 0) {
				const childNode = Math.floor(cursor / 5), parentNode = Math.floor(parent / 5);
				chainStart.x = xs[Math.floor(parentNode / rows)];
				chainStart.y = ys[parentNode % rows];
				chainEnd.x = xs[Math.floor(childNode / rows)];
				chainEnd.y = ys[childNode % rows];
				simple = pairStatus(point, next, chainStart, chainEnd, adjacent, budget);
				if (simple !== 1) break;
				cursor = parent;
				parent = parents.get(cursor);
				adjacent = false;
			}
			if (simple < 0) return [];
			if (simple === 0 || remaining < 0) continue;
			const status = segmentStatus(point, next, obstacles, budget);
			if (status < 0) return [];
			if (status === 0) continue;
			scores.set(nextState, cost);
			parents.set(nextState, state);
			push(nextState, estimate);
		}
	}
	if (found < 0) return [];
	const path = [];
	for (let state = found; state >= 0; state = parents.get(state) ?? -1) {
		const node = Math.floor(state / 5);
		path.push({
			x: xs[Math.floor(node / rows)],
			y: ys[node % rows]
		});
	}
	return simplify(path.reverse());
}
/** Direction-aware candidates and a bounded local search, with full-scene collision proofs. */
function routeOrthogonal(start, end, obstacles, options = {}) {
	if (!finitePoint(start) || !finitePoint(end) || !Number.isFinite(end.x - start.x) || !Number.isFinite(end.y - start.y) || obstacles.some((box) => !validObstacle(box)) || Number.isNaN(options.maxCost) || options.maxCost !== void 0 && options.maxCost < 0) return [];
	if (options.source && !finitePoint(options.source) || options.target && !finitePoint(options.target)) return [];
	if (options.terminals && (!finitePoint(options.terminals.source) || !finitePoint(options.terminals.target) || !Number.isFinite(start.x - options.terminals.source.x) || !Number.isFinite(start.y - options.terminals.source.y) || !Number.isFinite(options.terminals.target.x - end.x) || !Number.isFinite(options.terminals.target.y - end.y) || samePoint(options.terminals.source, options.terminals.target))) return [];
	if (obstacles.some((box) => inside(start, box) || inside(end, box))) return [];
	const budget = options.budget ?? {
		states: 1e5,
		checks: Infinity
	};
	if (Math.hypot(end.x - start.x, end.y - start.y) < EPS) return simplePathStatus([start], options, budget) === 1 ? [start] : [];
	if (options.terminals) {
		if (pairStatus(options.terminals.source, start, end, options.terminals.target, false, budget) !== 1) return [];
	}
	const minX = Math.min(start.x, end.x) - 64, maxX = Math.max(start.x, end.x) + 64, minY = Math.min(start.y, end.y) - 64, maxY = Math.max(start.y, end.y) + 64;
	const active = obstacles.filter((box) => box.maxX >= minX && box.minX <= maxX && box.maxY >= minY && box.minY <= maxY), included = new Set(active);
	for (let attempt = 0; attempt < 8; attempt++) {
		const fast = fastRoute(start, end, active, options, budget);
		if (fast === null) return [];
		const path = fast.length ? fast : options.fastOnly ? [] : searchRoute(start, end, active, options, budget);
		if (!path.length) return [];
		const collisions = /* @__PURE__ */ new Set(), status = pathStatus(path, obstacles, budget, collisions);
		if (status < 0) return [];
		if (status === 1) return simplePathStatus(path, options, budget) === 1 ? path : [];
		let added = false;
		for (const box of collisions) if (!included.has(box)) {
			included.add(box);
			active.push(box);
			added = true;
		}
		if (!added) return [];
	}
	return [];
}
var half = (a, b) => ({
	x: midpoint(a.x, b.x),
	y: midpoint(a.y, b.y)
});
function split(c) {
	const a = half(c[0], c[1]), b = half(c[1], c[2]), d = half(c[2], c[3]), e = half(a, b), f = half(b, d), m = half(e, f);
	return [[
		c[0],
		a,
		e,
		m
	], [
		m,
		f,
		d,
		c[3]
	]];
}
var SELF_EPS = 1e-10;
var cross = (a, b) => a.x * b.y - a.y * b.x;
function normalized(points) {
	if (!points.length || !points.every(finitePoint)) return void 0;
	const origin = points[0];
	const scale = Math.max(...points.map((p) => Math.max(Math.abs(p.x - origin.x), Math.abs(p.y - origin.y))));
	if (!Number.isFinite(scale) || scale === 0) return void 0;
	return {
		points: points.map((p) => ({
			x: (p.x - origin.x) / scale,
			y: (p.y - origin.y) / scale
		})),
		scale
	};
}
function roots(a, b, c) {
	if (Math.abs(a) < 1e-12) return Math.abs(b) < 1e-12 ? [] : [-c / b];
	const discriminant = b * b - 4 * a * c;
	if (discriminant < -1e-12) return [];
	const square = Math.sqrt(Math.max(0, discriminant));
	const q = -.5 * (b + (b < 0 ? -square : square));
	return q === 0 ? [-b / (2 * a)] : [q / a, c / q];
}
/** Analytic cubic double-point test, plus conservative rejection of interior stationary cusps/retracing. */
function cubicIsSimple(controls) {
	if (controls.length !== 4) return false;
	const values = normalized(controls);
	if (!values) return false;
	const [p, q, r, s] = values.points;
	if (Math.hypot(s.x - p.x, s.y - p.y) <= SELF_EPS) return false;
	const a = {
		x: -p.x + 3 * q.x - 3 * r.x + s.x,
		y: -p.y + 3 * q.y - 3 * r.y + s.y
	};
	const b = {
		x: 3 * p.x - 6 * q.x + 3 * r.x,
		y: 3 * p.y - 6 * q.y + 3 * r.y
	};
	const c = {
		x: 3 * (q.x - p.x),
		y: 3 * (q.y - p.y)
	};
	const candidates = [...roots(3 * a.x, 2 * b.x, c.x), ...roots(3 * a.y, 2 * b.y, c.y)];
	for (const t of candidates) if (t > SELF_EPS && t < .9999999999 && Math.hypot(3 * a.x * t * t + 2 * b.x * t + c.x, 3 * a.y * t * t + 2 * b.y * t + c.y) <= 1e-8) return false;
	const denominator = cross(a, b);
	if (Math.abs(denominator) > 1e-12) {
		const sum = -cross(a, c) / denominator;
		const component = Math.abs(a.x) >= Math.abs(a.y) ? "x" : "y";
		const discriminant = 4 * (-(b[component] * sum + c[component]) / a[component]) - 3 * sum * sum;
		if (!Number.isFinite(sum) || !Number.isFinite(discriminant)) return false;
		if (discriminant >= -1e-12) {
			const distance = Math.sqrt(Math.max(0, discriminant)), first = (sum - distance) / 2, last = (sum + distance) / 2;
			if (first >= -1e-10 && last <= 1.0000000001 && last > SELF_EPS && first < .9999999999) return false;
		}
	} else if (Math.abs(cross(a, c)) <= 1e-12) {
		const monotone = (axis) => {
			const values = [c[axis], 3 * a[axis] + 2 * b[axis] + c[axis]];
			if (Math.abs(a[axis]) > 1e-12) {
				const t = -b[axis] / (3 * a[axis]);
				if (t > 0 && t < 1) values.push(3 * a[axis] * t * t + 2 * b[axis] * t + c[axis]);
			}
			return Math.min(...values) > 1e-10 || Math.max(...values) < -1e-10;
		};
		if (!monotone("x") && !monotone("y")) return false;
	}
	return true;
}
function splitHull(controls) {
	let level = [...controls];
	const left = [level[0]], right = [level.at(-1)];
	while (level.length > 1) {
		level = level.slice(1).map((p, i) => half(level[i], p));
		left.push(level[0]);
		right.push(level.at(-1));
	}
	return [left, right.reverse()];
}
function quadraticIsSimple(c) {
	const n = normalized(c);
	if (!n) return false;
	const [a, b, d] = n.points, x = d.x - 2 * b.x + a.x, y = d.y - 2 * b.y + a.y;
	const t = Math.abs(x) >= Math.abs(y) ? (a.x - b.x) / x : (a.y - b.y) / y;
	return !Number.isFinite(t) || t <= SELF_EPS || t >= .9999999999 || Math.hypot(b.x - a.x + t * x, b.y - a.y + t * y) > 1e-8;
}
function axes(a, b) {
	const result = [{
		x: 1,
		y: 0
	}, {
		x: 0,
		y: 1
	}];
	for (const controls of [a, b]) for (let i = 0; i < controls.length; i++) {
		const next = controls[(i + 1) % controls.length], dx = next.x - controls[i].x, dy = next.y - controls[i].y, length = Math.hypot(dx, dy);
		if (length > 1e-14) result.push({
			x: -dy / length,
			y: dx / length
		}, {
			x: dx / length,
			y: dy / length
		});
	}
	return result;
}
function hullsClear(a, b, join) {
	const scale = normalized([
		...a,
		...b,
		...join ? [join] : []
	]);
	if (!scale) return false;
	const first = scale.points.slice(0, a.length), second = scale.points.slice(a.length, a.length + b.length), shared = join ? scale.points.at(-1) : void 0;
	for (const axis of axes(first, second)) {
		const av = first.map((p) => p.x * axis.x + p.y * axis.y), bv = second.map((p) => p.x * axis.x + p.y * axis.y);
		const lowA = Math.min(...av), highA = Math.max(...av), lowB = Math.min(...bv), highB = Math.max(...bv);
		if (highA < lowB - 1e-12 || highB < lowA - 1e-12) return true;
		if (shared && Math.hypot(a.at(-1).x - join.x, a.at(-1).y - join.y) <= 1e-7 && Math.hypot(b[0].x - join.x, b[0].y - join.y) <= 1e-7) {
			const center = shared.x * axis.x + shared.y * axis.y;
			if (highA <= center + 1e-12 && lowB >= center - 1e-12 && lowA < center - 1e-12 && highB > center + 1e-12 || highB <= center + 1e-12 && lowA >= center - 1e-12 && lowB < center - 1e-12 && highA > center + 1e-12) return true;
		}
	}
	return false;
}
/** Exact SVG line/quadratic pieces, proved disjoint by bounded control-hull subdivision. */
function roundedSvgIsSimple(pieces) {
	if (!pieces.length || pieces.length > 1024 || pieces.some((c) => c.length !== 2 && c.length !== 3 || !c.every(finitePoint) || !Number.isFinite(Math.hypot(c.at(-1).x - c[0].x, c.at(-1).y - c[0].y)) || c.length === 3 && !quadraticIsSimple(c))) return false;
	let remaining = 8192;
	const clear = (a, b, join, depth) => {
		for (const first of [a[0], a.at(-1)]) for (const last of [b[0], b.at(-1)]) if (Math.hypot(first.x - last.x, first.y - last.y) <= 1e-7 && (!join || Math.hypot(first.x - join.x, first.y - join.y) > 1e-7 || Math.hypot(last.x - join.x, last.y - join.y) > 1e-7)) return false;
		if (a.length === 2 && b.length === 2) return !segmentsConflict(a[0], a[1], b[0], b[1], !!join);
		if (hullsClear(a, b, join)) return true;
		if (--remaining < 0 || depth >= 18) return false;
		const extent = (c) => Math.max(Math.max(...c.map((p) => p.x)) - Math.min(...c.map((p) => p.x)), Math.max(...c.map((p) => p.y)) - Math.min(...c.map((p) => p.y)));
		if (extent(a) >= extent(b)) {
			const [left, right] = splitHull(a);
			return clear(left, b, join, depth + 1) && clear(right, b, join, depth + 1);
		}
		const [left, right] = splitHull(b);
		return clear(a, left, join, depth + 1) && clear(a, right, join, depth + 1);
	};
	for (let i = 0; i < pieces.length; i++) {
		if (i && Math.hypot(pieces[i - 1].at(-1).x - pieces[i][0].x, pieces[i - 1].at(-1).y - pieces[i][0].y) > 1e-7) return false;
		for (let j = i + 1; j < pieces.length; j++) if (!clear(pieces[i], pieces[j], j === i + 1 ? pieces[i].at(-1) : void 0, 0)) return false;
	}
	return true;
}
/** A control-hull proof, not a test of a fixed number of sampled points. */
function cubicAvoidsObstacles(controls, obstacles) {
	if (!controls.every(finitePoint)) return false;
	const clear = (c, box, depth) => {
		const minX = Math.min(...c.map((p) => p.x)), maxX = Math.max(...c.map((p) => p.x));
		const minY = Math.min(...c.map((p) => p.y)), maxY = Math.max(...c.map((p) => p.y));
		if (maxX <= box.minX + 1e-7 || minX >= box.maxX - 1e-7 || maxY <= box.minY + 1e-7 || minY >= box.maxY - 1e-7) return true;
		if (inside(c[0], box) || inside(c[3], box)) return false;
		if (depth === 22) return false;
		const [left, right] = split(c);
		return clear(left, box, depth + 1) && clear(right, box, depth + 1);
	};
	const minX = Math.min(controls[0].x, controls[1].x, controls[2].x, controls[3].x), maxX = Math.max(controls[0].x, controls[1].x, controls[2].x, controls[3].x);
	const minY = Math.min(controls[0].y, controls[1].y, controls[2].y, controls[3].y), maxY = Math.max(controls[0].y, controls[1].y, controls[2].y, controls[3].y);
	for (const box of obstacles) {
		if (maxX <= box.minX || minX >= box.maxX || maxY <= box.minY || minY >= box.maxY) continue;
		if (!clear(controls, box, 0)) return false;
	}
	return true;
}
function bezierControl(port, other) {
	const projected = (other.x - port.x) * port.nx + (other.y - port.y) * port.ny;
	const offset = projected >= 0 ? projected / 2 : 6.25 * Math.sqrt(-projected);
	return {
		x: port.x + port.nx * Math.max(1e-4, offset),
		y: port.y + port.ny * Math.max(1e-4, offset)
	};
}
function pointAt(c, t) {
	const s = 1 - t;
	return {
		x: s ** 3 * c[0].x + 3 * s * s * t * c[1].x + 3 * s * t * t * c[2].x + t ** 3 * c[3].x,
		y: s ** 3 * c[0].y + 3 * s * s * t * c[1].y + 3 * s * t * t * c[2].y + t ** 3 * c[3].y
	};
}
function flatness(c) {
	const dx = c[3].x - c[0].x, dy = c[3].y - c[0].y, length = Math.hypot(dx, dy);
	if (length < 1e-12) return Math.max(Math.hypot(c[1].x - c[0].x, c[1].y - c[0].y), Math.hypot(c[2].x - c[0].x, c[2].y - c[0].y));
	return Math.max(Math.abs((c[1].x - c[0].x) * dy - (c[1].y - c[0].y) * dx), Math.abs((c[2].x - c[0].x) * dy - (c[2].y - c[0].y) * dx)) / length;
}
/** At least 32 intervals, refined until the control hull is within 1/8 world pixel. */
function sampleCubic(c, intervals = 32) {
	const points = [c[0]];
	let exceeded = false;
	const append = (part, depth) => {
		if (exceeded) return;
		if (points.length >= 512) {
			exceeded = true;
			return;
		}
		if (flatness(part) <= .125) {
			points.push(part[3]);
			return;
		}
		if (depth === 10) {
			exceeded = true;
			return;
		}
		const [a, b] = split(part);
		append(a, depth + 1);
		append(b, depth + 1);
	};
	const derivative = (t) => {
		const s = 1 - t;
		return {
			x: 3 * s * s * (c[1].x - c[0].x) + 6 * s * t * (c[2].x - c[1].x) + 3 * t * t * (c[3].x - c[2].x),
			y: 3 * s * s * (c[1].y - c[0].y) + 6 * s * t * (c[2].y - c[1].y) + 3 * t * t * (c[3].y - c[2].y)
		};
	};
	for (let i = 0; i < intervals; i++) {
		if (exceeded) break;
		const t = i / intervals, u = (i + 1) / intervals, a = pointAt(c, t), b = pointAt(c, u), da = derivative(t), db = derivative(u);
		append([
			a,
			{
				x: a.x + da.x / (3 * intervals),
				y: a.y + da.y / (3 * intervals)
			},
			{
				x: b.x - db.x / (3 * intervals),
				y: b.y - db.y / (3 * intervals)
			},
			b
		], 0);
	}
	if (exceeded) return void 0;
	points[0] = c[0];
	points[points.length - 1] = c[3];
	return points;
}
function cubicGeometry(c) {
	if (!cubicIsSimple(c)) return void 0;
	const points = sampleCubic(c);
	if (!points) return void 0;
	return {
		points,
		path: `M${c[0].x},${c[0].y} C${c[1].x},${c[1].y} ${c[2].x},${c[2].y} ${c[3].x},${c[3].y}`
	};
}
function polylineGeometry(points) {
	return {
		points,
		path: points.map((point, index) => `${index ? "L" : "M"}${point.x},${point.y}`).join(" ")
	};
}
/** Rounded detours keep the same checked shape for SVG and GPU tessellation. */
function roundedGeometry(route, clear, maxRadius = 9) {
	if (route.length < 2 || route.length > 512 || !isSimplePolyline(route)) return {
		points: [],
		path: ""
	};
	const fallback = () => polylineGeometry(route);
	const pieces = [];
	let cursor = route[0];
	const line = (end) => {
		if (Math.hypot(end.x - cursor.x, end.y - cursor.y) > 1e-7) pieces.push([cursor, end]);
		cursor = end;
	};
	const points = [route[0]];
	let path = `M${route[0].x},${route[0].y}`;
	for (let i = 1; i < route.length - 1; i++) {
		const before = route[i - 1], corner = route[i], after = route[i + 1];
		const incoming = Math.hypot(corner.x - before.x, corner.y - before.y), outgoing = Math.hypot(after.x - corner.x, after.y - corner.y);
		const cross = (corner.x - before.x) * (after.y - corner.y) - (corner.y - before.y) * (after.x - corner.x);
		if (Math.abs(cross) < 1e-7) {
			path += ` L${corner.x},${corner.y}`;
			points.push(corner);
			line(corner);
			continue;
		}
		let radius = Math.min(maxRadius, incoming / 2, outgoing / 2), accepted = false;
		let a = corner, b = corner;
		for (let attempt = 0; attempt < 12 && radius > 1e-4; attempt++, radius /= 2) {
			a = {
				x: corner.x + (before.x - corner.x) * radius / incoming,
				y: corner.y + (before.y - corner.y) * radius / incoming
			};
			b = {
				x: corner.x + (after.x - corner.x) * radius / outgoing,
				y: corner.y + (after.y - corner.y) * radius / outgoing
			};
			const cubic = [
				a,
				{
					x: a.x / 3 + corner.x * 2 / 3,
					y: a.y / 3 + corner.y * 2 / 3
				},
				{
					x: b.x / 3 + corner.x * 2 / 3,
					y: b.y / 3 + corner.y * 2 / 3
				},
				b
			];
			if (!clear(cubic)) continue;
			const samples = sampleCubic(cubic, 4);
			if (!samples) continue;
			path += ` L${a.x},${a.y} Q${corner.x},${corner.y} ${b.x},${b.y}`;
			if (points.length + samples.length > 511) return fallback();
			line(a);
			pieces.push([
				a,
				corner,
				b
			]);
			cursor = b;
			points.push(a, ...samples.slice(1));
			accepted = true;
			break;
		}
		if (!accepted) {
			path += ` L${corner.x},${corner.y}`;
			points.push(corner);
			line(corner);
		}
	}
	const end = route.at(-1);
	path += ` L${end.x},${end.y}`;
	points.push(end);
	line(end);
	if (!roundedSvgIsSimple(pieces)) return fallback();
	return {
		points,
		path
	};
}
// src/endpoint-clearance.ts
/** Remove only a port's outward access channel; the actual body is never exempted. */
function subtract(rect, notch) {
	const minX = Math.max(rect.minX, notch.minX), maxX = Math.min(rect.maxX, notch.maxX);
	const minY = Math.max(rect.minY, notch.minY), maxY = Math.min(rect.maxY, notch.maxY);
	if (minX >= maxX || minY >= maxY) return [rect];
	return [
		{
			minX: rect.minX,
			minY: rect.minY,
			maxX: minX,
			maxY: rect.maxY
		},
		{
			minX: maxX,
			minY: rect.minY,
			maxX: rect.maxX,
			maxY: rect.maxY
		},
		{
			minX,
			minY: rect.minY,
			maxX,
			maxY: minY
		},
		{
			minX,
			minY: maxY,
			maxX,
			maxY: rect.maxY
		}
	].filter((piece) => piece.maxX - piece.minX > 1e-7 && piece.maxY - piece.minY > 1e-7);
}
/** A preferred halo with narrow normal-aligned portals, represented by exact rotated rectangles. */
function endpointClearance(bounds, ports, margin) {
	const r = bodyObstacleFromBounds(bounds).rect;
	const halfWidth = bounds.width / 2, halfHeight = bounds.height / 2;
	const local = (point) => {
		const dx = point.x - r.cx, dy = point.y - r.cy;
		return {
			x: dx * r.cos + dy * r.sin,
			y: -dx * r.sin + dy * r.cos
		};
	};
	const envelope = {
		minX: -halfWidth - margin,
		minY: -halfHeight - margin,
		maxX: halfWidth + margin,
		maxY: halfHeight + margin
	};
	let rectangles = [envelope];
	if (margin > 0) for (const port of ports) {
		const p = local(port), width = Math.min(6, Math.max(1, margin / 2));
		let notch;
		if (port.side === "east") notch = {
			minX: halfWidth,
			maxX: halfWidth + margin,
			minY: p.y - width,
			maxY: p.y + width
		};
		else if (port.side === "west") notch = {
			minX: -halfWidth - margin,
			maxX: -halfWidth,
			minY: p.y - width,
			maxY: p.y + width
		};
		else if (port.side === "north") notch = {
			minX: p.x - width,
			maxX: p.x + width,
			minY: -halfHeight - margin,
			maxY: -halfHeight
		};
		else notch = {
			minX: p.x - width,
			maxX: p.x + width,
			minY: halfHeight,
			maxY: halfHeight + margin
		};
		rectangles = rectangles.flatMap((rect) => subtract(rect, notch));
	}
	if (margin > 0) rectangles.push({
		minX: -halfWidth,
		minY: -halfHeight,
		maxX: halfWidth,
		maxY: halfHeight
	});
	const world = (rect) => {
		const x = rect.minX / 2 + rect.maxX / 2, y = rect.minY / 2 + rect.maxY / 2;
		const cx = r.cx + x * r.cos - y * r.sin, cy = r.cy + x * r.sin + y * r.cos;
		const hw = (rect.maxX - rect.minX) / 2, hh = (rect.maxY - rect.minY) / 2;
		const extentX = Math.abs(r.cos) * hw + Math.abs(r.sin) * hh, extentY = Math.abs(r.sin) * hw + Math.abs(r.cos) * hh;
		return {
			minX: cx - extentX,
			minY: cy - extentY,
			maxX: cx + extentX,
			maxY: cy + extentY,
			rect: {
				cx,
				cy,
				cos: r.cos,
				sin: r.sin,
				halfWidth: hw,
				halfHeight: hh
			}
		};
	};
	return {
		obstacles: rectangles.map(world),
		halo: world(envelope),
		margin,
		clearCurve: (controls) => cubicAvoidsObstacles(controls.map(local), rectangles)
	};
}
/** After leaving the source halo (or, backwards, the target halo), never enter it again. */
function respectsEndpointAccess(points, endpoint, reverse = false, allowFinalReturn = false) {
	if (!endpoint.margin || points.length < 2) return true;
	let phase = 0;
	const halo = [endpoint.halo];
	for (let offset = 1; offset < points.length; offset++) {
		const before = points[reverse ? points.length - offset : offset - 1];
		const point = points[reverse ? points.length - offset - 1 : offset];
		const within = inside(point, endpoint.halo);
		if (phase === 1 && !segmentAvoidsObstacles(before, point, halo)) {
			if (!allowFinalReturn || !within) return false;
			phase = 2;
		}
		if (phase === 2 && !within) return false;
		if (phase === 0 && !within) phase = 1;
	}
	return true;
}
// src/derive.ts
function facingPenalty(from, to) {
	const dx = to.x - from.x, dy = to.y - from.y;
	return (Math.max(0, -(from.nx * dx + from.ny * dy)) + Math.max(0, to.nx * dx + to.ny * dy)) * .7;
}
function boxDistance(point, box) {
	return Math.max(box.minX - point.x, point.x - box.maxX, box.minY - point.y, point.y - box.maxY, 0);
}
function firstHit(port, box) {
	let x = port.x, y = port.y, nx = port.nx, ny = port.ny;
	let minX = box.minX, maxX = box.maxX, minY = box.minY, maxY = box.maxY;
	if (box.rect) {
		const r = box.rect, dx = x - r.cx, dy = y - r.cy;
		x = dx * r.cos + dy * r.sin;
		y = -dx * r.sin + dy * r.cos;
		nx = port.nx * r.cos + port.ny * r.sin;
		ny = -port.nx * r.sin + port.ny * r.cos;
		minX = -r.halfWidth;
		maxX = r.halfWidth;
		minY = -r.halfHeight;
		maxY = r.halfHeight;
	}
	let enter = -Infinity, exit = Infinity;
	if (Math.abs(nx) < 1e-12) {
		if (x <= minX || x >= maxX) return Infinity;
	} else {
		const a = (minX - x) / nx, b = (maxX - x) / nx;
		enter = Math.max(enter, Math.min(a, b));
		exit = Math.min(exit, Math.max(a, b));
	}
	if (Math.abs(ny) < 1e-12) {
		if (y <= minY || y >= maxY) return Infinity;
	} else {
		const a = (minY - y) / ny, b = (maxY - y) / ny;
		enter = Math.max(enter, Math.min(a, b));
		exit = Math.min(exit, Math.max(a, b));
	}
	return enter < exit && exit > 1e-7 ? Math.max(0, enter) : Infinity;
}
/** Follow the actual rotated normal, shortening the escape before nearby bodies. */
function escape(port, desired, obstacles) {
	let distance = Math.max(desired, 1e-4);
	for (const box of obstacles) distance = Math.min(distance, firstHit(port, box) / 2);
	const point = {
		x: port.x + port.nx * distance,
		y: port.y + port.ny * distance
	};
	if (!Number.isFinite(distance) || distance <= 1e-7 || !finitePoint(point) || Math.hypot(point.x - port.x, point.y - port.y) < 1e-7 || !segmentAvoidsObstacles(port, point, obstacles)) return void 0;
	return point;
}
function routeCost(points, countBends) {
	let cost = 0;
	for (let i = 1; i < points.length; i++) {
		cost += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
		if (countBends && i > 1) {
			const a = points[i - 2], b = points[i - 1], c = points[i];
			if (Math.abs((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)) > 1e-7) cost += 12;
		}
	}
	return cost;
}
var BEZIER_DETOUR_RADIUS = 9;
/** Invalid or missing values fall back to the default; corners never exceed half of a neighbouring segment. */
function wireCornerRadius(props) {
	const value = props.cornerRadius;
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.min(value, 48) : 8;
}
function deriveWire(props, _id, view) {
	if (!props.from || !props.to) return { points: [] };
	const radiusLimit = wireCornerRadius(props);
	const sourceBounds = getEntityLayoutBounds(props.from, view), targetBounds = getEntityLayoutBounds(props.to, view);
	if (!sourceBounds || !targetBounds) return { points: [] };
	const sourcePorts = getEntityPorts(props.from, view), targetPorts = getEntityPorts(props.to, view);
	const sources = props.fromPort != null ? sourcePorts.filter((p) => p.id === props.fromPort) : sourcePorts;
	const targets = props.toPort != null ? targetPorts.filter((p) => p.id === props.toPort) : targetPorts;
	if (!sources.length || !targets.length) return { points: [] };
	const sourceBox = bodyObstacleFromBounds(sourceBounds), targetBox = bodyObstacleFromBounds(targetBounds);
	if (![sourceBox, targetBox].every((box) => [
		box.minX,
		box.minY,
		box.maxX,
		box.maxY
	].every(Number.isFinite))) return { points: [] };
	const scene = view;
	const otherBoxes = [];
	for (const id of [...scene.listEntityIds?.() ?? []].sort()) {
		if (id === props.from || id === props.to || !view.isAlive(id)) continue;
		const bounds = getEntityLayoutBounds(id, view);
		if (bounds) {
			const box = obstacleFromBounds(bounds, 0);
			if ([
				box.minX,
				box.minY,
				box.maxX,
				box.maxY
			].every(Number.isFinite)) otherBoxes.push(box);
		}
	}
	const padded = otherBoxes.map((box) => ({
		minX: box.minX - 12,
		minY: box.minY - 12,
		maxX: box.maxX + 12,
		maxY: box.maxY + 12
	}));
	const baseJobs = sources.flatMap((from) => targets.filter((to) => props.from !== props.to || from.id !== to.id).map((to) => ({
		from,
		to,
		lower: Math.hypot(to.x - from.x, to.y - from.y) + facingPenalty(from, to)
	}))).filter((pair) => Number.isFinite(pair.lower)).sort((a, b) => a.lower - b.lower).map((pair) => {
		const { from, to } = pair;
		const obstacles = otherBoxes.map((box, i) => {
			const padding = Math.min(12, boxDistance(from, box) / 2, boxDistance(to, box) / 2);
			return padding === 12 ? padded[i] : {
				minX: box.minX - padding,
				minY: box.minY - padding,
				maxX: box.maxX + padding,
				maxY: box.maxY + padding
			};
		});
		const distance = Math.hypot(to.x - from.x, to.y - from.y);
		let stub = Math.max(18, Math.min(36, distance / 5));
		const projected = (to.x - from.x) * from.nx + (to.y - from.y) * from.ny;
		if (from.nx * to.nx + from.ny * to.ny < -.9 && projected > 0) stub = Math.min(stub, projected / 3);
		const first = escape(from, stub, props.from === props.to ? obstacles : [...obstacles, targetBox]);
		const last = escape(to, stub, props.from === props.to ? obstacles : [...obstacles, sourceBox]);
		const margin = first && last ? Math.min(12, Math.hypot(first.x - from.x, first.y - from.y) * .75, Math.hypot(last.x - to.x, last.y - to.y) * .75) : 0;
		return {
			...pair,
			obstacles,
			first,
			last,
			margin
		};
	});
	const budget = {
		states: 2048,
		checks: 65536
	};
	for (const scale of [
		1,
		.5,
		0
	]) {
		let best = { points: [] }, bestCost = Infinity;
		const jobs = baseJobs.map((job) => {
			const { from, to, obstacles } = job, margin = job.margin * scale;
			const source = endpointClearance(sourceBounds, props.from === props.to ? [from, to] : [from], margin);
			const target = props.from === props.to ? source : endpointClearance(targetBounds, [to], margin);
			const bodies = target === source ? source.obstacles : [...source.obstacles, ...target.obstacles];
			const all = target === source ? [...obstacles, source.halo] : [
				...obstacles,
				source.halo,
				target.halo
			];
			const pathObstacles = [...obstacles, ...bodies];
			const clear = (c) => cubicAvoidsObstacles(c, obstacles) && source.clearCurve(c) && (target === source || target.clearCurve(c));
			const sampledClear = (points) => points.every((point, index) => !index || segmentAvoidsObstacles(points[index - 1], point, pathObstacles)) && respectsEndpointAccess(points, source, false, target === source) && (target === source || respectsEndpointAccess(points, target, true));
			return {
				...job,
				all,
				clear,
				sampledClear,
				fastRouted: false
			};
		});
		for (let phase = 0; phase < 2; phase++) for (const job of jobs) {
			const { from, to, lower, all, clear, sampledClear, first, last } = job;
			if (lower > bestCost || phase === 1 && (job.fastRouted || budget.states <= 0 || budget.checks <= 0)) continue;
			let geometry, costPoints;
			if (phase === 0 && props.routing === "bezier") {
				const controls = [
					{
						x: from.x,
						y: from.y
					},
					bezierControl(from, to),
					bezierControl(to, from),
					{
						x: to.x,
						y: to.y
					}
				];
				if (clear(controls)) {
					const curve = cubicGeometry(controls);
					if (curve && sampledClear(curve.points) && isSimplePolyline(curve.points)) geometry = curve;
				}
			}
			if (!geometry) {
				if (!first || !last) continue;
				const leadCost = Math.hypot(first.x - from.x, first.y - from.y) + Math.hypot(last.x - to.x, last.y - to.y);
				const middle = routeOrthogonal(first, last, all, {
					source: {
						x: from.nx,
						y: from.ny
					},
					target: {
						x: to.nx,
						y: to.ny
					},
					terminals: {
						source: from,
						target: to
					},
					fastOnly: phase === 0,
					budget,
					maxCost: props.routing === "bezier" ? Infinity : bestCost - facingPenalty(from, to) - leadCost
				});
				if (!middle.length) continue;
				const route = simplify([
					{
						x: from.x,
						y: from.y
					},
					...middle,
					{
						x: to.x,
						y: to.y
					}
				]);
				if (route.length < 2 || !sampledClear(route) || !isSimplePolyline(route)) continue;
				const radius = props.routing === "bezier" ? BEZIER_DETOUR_RADIUS : radiusLimit;
				geometry = radius > 0 ? roundedGeometry(route, clear, radius) : polylineGeometry(route);
				if (!sampledClear(geometry.points) || !isSimplePolyline(geometry.points)) geometry = polylineGeometry(route);
				if (props.routing !== "bezier") costPoints = route;
			}
			job.fastRouted = true;
			if (geometry.points.length > 512 || !geometry.points.every(finitePoint) || !geometry.path || /NaN|Infinity/.test(geometry.path)) continue;
			const cost = routeCost(costPoints ?? geometry.points, props.routing !== "bezier") + facingPenalty(from, to) + selfClearancePenalty(geometry.points);
			if (cost < bestCost) {
				bestCost = cost;
				best = {
					...geometry,
					fromPort: from,
					toPort: to,
					endTangent: {
						x: -to.nx,
						y: -to.ny
					}
				};
			}
		}
		if (best.points.length) return best;
	}
	return { points: [] };
}
// src/render-svg.ts
function renderWireSvg(props, derived) {
	if (!derived || derived.points.length < 2) return { svg: "" };
	const points = derived.points;
	const d = derived.path ?? points.map((point, index) => `${index ? "L" : "M"}${point.x},${point.y}`).join(" ");
	const end = points.at(-1);
	let dx = derived.endTangent?.x ?? NaN, dy = derived.endTangent?.y ?? NaN;
	let length = Math.hypot(dx, dy);
	if (!Number.isFinite(length) || length < 1e-9) {
		length = 0;
		for (let index = points.length - 2; index >= 0; index--) {
			dx = end.x - points[index].x;
			dy = end.y - points[index].y;
			const candidate = Math.hypot(dx, dy);
			if (Number.isFinite(candidate) && candidate >= 1e-9) {
				length = candidate;
				break;
			}
		}
	}
	const ux = length ? dx / length : 0, uy = length ? dy / length : 0;
	const bx = end.x - ux * 7, by = end.y - uy * 7;
	return { svg: `<g><path d="${d}" fill="none" stroke="#008FF0" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>${length ? `<path d="M${bx + uy * 4},${by - ux * 4}L${end.x},${end.y}L${bx - uy * 4},${by + ux * 4}" fill="none" stroke="#008FF0" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>` : ""}</g>` };
}
// src/polyline-selection.ts
function validPoints(shape) {
	if (!shape || !Array.isArray(shape.points) || shape.points.length < 2) return false;
	for (let index = 0; index < shape.points.length; index++) {
		const point = shape.points[index];
		if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return false;
	}
	return true;
}
/** Normalize before subtraction/projection so finite opposite endpoints cannot overflow. */
function segmentDistance(x, y, ax, ay, bx, by) {
	const scale = Math.max(1, Math.abs(x), Math.abs(y), Math.abs(ax), Math.abs(ay), Math.abs(bx), Math.abs(by));
	const dx = bx / scale - ax / scale, dy = by / scale - ay / scale, qx = x / scale - ax / scale, qy = y / scale - ay / scale;
	const length = Math.hypot(dx, dy);
	if (!length) return Math.hypot(qx, qy) * scale;
	const ux = dx / length, uy = dy / length, along = Math.max(0, Math.min(length, qx * ux + qy * uy));
	return Math.hypot(qx - along * ux, qy - along * uy) * scale;
}
function triangleDistance(x, y, length, width) {
	if (x <= 0 && x >= -length && Math.abs(y) <= -x * (width / length)) return 0;
	return Math.min(segmentDistance(x, y, 0, 0, -length, width), segmentDistance(x, y, 0, 0, -length, -width), segmentDistance(x, y, -length, width, -length, -width));
}
/** Minimum world-space distance to the rendered stroke centerline and arrow silhouette. */
function polylineDistance(shape, x, y, zoom) {
	if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(zoom) || zoom <= 0 || !validPoints(shape)) return Infinity;
	const points = shape.points;
	let closest = Infinity;
	for (let index = 1; index < points.length; index++) {
		const a = points[index - 1], b = points[index];
		if (a.x === b.x && a.y === b.y) continue;
		closest = Math.min(closest, segmentDistance(x, y, a.x, a.y, b.x, b.y));
	}
	if (shape.arrow === false) return closest;
	const end = points[points.length - 1];
	let dx = shape.endTangent?.x ?? NaN, dy = shape.endTangent?.y ?? NaN, length = Math.hypot(dx, dy);
	if (!Number.isFinite(length) || length < 1e-9) {
		length = 0;
		for (let index = points.length - 2; index >= 0; index--) {
			const scale = Math.max(1, Math.abs(end.x), Math.abs(end.y), Math.abs(points[index].x), Math.abs(points[index].y));
			dx = end.x / scale - points[index].x / scale;
			dy = end.y / scale - points[index].y / scale;
			const normalized = Math.hypot(dx, dy);
			if (normalized > 0 && normalized * scale >= 1e-9) {
				length = normalized;
				break;
			}
		}
	}
	if (!length) return closest;
	const ux = dx / length, uy = dy / length, scale = Math.max(1, Math.abs(x), Math.abs(y), Math.abs(end.x), Math.abs(end.y));
	const qx = x / scale - end.x / scale, qy = y / scale - end.y / scale;
	const along = (qx * ux + qy * uy) * scale, across = (-qx * uy + qy * ux) * scale;
	if (!Number.isFinite(along) || !Number.isFinite(across)) return closest;
	const arrowLength = Math.max(7 / zoom, 9);
	if (Number.isFinite(arrowLength)) closest = Math.min(closest, triangleDistance(along, across, arrowLength, arrowLength * .48));
	else if (along <= 0 && Math.abs(across) <= -along * .48) closest = 0;
	else {
		const norm = Math.hypot(1, .48), vx = -1 / norm, vy = .48 / norm;
		const upper = Math.max(0, along * vx + across * vy), lower = Math.max(0, along * vx - across * vy);
		closest = Math.min(closest, Math.hypot(along - upper * vx, across - upper * vy), Math.hypot(along - lower * vx, across + lower * vy));
	}
	return Math.min(closest, segmentDistance(along, across, 0, 0, -7, 4), segmentDistance(along, across, 0, 0, -7, -4));
}
function segmentIntersectsRect(ax, ay, bx, by, minX, minY, maxX, maxY) {
	if (Math.max(ax, bx) < minX || Math.min(ax, bx) > maxX || Math.max(ay, by) < minY || Math.min(ay, by) > maxY) return false;
	const scale = Math.max(1, Math.abs(ax), Math.abs(ay), Math.abs(bx), Math.abs(by), Math.abs(minX), Math.abs(minY), Math.abs(maxX), Math.abs(maxY));
	ax /= scale;
	ay /= scale;
	bx /= scale;
	by /= scale;
	minX /= scale;
	minY /= scale;
	maxX /= scale;
	maxY /= scale;
	let enter = 0, exit = 1;
	for (let axis = 0; axis < 2; axis++) {
		const origin = axis === 0 ? ax : ay, delta = axis === 0 ? bx - ax : by - ay, minimum = axis === 0 ? minX : minY, maximum = axis === 0 ? maxX : maxY;
		if (delta === 0) {
			if (origin < minimum || origin > maximum) return false;
			continue;
		}
		const first = (minimum - origin) / delta, last = (maximum - origin) / delta;
		enter = Math.max(enter, Math.min(first, last));
		exit = Math.min(exit, Math.max(first, last));
		if (enter > exit) return false;
	}
	return true;
}
/** Closed rectangle/actual-segment intersection; an empty bend's AABB is not selectable. */
function polylineIntersectsRect(shape, minX, minY, maxX, maxY) {
	if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY) || minX > maxX || minY > maxY || !validPoints(shape)) return false;
	for (let index = 1; index < shape.points.length; index++) {
		const a = shape.points[index - 1], b = shape.points[index];
		if (a.x === b.x && a.y === b.y) continue;
		if (segmentIntersectsRect(a.x, a.y, b.x, b.y, minX, minY, maxX, maxY)) return true;
	}
	return false;
}
// src/selection.ts
function geometry(id, view) {
	if (!view.isAlive(id) || !view.getCanonical(id, "connector.wire")) return void 0;
	const result = view.getComputed(id, "computed.connector.wire");
	if (!result || result.points.length < 2) return void 0;
	for (let index = 0; index < result.points.length; index++) if (!Number.isFinite(result.points[index].x) || !Number.isFinite(result.points[index].y)) return void 0;
	return result;
}
/** Wire-specific selection stays beside its routing, ports and SVG renderer. */
var wireSelectionContribution = {
	priority: 20,
	getBounds(id, view, out) {
		const wire = geometry(id, view);
		if (!wire) return false;
		let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
		for (let index = 0; index < wire.points.length; index++) {
			const point = wire.points[index];
			minX = Math.min(minX, point.x);
			minY = Math.min(minY, point.y);
			maxX = Math.max(maxX, point.x);
			maxY = Math.max(maxY, point.y);
		}
		const x = minX - 5, y = minY - 5, width = maxX - minX + 10, height = maxY - minY + 10;
		if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(width) || !Number.isFinite(height)) return false;
		out.x = x;
		out.y = y;
		out.width = width;
		out.height = height;
		out.rotation = 0;
		return true;
	},
	hitTest(id, view, x, y, zoom) {
		const wire = geometry(id, view);
		return wire ? polylineDistance(wire, x, y, zoom) : Infinity;
	},
	intersectsRect(id, view, minX, minY, maxX, maxY) {
		const wire = geometry(id, view);
		return !!wire && polylineIntersectsRect(wire, minX, minY, maxX, maxY);
	},
	getOutlinePath(id, view, projection) {
		const wire = geometry(id, view);
		if (!wire) return "";
		const out = {
			x: 0,
			y: 0
		};
		let path = "";
		for (let index = 0; index < wire.points.length; index++) {
			const point = wire.points[index];
			projection.worldToScreen(point.x, point.y, out);
			if (!Number.isFinite(out.x) || !Number.isFinite(out.y)) return "";
			path += `${index ? "L" : "M"}${out.x},${out.y}`;
		}
		return path;
	},
	canTransform: () => false
};
// src/extension.ts
/** The routed polyline's box, padded for the stroke and arrowhead. */
function wirePaintBounds(wire) {
	if (!wire?.points.length) return void 0;
	let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
	for (const point of wire.points) {
		minX = Math.min(minX, point.x);
		minY = Math.min(minY, point.y);
		maxX = Math.max(maxX, point.x);
		maxY = Math.max(maxY, point.y);
	}
	return {
		x: minX - 5,
		y: minY - 5,
		width: maxX - minX + 10,
		height: maxY - minY + 10
	};
}
var WireExtension = {
	id: "connector.wire",
	summary: "상하좌우 포트·장애물 회피·직교/베지어 경로를 지원하는 스마트 화살표",
	defaults: {
		from: null,
		to: null
	},
	refs: {
		from: "cascade-hide",
		to: "cascade-hide"
	},
	dependsOnComputed: ["computed.layoutBounds", "computed.connector.ports"],
	derive: deriveWire,
	paintBounds: wirePaintBounds,
	renderSvg: renderWireSvg,
	selection: wireSelectionContribution,
	ui: {
		modeline: [{
			id: "connector.active-routing",
			align: "right",
			priority: 20,
			renderText: (world, id) => {
				const wire = id ? world.getCanonical(id, "connector.wire") : void 0;
				return wire ? `연결 · ${wire.routing === "bezier" ? "베지어" : "직교"}` : null;
			}
		}],
		controls: [
			{
				id: "wire.routing.selection",
				kind: "segmented",
				field: "routing",
				label: "경로",
				mnemonic: "r",
				defaultValue: "orthogonal",
				placement: "selection-bar",
				options: [{
					label: "직교",
					value: "orthogonal"
				}, {
					label: "베지어",
					value: "bezier"
				}]
			},
			{
				id: "wire.routing.inspector",
				kind: "segmented",
				field: "routing",
				label: "연결 경로",
				mnemonic: "r",
				defaultValue: "orthogonal",
				placement: "inspector",
				options: [{
					label: "직교",
					value: "orthogonal"
				}, {
					label: "베지어",
					value: "bezier"
				}]
			},
			{
				id: "wire.corner-radius.inspector",
				kind: "slider",
				field: "cornerRadius",
				label: "직교 모서리 반경",
				mnemonic: "c",
				defaultValue: 8,
				min: 0,
				max: 48,
				step: 1,
				placement: "inspector"
			},
			{
				id: "wire.configure.inspector",
				kind: "action",
				label: "단계별 설정",
				commandSymbol: "connector:configure",
				placement: "inspector",
				requiresSelection: true
			}
		]
	}
};
// src/connectorpreview.ts
var emptyGeometry = { points: [] };
Object.freeze(emptyGeometry.points);
Object.freeze(emptyGeometry);
var previewSequence = 0;
var idle = () => ({
	active: false,
	status: "idle",
	cursor: {
		x: 0,
		y: 0
	},
	geometry: emptyGeometry,
	valid: false,
	label: ""
});
var hasRoute = (geometry) => !!geometry && geometry.points.length >= 2 && geometry.points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)) && geometry.points.some((point) => Math.hypot(point.x - geometry.points[0].x, point.y - geometry.points[0].y) > 1e-7);
/** A private memory overlay reuses the installed connector derive, without document writes. */
function createConnectorPreview(options) {
	const { world } = options;
	const ownerId = options.ownerId ?? `connector-preview-${++previewSequence}`;
	const suffix = `${ownerId}:${++previewSequence}`;
	const cursorId = `scratch:cursor:${suffix}`, wireId = `scratch:wire:${suffix}`;
	const scratch = world.createScratchOverlay(ownerId);
	let source, snapshot = idle(), disposed = false;
	let draftKey = "";
	let currentRouting = "orthogonal";
	const view = () => world.getPreviewView();
	const invalidSource = (cursor, sourcePort) => {
		scratch.clear();
		draftKey = "";
		return snapshot = {
			active: false,
			status: "invalid-source",
			sourceId: source?.sourceId,
			sourcePort,
			cursor,
			geometry: emptyGeometry,
			valid: false,
			label: "출발 포트를 사용할 수 없습니다."
		};
	};
	const sourcePorts = (read) => source && world.isAlive(source.sourceId) ? getEntityPorts(source.sourceId, read).filter((port) => source.sourcePortId === void 0 || port.id === source.sourcePortId) : [];
	const candidateView = (read) => ({
		listEntityIds: () => world.listEntityIds(),
		isAlive: (id) => read.isAlive(id),
		getComputed: (id, aspect) => read.getComputed(id, aspect),
		getIntrinsicDomSize: (id) => read.getIntrinsicDomSize(id),
		getCanonical(id, aspect) {
			const props = read.getCanonical(id, aspect);
			return aspect === "connector.ports" && props?.enabled === false ? {
				...props,
				enabled: true
			} : props;
		}
	});
	const resolveTarget = (input, read) => {
		const candidates = candidateView(read);
		let port;
		if (input.targetId !== void 0) {
			if (!world.isAlive(input.targetId)) return {
				id: input.targetId,
				invalid: "도착 대상이 사라졌습니다."
			};
			const ports = getEntityPorts(input.targetId, candidates);
			port = input.targetPortId !== void 0 ? ports.find((item) => item.id === input.targetPortId) : ports.reduce((best, item) => !best || Math.hypot(item.x - input.x, item.y - input.y) < Math.hypot(best.x - input.x, best.y - input.y) ? item : best, void 0);
			if (!port) return {
				id: input.targetId,
				invalid: "도착 포트를 사용할 수 없습니다."
			};
		} else {
			const radius = (options.snapRadiusScreenPx ?? 14) / input.zoom;
			port = findNearestEntityPort(candidates, {
				x: input.x,
				y: input.y,
				radius,
				entityIds: world.listEntityIds().filter((id) => id !== source.sourceId)
			});
		}
		if (!port) return {};
		if (!getEntityPorts(port.entityId, read).some((item) => item.id === port.id)) return {
			port,
			id: port.entityId,
			invalid: "사용할 수 없는 포트입니다."
		};
		if (source.sourceId === port.entityId) return {
			port,
			id: port.entityId,
			invalid: "다른 카드를 선택하세요."
		};
		return {
			port,
			id: port.entityId
		};
	};
	const update = (input) => {
		if (disposed || !source) return snapshot;
		const cursor = {
			x: input.x,
			y: input.y
		};
		if (![
			input.x,
			input.y,
			input.zoom
		].every(Number.isFinite) || input.zoom <= 0) {
			scratch.clear();
			draftKey = "";
			return snapshot = {
				active: true,
				status: "blocked",
				sourceId: source.sourceId,
				cursor,
				geometry: emptyGeometry,
				valid: false,
				label: "연결할 위치를 확인하세요."
			};
		}
		const read = view(), ports = sourcePorts(read);
		if (!ports.length) return invalidSource(cursor, snapshot.sourcePort);
		const target = resolveTarget(input, read);
		if (input.routing !== void 0) currentRouting = input.routing;
		const routing = currentRouting;
		const targetId = target.port && !target.invalid ? target.port.entityId : cursorId;
		let targetPortId = target.port && !target.invalid ? target.port.id : "";
		const bounds = getEntityLayoutBounds(source.sourceId, read);
		const origin = ports.find((port) => port.id === source.sourcePortId) ?? {
			x: bounds.x + bounds.width / 2,
			y: bounds.y + bounds.height / 2
		};
		const dx = origin.x - cursor.x, dy = origin.y - cursor.y;
		const side = Math.abs(dx) >= Math.abs(dy) ? dx >= 0 ? "east" : "west" : dy >= 0 ? "south" : "north";
		const free = targetId === cursorId;
		if (free) targetPortId = side;
		const size = free ? Math.max(1e-4, Math.max(Math.abs(cursor.x), Math.abs(cursor.y)) * Number.EPSILON * 8) : 0;
		const x = cursor.x - (side === "east" ? size : side === "west" ? 0 : size / 2);
		const y = cursor.y - (side === "south" ? size : side === "north" ? 0 : size / 2);
		const key = `${source.sourceId}\0${source.sourcePortId ?? ""}\0${targetId}\0${targetPortId}\0${routing}\0${free ? x : 0}\0${free ? y : 0}\0${size}`;
		if (key !== draftKey) {
			const ops = [
				{
					id: cursorId,
					aspect: "core.transform",
					patch: {
						x: free ? x : 0,
						y: free ? y : 0,
						rotation: 0
					}
				},
				{
					id: cursorId,
					aspect: "core.bounds",
					patch: {
						width: size,
						height: size
					}
				},
				{
					id: cursorId,
					aspect: "connector.ports",
					patch: {
						enabled: free,
						sides: [side],
						offset: .5
					}
				},
				{
					id: wireId,
					aspect: "connector.wire",
					patch: {
						from: source.sourceId,
						to: targetId,
						fromPort: source.sourcePortId ?? null,
						toPort: targetPortId,
						routing
					}
				},
				{
					id: wireId,
					aspect: "core.stacking",
					patch: { order: "zzzzzzzz" }
				}
			];
			scratch.setBatch(ops);
			draftKey = key;
		}
		const geometry = world.getComputed(wireId, "computed.connector.wire") ?? emptyGeometry;
		const route = hasRoute(geometry);
		const fromPort = geometry.fromPort ?? ports[0];
		let invalid = target.invalid;
		if (!invalid && target.port) {
			const compatible = options.canConnect?.(fromPort, target.port);
			if (compatible === false || typeof compatible === "string") invalid = typeof compatible === "string" ? compatible : "이 포트에는 연결할 수 없습니다.";
		}
		const status = invalid ? "invalid-target" : !route ? "blocked" : target.port ? "snapped" : "free";
		const valid = status === "snapped";
		return snapshot = {
			active: true,
			status,
			sourceId: source.sourceId,
			sourcePort: fromPort,
			targetId: target.id,
			targetPort: target.port,
			cursor,
			geometry,
			valid,
			label: invalid ?? (status === "snapped" ? `연결 가능 · ${target.port.id}` : status === "blocked" ? "이 위치로 연결할 수 없습니다." : "빈 공간에 놓아 새 카드를 연결하세요.")
		};
	};
	return {
		cursorId,
		wireId,
		begin(input) {
			if (disposed) return snapshot;
			scratch.clear();
			draftKey = "";
			source = { ...input };
			currentRouting = input.routing ?? "orthogonal";
			return update({
				x: input.x,
				y: input.y,
				zoom: 1
			});
		},
		update,
		getSnapshot: () => snapshot,
		clear() {
			if (disposed) return;
			scratch.clear();
			draftKey = "";
			source = void 0;
			snapshot = idle();
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			source = void 0;
			scratch.dispose();
			snapshot = idle();
		}
	};
}
var PREVIEW_ACCENT = "var(--alid-accent, #008FF0)";
/** A host-driven Plane 3 SVG overlay; no private frame or pointer loop. */
function mountConnectorPreviewPainter({ surface, gizmoPlane }) {
	const ns = "http://www.w3.org/2000/svg", svg = document.createElementNS(ns, "svg");
	svg.dataset.role = "connector-preview";
	svg.setAttribute("aria-hidden", "true");
	svg.style.cssText = "position:absolute;inset:0;width:100%;height:100%;overflow:visible;pointer-events:none;z-index:5";
	const group = document.createElementNS(ns, "g"), path = document.createElementNS(ns, "path"), arrow = document.createElementNS(ns, "path"), ring = document.createElementNS(ns, "circle");
	for (const element of [path, arrow]) {
		element.setAttribute("fill", "none");
		element.setAttribute("stroke", PREVIEW_ACCENT);
		element.setAttribute("stroke-width", "1.75");
		element.setAttribute("stroke-linecap", "round");
		element.setAttribute("stroke-linejoin", "round");
		element.setAttribute("vector-effect", "non-scaling-stroke");
	}
	ring.setAttribute("r", "6");
	ring.setAttribute("stroke", PREVIEW_ACCENT);
	ring.setAttribute("stroke-width", "1.5");
	ring.setAttribute("fill", "var(--alid-accent-soft, #e5f4fe)");
	ring.setAttribute("fill-opacity", "0.35");
	group.append(path);
	svg.append(group, arrow, ring);
	gizmoPlane.append(svg);
	let disposed = false;
	svg.style.display = "none";
	return {
		render(state, camera) {
			if (disposed) return;
			const visible = state.active && state.status !== "idle";
			svg.style.display = visible ? "" : "none";
			if (!visible) return;
			const width = surface.clientWidth, height = surface.clientHeight;
			svg.setAttribute("width", String(width));
			svg.setAttribute("height", String(height));
			svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
			group.setAttribute("transform", `translate(${width / 2} ${height / 2}) scale(${camera.zoom}) translate(${-camera.x} ${-camera.y})`);
			const muted = state.status === "invalid-target" || state.status === "blocked";
			const opacity = state.valid ? "1" : muted ? "0.38" : "0.82";
			path.setAttribute("stroke", PREVIEW_ACCENT);
			arrow.setAttribute("stroke", PREVIEW_ACCENT);
			path.setAttribute("stroke-opacity", opacity);
			arrow.setAttribute("stroke-opacity", opacity);
			path.setAttribute("stroke-dasharray", state.valid ? "none" : "5 4");
			path.setAttribute("d", state.geometry.path ?? state.geometry.points.map((point, index) => `${index ? "L" : "M"}${point.x},${point.y}`).join(" "));
			const points = state.geometry.points, end = points.at(-1), tangent = state.geometry.endTangent;
			let dx = tangent?.x ?? 0, dy = tangent?.y ?? 0, length = Math.hypot(dx, dy);
			if (!Number.isFinite(length) || length < 1e-9) for (let i = points.length - 2; end && i >= 0; i--) {
				dx = end.x - points[i].x;
				dy = end.y - points[i].y;
				length = Math.hypot(dx, dy);
				if (length >= 1e-9 && Number.isFinite(length)) break;
			}
			if (end && Number.isFinite(length) && length >= 1e-9) {
				const x = (end.x - camera.x) * camera.zoom + width / 2, y = (end.y - camera.y) * camera.zoom + height / 2, ux = dx / length, uy = dy / length;
				arrow.setAttribute("d", `M${x - ux * 6.5 + uy * 3.5},${y - uy * 6.5 - ux * 3.5}L${x},${y}L${x - ux * 6.5 - uy * 3.5},${y - uy * 6.5 + ux * 3.5}`);
			} else arrow.setAttribute("d", "");
			if (state.valid && state.targetPort) {
				ring.style.display = "";
				ring.setAttribute("cx", String((state.targetPort.x - camera.x) * camera.zoom + width / 2));
				ring.setAttribute("cy", String((state.targetPort.y - camera.y) * camera.zoom + height / 2));
			} else ring.style.display = "none";
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			svg.remove();
		}
	};
}
// src/wiring-tool.ts
var CONNECT_STATE = "root.select.connector.smart-wire:connect";
var IDLE_STATE = "root.select.core.select-suite:idle";
var DRAG_SLOP = 3.5;
/** Per-view input/HSM owner. Pointer movement only records scalars for the host's single frame. */
var WiringTool = class {
	host;
	preview;
	painter;
	abort = new AbortController();
	disposers = [];
	worldPoint = {
		x: 0,
		y: 0
	};
	update = {
		x: 0,
		y: 0,
		zoom: 1,
		targetId: void 0,
		targetPortId: void 0,
		routing: "orthogonal"
	};
	hidden = {
		active: false,
		status: "idle",
		cursor: {
			x: 0,
			y: 0
		},
		geometry: { points: [] },
		valid: false,
		label: ""
	};
	sourceId;
	sourcePortId;
	pointerId = null;
	startX = 0;
	startY = 0;
	clientX = 0;
	clientY = 0;
	dragging = false;
	dirty = false;
	composing = false;
	compositionEndedAt = -Infinity;
	awaiting;
	revision = 0;
	disposed = false;
	lastCameraX = NaN;
	lastCameraY = NaN;
	lastZoom = NaN;
	constructor(host) {
		this.host = host;
		this.preview = createConnectorPreview({ world: host.world });
		this.painter = mountConnectorPreviewPainter({
			surface: host.surface,
			gizmoPlane: host.gizmoPlane,
			hudPlane: host.hudPlane
		});
		this.disposers.push(host.selection.stateMachine.mountChildState("root.select", {
			id: "connector.smart-wire:connect",
			onExit: () => this.reset()
		}));
		for (const id of ["wiring", "creating"]) this.disposers.push(host.selection.stateMachine.mountChildState(CONNECT_STATE, { id }));
		const signal = this.abort.signal;
		host.surface.addEventListener("pointerdown", this.onPointerDown, { signal });
		host.surface.addEventListener("pointermove", this.onPointerMove, { signal });
		host.surface.addEventListener("pointerup", this.onPointerUp, { signal });
		host.surface.addEventListener("pointercancel", this.onPointerCancel, { signal });
		host.surface.addEventListener("lostpointercapture", this.onPointerCancel, { signal });
		host.surface.addEventListener("compositionstart", () => {
			this.composing = true;
			this.cancel();
		}, { signal });
		host.surface.addEventListener("compositionend", () => {
			this.composing = false;
			this.compositionEndedAt = performance.now();
		}, { signal });
		document.addEventListener("keydown", this.onKeyDown, { signal });
		window.addEventListener("blur", () => this.cancel(), { signal });
		this.disposers.push(host.world.subscribe(() => {
			if (this.sourceId && !this.awaiting) {
				this.dirty = true;
				host.requestRender();
			}
		}));
	}
	get active() {
		return this.sourceId !== void 0;
	}
	enter() {
		this.host.selection.stateMachine.transition(CONNECT_STATE);
	}
	toWorld() {
		const rect = this.host.surface.getBoundingClientRect(), camera = this.host.camera;
		this.worldPoint.x = (this.clientX - rect.left - this.host.surface.clientWidth / 2) / camera.zoom + camera.x;
		this.worldPoint.y = (this.clientY - rect.top - this.host.surface.clientHeight / 2) / camera.zoom + camera.y;
	}
	/** Port gizmos call this before the ordinary selection listener claims a drag. */
	startFromPort(id, portId, event) {
		if (this.disposed || this.composing || this.host.isInputBlocked() || this.host.isPanGesture(event)) return;
		this.record(event);
		if (this.sourceId) {
			this.complete(id, portId);
			return;
		}
		this.begin(id, portId, event);
	}
	record(event) {
		this.clientX = event.clientX;
		this.clientY = event.clientY;
	}
	begin(id, portId, event) {
		if (this.host.world.isEntityReadOnly(id)) return;
		const ports = getEntityPorts(id, this.host.world);
		if (!ports.length || portId && !ports.some((port) => port.id === portId)) return;
		this.toWorld();
		this.sourceId = id;
		this.sourcePortId = portId;
		this.preview.begin({
			sourceId: id,
			sourcePortId: portId,
			x: this.worldPoint.x,
			y: this.worldPoint.y,
			routing: this.host.getRouting()
		});
		this.host.onBegin(id);
		this.host.selection.stateMachine.transition(`${CONNECT_STATE}.wiring`);
		this.pointerId = event.pointerId;
		this.startX = event.clientX;
		this.startY = event.clientY;
		this.dragging = false;
		this.dirty = true;
		this.host.surface.setPointerCapture?.(event.pointerId);
		this.host.surface.focus({ preventScroll: true });
		this.host.requestRender();
	}
	onPointerDown = (event) => {
		if (this.disposed || this.composing || event.defaultPrevented || event.button !== 0 || this.host.getMode() !== "connect" || this.host.isInputBlocked() || this.host.isPanGesture(event)) return;
		const element = event.target instanceof Element ? event.target : null;
		if (element?.closest("button,input,textarea,select,[data-canvas-ui]")) return;
		this.record(event);
		this.toWorld();
		const nearest = findNearestEntityPort(this.host.world, {
			x: this.worldPoint.x,
			y: this.worldPoint.y,
			radius: 14 / this.host.camera.zoom
		});
		const id = nearest?.entityId ?? element?.closest("[data-entity-id]")?.dataset.entityId;
		if (this.sourceId) {
			event.preventDefault();
			if (id) this.complete(id, nearest?.id);
			else this.quickCreate();
			return;
		}
		if (!id) return;
		event.preventDefault();
		this.begin(id, nearest?.id, event);
	};
	onPointerMove = (event) => {
		if (!this.sourceId || this.awaiting || this.disposed || this.composing || this.host.isInputBlocked()) return;
		this.record(event);
		if (this.pointerId === event.pointerId && !this.dragging) {
			const dx = event.clientX - this.startX, dy = event.clientY - this.startY;
			this.dragging = dx * dx + dy * dy >= DRAG_SLOP * DRAG_SLOP;
		}
		this.update.targetId = void 0;
		this.update.targetPortId = void 0;
		this.dirty = true;
		this.host.requestRender();
	};
	onPointerUp = (event) => {
		if (!this.sourceId || event.pointerId !== this.pointerId || this.disposed) return;
		this.record(event);
		const dragged = this.dragging;
		this.releasePointer();
		if (!dragged) return;
		this.refresh();
		const snapshot = this.preview.getSnapshot();
		if (snapshot.valid && snapshot.targetPort) this.complete(snapshot.targetPort.entityId, snapshot.targetPort.id);
		else if (snapshot.status === "free") this.quickCreate();
		event.preventDefault();
	};
	onPointerCancel = (event) => {
		if (event.pointerId === this.pointerId) this.cancel();
	};
	onKeyDown = (event) => {
		if (!this.sourceId || event.defaultPrevented || event.key !== "Escape" || this.composing || event.isComposing || event.keyCode === 229 || performance.now() - this.compositionEndedAt < 16) return;
		event.preventDefault();
		this.cancel();
	};
	refresh(targetId, targetPortId) {
		if (!this.sourceId || this.awaiting) return;
		this.toWorld();
		this.update.x = this.worldPoint.x;
		this.update.y = this.worldPoint.y;
		this.update.zoom = this.host.camera.zoom;
		this.update.targetId = targetId;
		this.update.targetPortId = targetPortId;
		this.update.routing = this.host.getRouting();
		this.preview.update(this.update);
		this.dirty = false;
	}
	complete(id, portId) {
		if (!this.sourceId || this.awaiting) return;
		if (this.host.isInputBlocked() || this.host.world.isEntityReadOnly(this.sourceId) || this.host.world.isEntityReadOnly(id)) {
			this.cancel();
			return;
		}
		this.refresh(id, portId);
		const snapshot = this.preview.getSnapshot();
		if (snapshot.status === "invalid-source") {
			this.cancel();
			return;
		}
		if (!snapshot.valid || !snapshot.targetPort) {
			this.host.requestRender();
			return;
		}
		const source = this.sourceId, sourcePort = this.sourcePortId;
		const targetPort = snapshot.targetPort.id;
		this.reset();
		this.host.onCommit(source, id, sourcePort, targetPort);
	}
	quickCreate() {
		if (!this.sourceId || this.awaiting) return;
		this.refresh();
		const snapshot = this.preview.getSnapshot();
		if (snapshot.status !== "free") {
			this.host.requestRender();
			return;
		}
		const controller = new AbortController(), revision = ++this.revision, source = this.sourceId, port = this.sourcePortId;
		const point = {
			x: snapshot.cursor.x,
			y: snapshot.cursor.y
		};
		this.awaiting = controller;
		this.releasePointer();
		this.host.selection.stateMachine.transition(`${CONNECT_STATE}.creating`);
		this.host.onQuickCreate(source, port, point, controller.signal).catch((error) => {
			if (!controller.signal.aborted && !this.disposed) this.host.onError(error instanceof Error ? error : new Error(String(error)));
		}).finally(() => {
			if (revision === this.revision && !this.disposed) this.cancel();
		});
		this.host.requestRender();
	}
	/** Called only by the owning session's compositor; no independent animation loop. */
	render() {
		if (this.disposed) return;
		const camera = this.host.camera;
		if (this.sourceId && !this.awaiting && (this.dirty || camera.x !== this.lastCameraX || camera.y !== this.lastCameraY || camera.zoom !== this.lastZoom)) this.refresh();
		if (this.preview.getSnapshot().status === "invalid-source") this.cancel();
		const dx = this.clientX - this.startX, dy = this.clientY - this.startY;
		this.painter.render(this.sourceId && !this.awaiting && dx * dx + dy * dy < DRAG_SLOP * DRAG_SLOP ? this.hidden : this.preview.getSnapshot(), camera);
		this.lastCameraX = camera.x;
		this.lastCameraY = camera.y;
		this.lastZoom = camera.zoom;
	}
	releasePointer() {
		const pointer = this.pointerId;
		this.pointerId = null;
		this.dragging = false;
		if (pointer !== null && this.host.surface.hasPointerCapture?.(pointer)) this.host.surface.releasePointerCapture(pointer);
	}
	reset() {
		this.revision++;
		this.awaiting?.abort();
		this.awaiting = void 0;
		this.releasePointer();
		this.sourceId = void 0;
		this.sourcePortId = void 0;
		this.dirty = false;
		this.preview.clear();
		this.host.requestRender();
	}
	cancel() {
		const active = this.active;
		this.reset();
		if (this.host.selection.stateMachine.stateId.startsWith(CONNECT_STATE)) this.host.selection.stateMachine.transition(this.host.getMode() === "connect" ? CONNECT_STATE : IDLE_STATE);
		if (active) this.host.onCancel?.();
		return active;
	}
	dispose() {
		if (this.disposed) return;
		this.cancel();
		this.disposed = true;
		this.abort.abort();
		for (const off of this.disposers.splice(0).reverse()) off();
		this.preview.dispose();
		this.painter.dispose();
	}
};
// src/connection-actions.ts
/** Port sides the wire may land on, chosen by where the user released relative to the source. */
function facingSide(bounds, point) {
	const dx = point.x - bounds.x - bounds.width / 2, dy = point.y - bounds.y - bounds.height / 2;
	return Math.abs(dx) >= Math.abs(dy) ? dx >= 0 ? "west" : "east" : dy >= 0 ? "north" : "south";
}
/** Endpoints get default ports only when they have none, so authored port settings are never overwritten. */
function ensurePorts(world, ids) {
	return ids.filter((id) => !world.getCanonical(id, "connector.ports")).map((id) => ({
		id,
		aspect: "connector.ports",
		patch: { enabled: true }
	}));
}
/**
* Validate both endpoints again at commit time and build the connector batch.
* Returns undefined when an explicit port disappeared since the gesture began.
*/
function connectOps(world, wire, from, to, routing, fromPort, toPort) {
	const sources = getEntityPorts(from, world), targets = getEntityPorts(to, world);
	if (from === to || !sources.length || !targets.length || fromPort && !sources.some((port) => port.id === fromPort) || toPort && !targets.some((port) => port.id === toPort)) return void 0;
	return [...ensurePorts(world, [from, to]), {
		id: wire,
		aspect: "connector.wire",
		patch: {
			from,
			to,
			routing,
			...fromPort ? { fromPort } : {},
			...toPort ? { toPort } : {}
		}
	}];
}
var QUICK_CARD_SIZE = {
	width: 300,
	height: 220
};
/**
* A new markdown card placed against the release point, facing the source,
* and a connector into it. Returns undefined if the source port vanished.
*/
function quickCreateOps(world, ids, from, fromPort, point, body, routing) {
	const ports = getEntityPorts(from, world), source = fromPort ? ports.find((port) => port.id === fromPort) : ports[0];
	const bounds = world.getComputed(from, "computed.layoutBounds");
	if (!source || !bounds) return void 0;
	const side = facingSide(bounds, point), { width, height } = QUICK_CARD_SIZE;
	const x = point.x - (side === "east" ? width : side === "west" ? 0 : width / 2);
	const y = point.y - (side === "south" ? height : side === "north" ? 0 : height / 2);
	return [
		...ensurePorts(world, [from]),
		{
			id: ids.card,
			aspect: "core.transform",
			patch: {
				x,
				y
			}
		},
		{
			id: ids.card,
			aspect: "core.bounds",
			patch: {
				width,
				height
			}
		},
		{
			id: ids.card,
			aspect: "markdown.card",
			patch: { body }
		},
		{
			id: ids.card,
			aspect: "connector.ports",
			patch: { enabled: true }
		},
		{
			id: ids.wire,
			aspect: "connector.wire",
			patch: {
				from,
				to: ids.card,
				...fromPort ? { fromPort } : {},
				toPort: side,
				routing
			}
		}
	];
}
// src/render-defs.ts
/** GPU arrowhead: tip at the end point, 9 world units long, at least 7 screen px. */
var wireGpuArrowhead = Object.freeze({
	polygon: Object.freeze([
		Object.freeze({
			x: 0,
			y: 0
		}),
		Object.freeze({
			x: -1,
			y: .48
		}),
		Object.freeze({
			x: -1,
			y: -.48
		})
	]),
	size: 9,
	minScreenSize: 7
});
// src/render-gpu.ts
var lines = /* @__PURE__ */ new WeakMap();
/** Generic GPU polyline contribution for a routed wire, including its own arrowhead. */
function getWireGpuPolyline(id, world) {
	if (!world.getExtension("connector.wire")) return void 0;
	const geometry = world.getCanonical(id, "connector.wire") ? world.getComputed(id, "computed.connector.wire") : void 0;
	if (!geometry) return void 0;
	let cache = lines.get(world);
	if (!cache) {
		cache = /* @__PURE__ */ new Map();
		lines.set(world, cache);
	}
	let line = cache.get(id);
	if (!line) {
		line = {
			points: geometry.points,
			endDecoration: wireGpuArrowhead
		};
		cache.set(id, line);
	}
	line.points = geometry.points;
	line.endTangent = geometry.endTangent;
	return line;
}
// src/plugin.ts
var plugin_default = {
	...createPackageManifest(extension_default),
	summary: extension_default.summary,
	aspects: [ConnectorPortsExtension, WireExtension],
	activate(context) {
		const offTools = context.services.provide("connector.tools", {
			getEntityPorts,
			createWiringTool: (host) => new WiringTool(host),
			connectOps,
			quickCreateOps
		});
		try {
			const offGpu = context.services.get("canvas.gpu-contributions")?.register({ getPolyline: getWireGpuPolyline });
			return () => {
				offGpu?.();
				offTools();
			};
		} catch (error) {
			offTools();
			throw error;
		}
	}
};
export { plugin_default as default };

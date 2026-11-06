var extension_default = {
	id: "vector.pen-suite",
	title: "펜과 벡터 경로",
	version: "0.1.0",
	summary: "자유 벡터 경로와 정점을 편집합니다.",
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
			services: [...m.provides.services],
			aspects: ["vector.path"],
			hsmSlots: [...m.provides.hsmSlots]
		}
	};
}
// src/types.ts
var defaultVectorPathProps = {
	contours: [],
	baseWidth: 1,
	baseHeight: 1,
	stroke: "#18181b",
	strokeWidth: 2,
	strokeDash: "solid",
	strokeCap: "round",
	strokeJoin: "round",
	fill: "none",
	fillOpacity: 1,
	fillRule: "evenodd",
	arrowStart: false,
	arrowEnd: false
};
// src/geometry.ts
var finite = (value, fallback = 0) => typeof value === "number" && Number.isFinite(value) ? value : fallback;
var coordinate = (value) => Math.max(-1e9, Math.min(1e9, finite(value)));
var cloneContours = (contours) => contours.map((contour) => ({
	closed: contour.closed,
	vertices: contour.vertices.map((point) => ({ ...point }))
}));
var color = (value, fallback) => typeof value === "string" && /^(?:#[0-9a-f]{3,8}|[a-z]+|(?:rgb|hsl)a?\([\d\s.,%+/-]+\))$/i.test(value) ? value : fallback;
function normalizeVectorPathProps(input) {
	const contours = [];
	const requestedWidth = finite(input.strokeWidth, 2);
	if (Array.isArray(input.contours)) for (const contour of input.contours) {
		if (!contour || !Array.isArray(contour.vertices)) continue;
		const vertices = [];
		for (const point of contour.vertices) {
			if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
			vertices.push({
				x: coordinate(point.x),
				y: coordinate(point.y),
				inX: coordinate(point.inX),
				inY: coordinate(point.inY),
				outX: coordinate(point.outX),
				outY: coordinate(point.outY),
				mirroring: point.mirroring === "angle" || point.mirroring === "angle-and-length" ? point.mirroring : "none",
				...point.cornerRadius ? { cornerRadius: Math.max(0, coordinate(point.cornerRadius)) } : {}
			});
		}
		if (vertices.length) contours.push({
			vertices,
			closed: !!contour.closed
		});
	}
	return {
		...defaultVectorPathProps,
		contours,
		baseWidth: Math.max(1, Math.min(1e9, finite(input.baseWidth, 1))),
		baseHeight: Math.max(1, Math.min(1e9, finite(input.baseHeight, 1))),
		stroke: color(input.stroke, defaultVectorPathProps.stroke),
		fill: color(input.fill, "none"),
		strokeWidth: requestedWidth > 0 ? Math.max(.01, Math.min(256, requestedWidth)) : 0,
		fillOpacity: Math.max(0, Math.min(1, finite(input.fillOpacity, 1))),
		strokeDash: input.strokeDash === "dashed" || input.strokeDash === "dotted" ? input.strokeDash : "solid",
		strokeCap: input.strokeCap === "butt" || input.strokeCap === "square" ? input.strokeCap : "round",
		strokeJoin: input.strokeJoin === "miter" || input.strokeJoin === "bevel" ? input.strokeJoin : "round",
		fillRule: input.fillRule === "nonzero" ? "nonzero" : "evenodd",
		arrowStart: !!input.arrowStart,
		arrowEnd: !!input.arrowEnd
	};
}
function createVectorFrame(props, transform, bounds) {
	const baseWidth = Math.max(1, Math.min(1e9, finite(props.baseWidth, 1))), baseHeight = Math.max(1, Math.min(1e9, finite(props.baseHeight, 1)));
	return {
		x: coordinate(transform?.x),
		y: coordinate(transform?.y),
		width: Math.max(1, Math.min(1e9, finite(bounds?.width, baseWidth))),
		height: Math.max(1, Math.min(1e9, finite(bounds?.height, baseHeight))),
		rotation: finite(transform?.rotation),
		baseWidth,
		baseHeight
	};
}
function pointToWorld(frame, x, y, out) {
	const dx = x * frame.width / frame.baseWidth - frame.width / 2, dy = y * frame.height / frame.baseHeight - frame.height / 2, cos = Math.cos(frame.rotation), sin = Math.sin(frame.rotation);
	out.x = frame.x + frame.width / 2 + dx * cos - dy * sin;
	out.y = frame.y + frame.height / 2 + dx * sin + dy * cos;
}
function pointToLocal(frame, x, y, out) {
	const dx = x - frame.x - frame.width / 2, dy = y - frame.y - frame.height / 2, cos = Math.cos(frame.rotation), sin = Math.sin(frame.rotation);
	out.x = (dx * cos + dy * sin + frame.width / 2) * frame.baseWidth / frame.width;
	out.y = (-dx * sin + dy * cos + frame.height / 2) * frame.baseHeight / frame.height;
}
function cubicAt(a, b, t, out) {
	const s = 1 - t, p = s * s * s, q = 3 * s * s * t, r = 3 * s * t * t, u = t * t * t;
	out.x = p * a.x + q * (a.x + a.outX) + r * (b.x + b.inX) + u * b.x;
	out.y = p * a.y + q * (a.y + a.outY) + r * (b.y + b.inY) + u * b.y;
}
function splitSegment(contour, index, parameter) {
	const length = contour.vertices.length;
	if (!Number.isInteger(index) || index < 0 || index >= length - (contour.closed ? 0 : 1) || length < 2) return contour;
	const t = Math.max(1e-6, Math.min(1 - 1e-6, finite(parameter, .5))), next = (index + 1) % length, a = contour.vertices[index], b = contour.vertices[next], s = 1 - t;
	const ax = a.x + a.outX, ay = a.y + a.outY, bx = b.x + b.inX, by = b.y + b.inY;
	const p1x = s * a.x + t * ax, p1y = s * a.y + t * ay, p2x = s * ax + t * bx, p2y = s * ay + t * by, p3x = s * bx + t * b.x, p3y = s * by + t * b.y;
	const q1x = s * p1x + t * p2x, q1y = s * p1y + t * p2y, q2x = s * p2x + t * p3x, q2y = s * p2y + t * p3y, x = s * q1x + t * q2x, y = s * q1y + t * q2y;
	const vertices = contour.vertices.slice();
	vertices[index] = {
		...a,
		outX: p1x - a.x,
		outY: p1y - a.y,
		mirroring: "none"
	};
	vertices[next] = {
		...b,
		inX: p3x - b.x,
		inY: p3y - b.y,
		mirroring: "none"
	};
	vertices.splice(index + 1, 0, {
		x,
		y,
		inX: q1x - x,
		inY: q1y - y,
		outX: q2x - x,
		outY: q2y - y,
		mirroring: "angle"
	});
	return {
		closed: contour.closed,
		vertices
	};
}
/** Least-squares control displacement: the picked cubic point follows delta exactly. */
function bendSegment(contour, index, t, dx, dy) {
	const count = contour.vertices.length;
	if (!Number.isInteger(index) || index < 0 || index >= count - (contour.closed ? 0 : 1) || count < 2 || !Number.isFinite(dx) || !Number.isFinite(dy)) return contour;
	t = Math.max(.02, Math.min(.98, finite(t, .5)));
	const s = 1 - t, aWeight = 3 * s * s * t, bWeight = 3 * s * t * t, denom = aWeight * aWeight + bWeight * bWeight;
	const vertices = contour.vertices.slice(), next = (index + 1) % count, a = vertices[index], b = vertices[next];
	vertices[index] = {
		...a,
		outX: a.outX + dx * aWeight / denom,
		outY: a.outY + dy * aWeight / denom,
		mirroring: "none",
		cornerRadius: 0
	};
	vertices[next] = {
		...b,
		inX: b.inX + dx * bWeight / denom,
		inY: b.inY + dy * bWeight / denom,
		mirroring: "none",
		cornerRadius: 0
	};
	return {
		closed: contour.closed,
		vertices
	};
}
function setVertexHandle(point, side, dx, dy, mirroring = point.mirroring) {
	let inX = point.inX, inY = point.inY, outX = point.outX, outY = point.outY;
	if (side === "in") {
		inX = dx;
		inY = dy;
	} else {
		outX = dx;
		outY = dy;
	}
	if (mirroring !== "none") {
		const length = Math.hypot(dx, dy), opposite = mirroring === "angle-and-length" ? length : side === "in" ? Math.hypot(point.outX, point.outY) : Math.hypot(point.inX, point.inY);
		const x = length ? -dx * opposite / length : 0, y = length ? -dy * opposite / length : 0;
		if (side === "in") {
			outX = x;
			outY = y;
		} else {
			inX = x;
			inY = y;
		}
	}
	return {
		...point,
		inX: inX || 0,
		inY: inY || 0,
		outX: outX || 0,
		outY: outY || 0,
		mirroring,
		cornerRadius: 0
	};
}
function toggleVertex(contour, index) {
	const p = contour.vertices[index];
	if (!p) return contour;
	const vertices = contour.vertices.slice();
	if (p.inX || p.inY || p.outX || p.outY) vertices[index] = {
		...p,
		inX: 0,
		inY: 0,
		outX: 0,
		outY: 0,
		mirroring: "none"
	};
	else {
		const count = vertices.length, prev = vertices[index > 0 ? index - 1 : contour.closed ? count - 1 : index], next = vertices[index + 1 < count ? index + 1 : contour.closed ? 0 : index];
		const dx = next.x - prev.x, dy = next.y - prev.y, distance = Math.hypot(dx, dy), before = Math.hypot(p.x - prev.x, p.y - prev.y), after = Math.hypot(next.x - p.x, next.y - p.y), size = (before && after ? Math.min(before, after) : Math.max(before, after)) / 3;
		const x = distance ? dx * size / distance : 0, y = distance ? dy * size / distance : 0;
		vertices[index] = {
			...p,
			inX: -x,
			inY: -y,
			outX: x,
			outY: y,
			mirroring: "angle-and-length",
			cornerRadius: 0
		};
	}
	return {
		closed: contour.closed,
		vertices
	};
}
var lerp = (a, b, t) => ({
	x: a.x + (b.x - a.x) * t,
	y: a.y + (b.y - a.y) * t
});
var point = (x, y) => ({
	x,
	y
});
/** Fillets exist only in derived geometry; editable anchors retain the authored corner. */
function contourSegments(contour) {
	const vertices = contour.vertices, count = vertices.length;
	if (count < 2) return [];
	const corners = vertices.map((v, index) => {
		const prev = vertices[(index + count - 1) % count], next = vertices[(index + 1) % count];
		if (!v.cornerRadius || !contour.closed && (index === 0 || index === count - 1) || v.inX || v.inY || v.outX || v.outY || prev.outX || prev.outY || next.inX || next.inY) return void 0;
		const before = Math.hypot(v.x - prev.x, v.y - prev.y), after = Math.hypot(next.x - v.x, next.y - v.y);
		if (before < 1e-9 || after < 1e-9) return void 0;
		const ix = (v.x - prev.x) / before, iy = (v.y - prev.y) / before, ox = (next.x - v.x) / after, oy = (next.y - v.y) / after, angle = Math.acos(Math.max(-1, Math.min(1, ix * ox + iy * oy)));
		if (angle < 1e-6 || Math.PI - angle < 1e-6) return void 0;
		const tangent = Math.tan(angle / 2), distance = Math.min(v.cornerRadius * tangent, before / 2, after / 2), radius = distance / tangent, handle = 4 / 3 * Math.tan(angle / 4) * radius;
		const entry = point(v.x - ix * distance, v.y - iy * distance), exit = point(v.x + ox * distance, v.y + oy * distance);
		return {
			p0: entry,
			c1: point(entry.x + ix * handle, entry.y + iy * handle),
			c2: point(exit.x - ox * handle, exit.y - oy * handle),
			p3: exit,
			line: false
		};
	});
	const segments = [];
	for (let index = 0; index < count - (contour.closed ? 0 : 1); index++) {
		const next = (index + 1) % count, a = vertices[index], b = vertices[next], cornerA = corners[index], cornerB = corners[next], p0 = cornerA?.p3 ?? point(a.x, a.y), p3 = cornerB?.p0 ?? point(b.x, b.y);
		segments.push({
			p0,
			c1: cornerA ? p0 : point(a.x + a.outX, a.y + a.outY),
			c2: cornerB ? p3 : point(b.x + b.inX, b.y + b.inY),
			p3,
			line: !a.outX && !a.outY && !b.inX && !b.inY
		});
		if (cornerB) segments.push(cornerB);
	}
	return segments;
}
function segmentAt(segment, t, out) {
	const s = 1 - t, a = s * s * s, b = 3 * s * s * t, c = 3 * s * t * t, d = t * t * t;
	out.x = a * segment.p0.x + b * segment.c1.x + c * segment.c2.x + d * segment.p3.x;
	out.y = a * segment.p0.y + b * segment.c1.y + c * segment.c2.y + d * segment.p3.y;
}
function transformSegment(segment, frame) {
	const result = {
		p0: point(0, 0),
		c1: point(0, 0),
		c2: point(0, 0),
		p3: point(0, 0),
		line: segment.line
	};
	for (const key of [
		"p0",
		"c1",
		"c2",
		"p3"
	]) pointToWorld(frame, segment[key].x, segment[key].y, result[key]);
	return result;
}
function sampleSegment(segment, out, tolerance = .125, depth = 0) {
	const { p0, c1, c2, p3 } = segment, dx = p3.x - p0.x, dy = p3.y - p0.y, length = Math.hypot(dx, dy);
	const flat = length ? Math.max(Math.abs(dy * (c1.x - p0.x) - dx * (c1.y - p0.y)), Math.abs(dy * (c2.x - p0.x) - dx * (c2.y - p0.y))) / length : Math.max(Math.hypot(c1.x - p0.x, c1.y - p0.y), Math.hypot(c2.x - p0.x, c2.y - p0.y));
	const excess = Math.hypot(c1.x - p0.x, c1.y - p0.y) + Math.hypot(c2.x - c1.x, c2.y - c1.y) + Math.hypot(p3.x - c2.x, p3.y - c2.y) - length;
	if (segment.line || depth >= 14 || flat <= tolerance && excess <= tolerance) {
		out.push({ ...p3 });
		return;
	}
	const a = lerp(p0, c1, .5), b = lerp(c1, c2, .5), c = lerp(c2, p3, .5), d = lerp(a, b, .5), e = lerp(b, c, .5), m = lerp(d, e, .5);
	sampleSegment({
		p0,
		c1: a,
		c2: d,
		p3: m,
		line: false
	}, out, tolerance, depth + 1);
	sampleSegment({
		p0: m,
		c1: e,
		c2: c,
		p3,
		line: false
	}, out, tolerance, depth + 1);
}
function includeSegmentBounds(segment, out) {
	const p = point(0, 0), include = (t) => {
		segmentAt(segment, t, p);
		out.minX = Math.min(out.minX, p.x);
		out.minY = Math.min(out.minY, p.y);
		out.maxX = Math.max(out.maxX, p.x);
		out.maxY = Math.max(out.maxY, p.y);
	};
	include(0);
	include(1);
	for (const axis of ["x", "y"]) {
		const p0 = segment.p0[axis], p1 = segment.c1[axis], p2 = segment.c2[axis], p3 = segment.p3[axis], a = -p0 + 3 * p1 - 3 * p2 + p3, b = 2 * (p0 - 2 * p1 + p2), c = p1 - p0;
		if (Math.abs(a) < 1e-12) {
			if (Math.abs(b) > 1e-12) {
				const t = -c / b;
				if (t > 0 && t < 1) include(t);
			}
			continue;
		}
		const discriminant = b * b - 4 * a * c;
		if (discriminant < 0) continue;
		const root = Math.sqrt(discriminant), t1 = (-b + root) / (2 * a), t2 = (-b - root) / (2 * a);
		if (t1 > 0 && t1 < 1) include(t1);
		if (t2 > 0 && t2 < 1) include(t2);
	}
}
function contourBounds(contours) {
	const bounds = {
		minX: Infinity,
		minY: Infinity,
		maxX: -Infinity,
		maxY: -Infinity
	};
	for (const contour of contours) {
		const segments = contourSegments(contour);
		if (!segments.length && contour.vertices.length) {
			const p = contour.vertices[0];
			bounds.minX = Math.min(bounds.minX, p.x);
			bounds.minY = Math.min(bounds.minY, p.y);
			bounds.maxX = Math.max(bounds.maxX, p.x);
			bounds.maxY = Math.max(bounds.maxY, p.y);
		}
		for (const segment of segments) includeSegmentBounds(segment, bounds);
	}
	return Number.isFinite(bounds.minX) ? bounds : {
		minX: 0,
		minY: 0,
		maxX: 0,
		maxY: 0
	};
}
var numberText = (value) => String(Math.round(value * 1e8) / 1e8);
function segmentPath(segment) {
	const { c1, c2, p3 } = segment;
	return segment.line ? `L${numberText(p3.x)},${numberText(p3.y)}` : `C${numberText(c1.x)},${numberText(c1.y)} ${numberText(c2.x)},${numberText(c2.y)} ${numberText(p3.x)},${numberText(p3.y)}`;
}
// src/derive.ts
var tangent = (a, b, c, d) => {
	let x = b.x - a.x, y = b.y - a.y;
	if (Math.hypot(x, y) < 1e-9) {
		x = c.x - a.x;
		y = c.y - a.y;
	}
	if (Math.hypot(x, y) < 1e-9) {
		x = d.x - a.x;
		y = d.y - a.y;
	}
	return {
		x,
		y
	};
};
function deriveVectorPath(input, id, view) {
	const props = normalizeVectorPathProps(input), frame = createVectorFrame(props, view.getCanonical(id, "core.transform"), view.getCanonical(id, "core.bounds"));
	const sampledContours = [], arrows = [], ink = {
		minX: Infinity,
		minY: Infinity,
		maxX: -Infinity,
		maxY: -Infinity
	};
	let worldPathD = "", localPathD = "", fillPathD = "";
	for (const contour of props.contours) {
		const local = contourSegments(contour);
		if (!local.length) continue;
		const segments = local.map((segment) => transformSegment(segment, frame)), first = segments[0], last = segments[segments.length - 1], points = [{ ...first.p0 }];
		const worldStart = worldPathD.length;
		localPathD += `M${numberText(local[0].p0.x)},${numberText(local[0].p0.y)}`;
		worldPathD += `M${numberText(first.p0.x)},${numberText(first.p0.y)}`;
		for (let index = 0; index < segments.length; index++) {
			const segment = segments[index];
			worldPathD += segmentPath(segment);
			localPathD += segmentPath(local[index]);
			sampleSegment(segment, points);
			includeSegmentBounds(segment, ink);
		}
		if (contour.closed) {
			worldPathD += "Z";
			localPathD += "Z";
			fillPathD += worldPathD.slice(worldStart);
		}
		const startTangent = tangent(first.p0, first.c1, first.c2, first.p3), reverse = tangent(last.p3, last.c2, last.c1, last.p0), endTangent = {
			x: -reverse.x,
			y: -reverse.y
		};
		sampledContours.push({
			closed: contour.closed,
			points,
			startTangent,
			endTangent
		});
		if (!contour.closed && props.stroke !== "none" && props.stroke !== "transparent" && props.strokeWidth > 0) {
			const addArrow = (tip, direction) => {
				const norm = Math.hypot(direction.x, direction.y);
				if (norm < 1e-9) return;
				const ux = direction.x / norm, uy = direction.y / norm, size = Math.max(7, props.strokeWidth * 3.5), half = Math.max(3.5, props.strokeWidth * 1.75), bx = tip.x - ux * size, by = tip.y - uy * size;
				const triangle = [
					{
						x: bx + uy * half,
						y: by - ux * half
					},
					{ ...tip },
					{
						x: bx - uy * half,
						y: by + ux * half
					}
				];
				arrows.push({ points: triangle });
				for (const point of triangle) {
					ink.minX = Math.min(ink.minX, point.x);
					ink.minY = Math.min(ink.minY, point.y);
					ink.maxX = Math.max(ink.maxX, point.x);
					ink.maxY = Math.max(ink.maxY, point.y);
				}
			};
			if (props.arrowStart) addArrow(first.p0, {
				x: -startTangent.x,
				y: -startTangent.y
			});
			if (props.arrowEnd) addArrow(last.p3, endTangent);
		}
	}
	const stroke = props.stroke !== "none" ? props.strokeWidth * (props.strokeJoin === "miter" ? 2 : .5) : 0;
	const inkBounds = Number.isFinite(ink.minX) ? {
		x: ink.minX - stroke,
		y: ink.minY - stroke,
		width: ink.maxX - ink.minX + stroke * 2,
		height: ink.maxY - ink.minY + stroke * 2
	} : {
		x: frame.x,
		y: frame.y,
		width: frame.width,
		height: frame.height
	};
	return {
		...frame,
		style: props,
		worldPathD,
		localPathD,
		fillPathD,
		sampledContours,
		arrows,
		inkBounds
	};
}
// src/render-svg.ts
function renderVectorPathSvg(input, geometry) {
	const props = geometry?.style ?? normalizeVectorPathProps(input);
	if (!geometry?.worldPathD) return { svg: "" };
	const width = props.strokeWidth, dash = props.strokeDash === "dashed" ? ` stroke-dasharray="${width * 4} ${width * 3}"` : props.strokeDash === "dotted" ? ` stroke-dasharray="${Math.max(.01, width * .05)} ${width * 2.5}"` : "";
	const cap = props.strokeDash === "dotted" ? "round" : props.strokeCap;
	const arrows = geometry.arrows.map((arrow) => `<path d="${arrow.points.map((point, index) => `${index ? "L" : "M"}${numberText(point.x)},${numberText(point.y)}`).join("")}Z" fill="${props.stroke}"/>`).join("");
	return { svg: `<g>${props.fill !== "none" && geometry.fillPathD ? `<path d="${geometry.fillPathD}" fill="${props.fill}" fill-opacity="${props.fillOpacity}" fill-rule="${props.fillRule}"/>` : ""}<path d="${geometry.worldPathD}" fill="none" stroke="${props.stroke}" stroke-width="${width}" stroke-linecap="${cap}" stroke-linejoin="${props.strokeJoin}" stroke-miterlimit="4"${dash}/>${arrows}</g>` };
}
// src/selection.ts
function pointInContours(x, y, contours, fillRule) {
	let winding = 0, crossings = 0;
	for (let ci = 0; ci < contours.length; ci++) {
		const contour = contours[ci], points = contour.points;
		if (!contour.closed || points.length < 3) continue;
		for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
			const a = points[j], b = points[i];
			if (a.y > y !== b.y > y && x < a.x + (y - a.y) * (b.x - a.x) / (b.y - a.y)) crossings++;
			const cross = (b.x - a.x) * (y - a.y) - (x - a.x) * (b.y - a.y);
			if (a.y <= y) {
				if (b.y > y && cross > 0) winding++;
			} else if (b.y <= y && cross < 0) winding--;
		}
	}
	return fillRule === "evenodd" ? (crossings & 1) === 1 : winding !== 0;
}
var segmentDistance = (x, y, a, b) => {
	const dx = b.x - a.x, dy = b.y - a.y, d = dx * dx + dy * dy, t = d ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / d)) : 0;
	return Math.hypot(x - a.x - dx * t, y - a.y - dy * t);
};
var numericSegmentDistance = (x, y, ax, ay, bx, by) => {
	const dx = bx - ax, dy = by - ay, length2 = dx * dx + dy * dy, t = length2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / length2)) : 0;
	return Math.hypot(x - ax - dx * t, y - ay - dy * t);
};
function triangleDistance(x, y, ax, ay, bx, by, cx, cy) {
	const a = (bx - ax) * (y - ay) - (by - ay) * (x - ax), b = (cx - bx) * (y - by) - (cy - by) * (x - bx), c = (ax - cx) * (y - cy) - (ay - cy) * (x - cx);
	if (a >= 0 && b >= 0 && c >= 0 || a <= 0 && b <= 0 && c <= 0) return 0;
	return Math.min(numericSegmentDistance(x, y, ax, ay, bx, by), numericSegmentDistance(x, y, bx, by, cx, cy), numericSegmentDistance(x, y, cx, cy, ax, ay));
}
/** Distance to visible stroke ink, including the authored end caps. All temporaries are numeric. */
function stripDistance(x, y, ax, ay, bx, by, half, start, end, cap) {
	const dx = bx - ax, dy = by - ay, length = Math.hypot(dx, dy);
	if (length < 1e-12) return cap === "round" && (start || end) ? Math.max(0, Math.hypot(x - ax, y - ay) - half) : Infinity;
	const along = ((x - ax) * dx + (y - ay) * dy) / length, normal = Math.abs((x - ax) * dy - (y - ay) * dx) / length;
	const lo = start && cap === "square" ? -half : 0, hi = end && cap === "square" ? length + half : length;
	let distance = Math.hypot(Math.max(lo - along, along - hi, 0), Math.max(normal - half, 0));
	if (cap === "round") {
		if (start) distance = Math.min(distance, Math.max(0, Math.hypot(x - ax, y - ay) - half));
		if (end) distance = Math.min(distance, Math.max(0, Math.hypot(x - bx, y - by) - half));
	}
	return distance;
}
function joinDistance(x, y, prev, p, next, half, join) {
	const a = Math.hypot(p.x - prev.x, p.y - prev.y), b = Math.hypot(next.x - p.x, next.y - p.y);
	if (a < 1e-12 || b < 1e-12) return Infinity;
	const ux = (p.x - prev.x) / a, uy = (p.y - prev.y) / a, vx = (next.x - p.x) / b, vy = (next.y - p.y) / b, cross = ux * vy - uy * vx;
	if (join === "round") return Math.max(0, Math.hypot(x - p.x, y - p.y) - half);
	if (Math.abs(cross) < 1e-12) return Infinity;
	const side = cross > 0 ? 1 : -1, ax = p.x + uy * half * side, ay = p.y - ux * half * side, bx = p.x + vy * half * side, by = p.y - vx * half * side;
	let distance = triangleDistance(x, y, p.x, p.y, ax, ay, bx, by);
	if (join === "miter") {
		const t = ((bx - ax) * vy - (by - ay) * vx) / cross, mx = ax + ux * t, my = ay + uy * t;
		if (Math.hypot(mx - p.x, my - p.y) <= half * 4) distance = Math.min(distance, triangleDistance(x, y, ax, ay, mx, my, bx, by));
	}
	return distance;
}
function distanceToStroke(contours, props, x, y) {
	const half = props.strokeWidth / 2, solid = props.strokeDash === "solid", dash = props.strokeDash === "dotted" ? Math.max(.01, props.strokeWidth * .05) : props.strokeWidth * 4, period = dash + props.strokeWidth * (props.strokeDash === "dotted" ? 2.5 : 3), cap = props.strokeDash === "dotted" ? "round" : props.strokeCap;
	let distance = Infinity;
	for (let ci = 0; ci < contours.length; ci++) {
		const contour = contours[ci], points = contour.points;
		let offset = 0;
		for (let i = 1; i < points.length; i++) {
			const a = points[i - 1], b = points[i], dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
			if (solid) distance = Math.min(distance, stripDistance(x, y, a.x, a.y, b.x, b.y, half, !contour.closed && i === 1, !contour.closed && i === points.length - 1, cap));
			else if (length > 1e-12) {
				const projected = Math.max(0, Math.min(length, ((x - a.x) * dx + (y - a.y) * dy) / length)), cycle = Math.floor((offset + projected) / period);
				for (let neighbor = -1; neighbor <= 1; neighbor++) {
					const start = Math.max(0, cycle + neighbor) * period, end = start + dash, lo = Math.max(offset, start), hi = Math.min(offset + length, end);
					if (hi < lo) continue;
					const t0 = (lo - offset) / length, t1 = (hi - offset) / length;
					distance = Math.min(distance, stripDistance(x, y, a.x + dx * t0, a.y + dy * t0, a.x + dx * t1, a.y + dy * t1, half, lo === start || i === 1, hi === end || i === points.length - 1, cap));
				}
			}
			offset += length;
			if (i < points.length - 1) {
				const phase = offset % period;
				if (solid || phase > 1e-9 && phase < dash - 1e-9) distance = Math.min(distance, joinDistance(x, y, a, b, points[i + 1], half, props.strokeJoin));
			}
		}
		if (contour.closed && points.length > 2 && (solid || offset % period > 1e-9 && offset % period < dash - 1e-9)) distance = Math.min(distance, joinDistance(x, y, points[points.length - 2], points[0], points[1], half, props.strokeJoin));
	}
	return distance;
}
function insideTriangle(x, y, points) {
	const a = points[0], b = points[1], c = points[2], one = (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x), two = (c.x - b.x) * (y - b.y) - (c.y - b.y) * (x - b.x), three = (a.x - c.x) * (y - c.y) - (a.y - c.y) * (x - c.x);
	return one >= 0 && two >= 0 && three >= 0 || one <= 0 && two <= 0 && three <= 0;
}
function segmentIntersectsRect(a, b, minX, minY, maxX, maxY) {
	let enter = 0, exit = 1;
	const dx = b.x - a.x, dy = b.y - a.y;
	if (dx === 0) {
		if (a.x < minX || a.x > maxX) return false;
	} else {
		const one = (minX - a.x) / dx, two = (maxX - a.x) / dx;
		enter = Math.max(enter, Math.min(one, two));
		exit = Math.min(exit, Math.max(one, two));
	}
	if (dy === 0) {
		if (a.y < minY || a.y > maxY) return false;
	} else {
		const one = (minY - a.y) / dy, two = (maxY - a.y) / dy;
		enter = Math.max(enter, Math.min(one, two));
		exit = Math.min(exit, Math.max(one, two));
	}
	return enter <= exit;
}
function strokeIntersectsRect(contours, props, minX, minY, maxX, maxY) {
	if (distanceToStroke(contours, props, minX, minY) === 0 || distanceToStroke(contours, props, maxX, minY) === 0 || distanceToStroke(contours, props, minX, maxY) === 0 || distanceToStroke(contours, props, maxX, maxY) === 0) return true;
	const half = props.strokeWidth / 2, dash = props.strokeDash === "dotted" ? Math.max(.01, props.strokeWidth * .05) : props.strokeWidth * 4, period = dash + props.strokeWidth * (props.strokeDash === "dotted" ? 2.5 : 3);
	minX -= half;
	minY -= half;
	maxX += half;
	maxY += half;
	for (let ci = 0; ci < contours.length; ci++) {
		const points = contours[ci].points;
		let offset = 0;
		for (let i = 1; i < points.length; i++) {
			const a = points[i - 1], b = points[i], dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
			let enter = 0, exit = 1;
			if (dx === 0) {
				if (a.x < minX || a.x > maxX) {
					offset += length;
					continue;
				}
			} else {
				const one = (minX - a.x) / dx, two = (maxX - a.x) / dx;
				enter = Math.max(enter, Math.min(one, two));
				exit = Math.min(exit, Math.max(one, two));
			}
			if (dy === 0) {
				if (a.y < minY || a.y > maxY) {
					offset += length;
					continue;
				}
			} else {
				const one = (minY - a.y) / dy, two = (maxY - a.y) / dy;
				enter = Math.max(enter, Math.min(one, two));
				exit = Math.min(exit, Math.max(one, two));
			}
			if (enter <= exit) {
				if (props.strokeDash === "solid") return true;
				const start = offset + length * enter, end = offset + length * exit;
				if (start % period <= dash || Math.floor(end / period) > Math.floor(start / period)) return true;
			}
			offset += length;
		}
	}
	return false;
}
var read = (id, view) => view.isAlive(id) && view.getCanonical(id, "vector.path") ? view.getComputed(id, "computed.vector.path") : void 0;
var visible = (paint) => paint !== "none" && paint !== "transparent";
function createVectorSelectionContribution(isEditingEntity = () => false) {
	const projected = {
		x: 0,
		y: 0
	};
	return {
		priority: 20,
		getBounds(id, view, out) {
			const geometry = read(id, view);
			if (!geometry || !geometry.sampledContours.length) return false;
			out.x = geometry.x;
			out.y = geometry.y;
			out.width = geometry.width;
			out.height = geometry.height;
			out.rotation = geometry.rotation;
			return true;
		},
		hitTest(id, view, x, y, zoom) {
			const geometry = read(id, view);
			if (!geometry || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(zoom) || zoom <= 0) return Infinity;
			const props = geometry.style, tolerance = 8 / zoom;
			if (visible(props.fill) && props.fillOpacity > 0 && pointInContours(x, y, geometry.sampledContours, props.fillRule)) return 0;
			let distance = Infinity;
			if (visible(props.stroke) && props.strokeWidth > 0) distance = distanceToStroke(geometry.sampledContours, props, x, y);
			for (let ai = 0; ai < geometry.arrows.length; ai++) {
				const points = geometry.arrows[ai].points;
				if (insideTriangle(x, y, points)) return 0;
				for (let i = 0; i < 3; i++) distance = Math.min(distance, segmentDistance(x, y, points[i], points[(i + 1) % 3]));
			}
			return distance <= tolerance ? distance : Infinity;
		},
		intersectsRect(id, view, minX, minY, maxX, maxY) {
			const geometry = read(id, view);
			if (!geometry || !Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY) || minX > maxX || minY > maxY) return false;
			const props = geometry.style;
			if (visible(props.stroke) && props.strokeWidth > 0 && strokeIntersectsRect(geometry.sampledContours, props, minX, minY, maxX, maxY)) return true;
			if (visible(props.fill) && props.fillOpacity > 0) {
				if (pointInContours(minX, minY, geometry.sampledContours, props.fillRule) || pointInContours(maxX, minY, geometry.sampledContours, props.fillRule) || pointInContours(minX, maxY, geometry.sampledContours, props.fillRule) || pointInContours(maxX, maxY, geometry.sampledContours, props.fillRule) || pointInContours((minX + maxX) / 2, (minY + maxY) / 2, geometry.sampledContours, props.fillRule)) return true;
				for (let ci = 0; ci < geometry.sampledContours.length; ci++) {
					const contour = geometry.sampledContours[ci];
					if (!contour.closed) continue;
					const points = contour.points;
					for (let i = 1; i < points.length; i++) if (segmentIntersectsRect(points[i - 1], points[i], minX, minY, maxX, maxY)) return true;
				}
			}
			for (let ai = 0; ai < geometry.arrows.length; ai++) {
				const points = geometry.arrows[ai].points;
				if (insideTriangle((minX + maxX) / 2, (minY + maxY) / 2, points)) return true;
				for (let i = 0; i < 3; i++) if (segmentIntersectsRect(points[i], points[(i + 1) % 3], minX, minY, maxX, maxY)) return true;
			}
			return false;
		},
		getOutlinePath(id, view, projection) {
			const geometry = read(id, view);
			if (!geometry) return "";
			let path = "";
			for (let ci = 0; ci < geometry.sampledContours.length; ci++) {
				const contour = geometry.sampledContours[ci];
				for (let i = 0; i < contour.points.length; i++) {
					const p = contour.points[i];
					projection.worldToScreen(p.x, p.y, projected);
					path += `${i ? "L" : "M"}${projected.x},${projected.y}`;
				}
				if (contour.closed) path += "Z";
			}
			for (let ai = 0; ai < geometry.arrows.length; ai++) {
				const points = geometry.arrows[ai].points;
				for (let i = 0; i < points.length; i++) {
					projection.worldToScreen(points[i].x, points[i].y, projected);
					path += `${i ? "L" : "M"}${projected.x},${projected.y}`;
				}
				path += "Z";
			}
			return path;
		},
		canTransform: (id) => !isEditingEntity(id)
	};
}
// src/extension.ts
function createVectorPathAspect(isEditingEntity = () => false) {
	return {
		id: "vector.path",
		label: "벡터 경로",
		summary: "정점과 베지어 핸들로 만드는 자유 벡터 경로",
		defaults: defaultVectorPathProps,
		layout: true,
		dependsOnCanonical: [
			"vector.path",
			"core.transform",
			"core.bounds"
		],
		dependsOnComputed: [],
		derive: deriveVectorPath,
		renderSvg: renderVectorPathSvg,
		selection: createVectorSelectionContribution(isEditingEntity),
		ui: { controls: [
			{
				id: "vector.edit",
				kind: "action",
				label: "경로 편집",
				icon: "nodes",
				mnemonic: "e",
				commandSymbol: "vector:enter-edit",
				placement: "selection-bar",
				requiresSelection: true
			},
			{
				id: "vector.stroke.selection",
				kind: "color",
				field: "stroke",
				label: "선 색상",
				placement: "selection-bar"
			},
			{
				id: "vector.width.selection",
				kind: "slider",
				field: "strokeWidth",
				label: "선 두께",
				min: 1,
				max: 24,
				step: 1,
				placement: "selection-bar"
			},
			{
				id: "vector.stroke",
				kind: "color",
				field: "stroke",
				label: "선 색상",
				placement: "inspector"
			},
			{
				id: "vector.width",
				kind: "slider",
				field: "strokeWidth",
				label: "선 두께",
				min: 0,
				max: 24,
				step: 1,
				placement: "inspector"
			},
			{
				id: "vector.dash",
				kind: "segmented",
				field: "strokeDash",
				label: "선 스타일",
				placement: "inspector",
				options: [
					{
						label: "실선",
						value: "solid"
					},
					{
						label: "파선",
						value: "dashed"
					},
					{
						label: "점선",
						value: "dotted"
					}
				]
			},
			{
				id: "vector.cap",
				kind: "segmented",
				field: "strokeCap",
				label: "끝 모양",
				placement: "inspector",
				options: [
					{
						label: "둥글게",
						value: "round"
					},
					{
						label: "평평하게",
						value: "butt"
					},
					{
						label: "사각형",
						value: "square"
					}
				]
			},
			{
				id: "vector.join",
				kind: "segmented",
				field: "strokeJoin",
				label: "이음 모양",
				placement: "inspector",
				options: [
					{
						label: "둥글게",
						value: "round"
					},
					{
						label: "뾰족하게",
						value: "miter"
					},
					{
						label: "잘라내기",
						value: "bevel"
					}
				]
			},
			{
				id: "vector.fill",
				kind: "color",
				field: "fill",
				label: "채우기 색상",
				placement: "inspector"
			},
			{
				id: "vector.fill-toggle",
				kind: "action",
				label: "채우기 켜기 / 끄기",
				commandSymbol: "vector:toggle-fill",
				requiresSelection: true,
				placement: "inspector"
			},
			{
				id: "vector.opacity",
				kind: "slider",
				field: "fillOpacity",
				label: "채우기 불투명도",
				min: 0,
				max: 1,
				step: .05,
				placement: "inspector"
			},
			{
				id: "vector.rule",
				kind: "segmented",
				field: "fillRule",
				label: "채우기 규칙",
				placement: "inspector",
				options: [{
					label: "홀짝",
					value: "evenodd"
				}, {
					label: "감김",
					value: "nonzero"
				}]
			},
			{
				id: "vector.arrow-start",
				kind: "toggle",
				field: "arrowStart",
				label: "시작 화살표",
				placement: "inspector"
			},
			{
				id: "vector.arrow-end",
				kind: "toggle",
				field: "arrowEnd",
				label: "끝 화살표",
				placement: "inspector"
			}
		] }
	};
}
createVectorPathAspect();
// src/rebound.ts
/** Normalize local origin without moving any world anchor or control point.
* Preserve the existing axis scales, including nonuniform resizes and fillets.
* Padding of degenerate dimensions participates in the center compensation.
*/
function reboundRotatedVector(contours, prevTransform, prevBounds, localMin, localMax, baseSize) {
	const bounds = contourBounds(contours), min = localMin ?? {
		x: bounds.minX,
		y: bounds.minY
	}, max = localMax ?? {
		x: bounds.maxX,
		y: bounds.maxY
	};
	const frame = createVectorFrame(baseSize ?? {
		baseWidth: prevBounds.width,
		baseHeight: prevBounds.height
	}, prevTransform, prevBounds), sx = frame.width / frame.baseWidth, sy = frame.height / frame.baseHeight;
	const baseWidth = Math.max(1, max.x - min.x, 1 / sx), baseHeight = Math.max(1, max.y - min.y, 1 / sy), width = baseWidth * sx, height = baseHeight * sy;
	const dx = (min.x + baseWidth / 2) * sx - frame.width / 2, dy = (min.y + baseHeight / 2) * sy - frame.height / 2, cos = Math.cos(frame.rotation), sin = Math.sin(frame.rotation);
	return {
		nextTransform: {
			x: frame.x + frame.width / 2 + dx * cos - dy * sin - width / 2,
			y: frame.y + frame.height / 2 + dx * sin + dy * cos - height / 2,
			rotation: frame.rotation
		},
		nextBounds: {
			width,
			height
		},
		nextBaseSize: {
			baseWidth,
			baseHeight
		},
		nextContours: contours.map((contour) => ({
			closed: contour.closed,
			vertices: contour.vertices.map((v) => ({
				...v,
				x: v.x - min.x,
				y: v.y - min.y
			}))
		}))
	};
}
// src/pen-tool.ts
var VECTOR_PEN_STATE = "root.select.vector.pen-suite:pen";
var VECTOR_PEN_DRAG_SLOP_SCREEN_PX = 3.5;
var IDLE_STATE = "root.select.core.select-suite:idle";
var UI_SELECTOR = "[data-canvas-ui],[data-escape-owner],button,a[href],input,textarea,select,[contenteditable]:not([contenteditable=\"false\"]),[role=\"textbox\"],[role=\"combobox\"],[role=\"dialog\"]";
var sequence = 0;
/** A local pen draft. Only finishing invokes the host's single creation/Undo transaction. */
var VectorPenTool = class {
	options;
	abort = new AbortController();
	scratch;
	scratchId = `scratch:vector:pen:${++sequence}`;
	vertices = [];
	previewVertices = [];
	previewContour = {
		vertices: this.previewVertices,
		closed: false
	};
	previewOps;
	cursor = {
		x: 0,
		y: 0,
		inX: 0,
		inY: 0,
		outX: 0,
		outY: 0,
		mirroring: "none"
	};
	pointerWorld = {
		x: 0,
		y: 0
	};
	pointerScreen = {
		x: 0,
		y: 0
	};
	startScreen = {
		x: 0,
		y: 0
	};
	spacePointer = {
		x: 0,
		y: 0
	};
	spaceAnchor = {
		x: 0,
		y: 0
	};
	screen = {
		x: 0,
		y: 0
	};
	snapped = {
		x: 0,
		y: 0
	};
	guide;
	draftPath;
	rubberPath;
	anchors;
	handles;
	handleDots;
	closeRing;
	unmountStates;
	unsubscribeFrame;
	pointerId = null;
	pointerKnown = false;
	dragged = false;
	closeHovered = false;
	shift = false;
	alt = false;
	space = false;
	composing = false;
	compositionEndedAt = -Infinity;
	active = false;
	disposed = false;
	previousCursor = "";
	constructor(options) {
		this.options = options;
		this.scratch = options.world.createScratchOverlay(`vector:pen:${sequence}`);
		this.previewOps = [
			{
				id: this.scratchId,
				aspect: "core.transform",
				patch: {
					x: 0,
					y: 0,
					rotation: 0
				}
			},
			{
				id: this.scratchId,
				aspect: "core.bounds",
				patch: {
					width: 1,
					height: 1
				}
			},
			{
				id: this.scratchId,
				aspect: "vector.path",
				patch: {
					...defaultVectorPathProps,
					contours: [this.previewContour]
				}
			}
		];
		const document = options.hud.ownerDocument, ns = "http://www.w3.org/2000/svg";
		this.guide = document.createElementNS(ns, "svg");
		this.guide.classList.add("alid-vector-pen-preview");
		this.guide.setAttribute("aria-hidden", "true");
		Object.assign(this.guide.style, {
			position: "absolute",
			inset: "0",
			width: "100%",
			height: "100%",
			pointerEvents: "none",
			overflow: "visible",
			display: "none"
		});
		this.draftPath = document.createElementNS(ns, "path");
		this.rubberPath = document.createElementNS(ns, "path");
		this.anchors = document.createElementNS(ns, "path");
		this.handles = document.createElementNS(ns, "path");
		this.handleDots = document.createElementNS(ns, "path");
		this.closeRing = document.createElementNS(ns, "circle");
		this.draftPath.dataset.vectorPen = "draft";
		this.rubberPath.dataset.vectorPen = "rubber";
		this.anchors.dataset.vectorPen = "anchors";
		this.handles.dataset.vectorPen = "handles";
		this.closeRing.dataset.vectorPen = "close";
		for (const path of [
			this.draftPath,
			this.rubberPath,
			this.anchors,
			this.handles,
			this.handleDots,
			this.closeRing
		]) {
			path.setAttribute("fill", "none");
			path.setAttribute("stroke", "var(--alid-accent, #008FF0)");
			path.setAttribute("stroke-width", "1");
		}
		this.draftPath.setAttribute("stroke-width", "2");
		this.rubberPath.setAttribute("stroke-dasharray", "4 3");
		this.anchors.setAttribute("fill", "white");
		this.handleDots.setAttribute("fill", "white");
		this.closeRing.setAttribute("r", String(10));
		this.guide.append(this.draftPath, this.rubberPath, this.handles, this.handleDots, this.anchors, this.closeRing);
		options.hud.append(this.guide);
		this.unsubscribeFrame = options.frames?.subscribe(this.render) ?? (() => {});
		const machine = options.selection.stateMachine;
		this.unmountStates = [
			machine.mountChildState("root.select", {
				id: "vector.pen-suite:pen",
				onEnter: () => {
					this.active = true;
					this.previousCursor = options.surface.style.cursor;
					options.surface.style.cursor = "crosshair";
					options.selection.select(null);
					options.host.requestRender();
				},
				onExit: () => {
					this.active = false;
					this.clearDraft();
					options.surface.style.cursor = this.previousCursor;
				},
				onModifiersChanged: (_context, modifiers) => this.modifiersChanged(modifiers)
			}),
			machine.mountChildState(VECTOR_PEN_STATE, { id: "placing" }),
			machine.mountChildState(VECTOR_PEN_STATE, { id: "pulling-handles" })
		];
		const signal = this.abort.signal;
		options.surface.addEventListener("pointerdown", this.down, {
			signal,
			capture: true
		});
		options.surface.addEventListener("pointermove", this.move, {
			signal,
			capture: true
		});
		options.surface.addEventListener("pointerup", this.up, {
			signal,
			capture: true
		});
		options.surface.addEventListener("pointercancel", this.cancelPointer, {
			signal,
			capture: true
		});
		options.surface.addEventListener("lostpointercapture", this.cancelPointer, {
			signal,
			capture: true
		});
		options.surface.addEventListener("pointerleave", this.leave, { signal });
		if (!options.externalKeyboard) document.addEventListener("keydown", this.keyDown, { signal });
		document.addEventListener("keyup", this.keyUp, { signal });
		document.addEventListener("compositionstart", this.compositionStart, {
			signal,
			capture: true
		});
		document.addEventListener("compositionend", this.compositionEnd, {
			signal,
			capture: true
		});
		document.defaultView?.addEventListener("blur", this.cancel, { signal });
	}
	get isActive() {
		return this.active;
	}
	enter() {
		if (!this.disposed && !this.active) this.options.selection.stateMachine.transition(`${VECTOR_PEN_STATE}.placing`);
	}
	finish(closed = false) {
		if (!this.active || this.disposed) return false;
		if (this.vertices.length < 2) {
			this.cancel();
			return false;
		}
		const result = reboundRotatedVector([{
			vertices: this.vertices,
			closed
		}], {
			x: 0,
			y: 0,
			rotation: 0
		}, {
			width: 1,
			height: 1
		});
		const props = {
			...defaultVectorPathProps,
			...result.nextBaseSize,
			contours: result.nextContours
		};
		this.options.selection.stateMachine.transition(IDLE_STATE);
		try {
			const id = this.options.creation.create({
				caller: "vector:pen",
				x: result.nextTransform.x,
				y: result.nextTransform.y,
				width: result.nextBounds.width,
				height: result.nextBounds.height,
				aspects: { "vector.path": props }
			});
			this.options.selection.select(id);
			this.options.onCreated?.(id);
			return true;
		} catch (error) {
			this.options.host.onError?.(error instanceof Error ? error : new Error(String(error)));
			return false;
		}
	}
	cancel = () => {
		if (this.active) this.options.selection.stateMachine.transition(IDLE_STATE);
		else this.clearDraft();
	};
	dispose() {
		if (this.disposed) return;
		this.cancel();
		this.disposed = true;
		this.abort.abort();
		this.unsubscribeFrame();
		for (let i = this.unmountStates.length - 1; i >= 0; i--) this.unmountStates[i]();
		this.scratch.dispose();
		this.guide.remove();
	}
	/** Called before global Escape/Backspace/pan arbitration by canvas.tool-input. */
	handleKeyDown = (event) => {
		if (!this.active || this.disposed || event.defaultPrevented || this.options.host.isSelectionEnabled?.() === false || this.ignoresKeyboard(event)) return false;
		if (event.ctrlKey || event.metaKey || event.getModifierState("AltGraph")) return false;
		if (event.key === "Enter" || event.key === "Escape") {
			this.finish();
			return true;
		}
		if (event.key === "Backspace") {
			this.releasePointer();
			this.vertices.pop();
			this.dragged = false;
			this.space = false;
			this.options.selection.stateMachine.transition(`${VECTOR_PEN_STATE}.placing`);
			this.updatePreview();
			return true;
		}
		if (event.code === "Space" || event.key === " ") {
			if (this.pointerId === null) return false;
			if (!this.space) {
				const current = this.vertices[this.vertices.length - 1];
				this.space = true;
				this.spacePointer.x = this.pointerWorld.x;
				this.spacePointer.y = this.pointerWorld.y;
				this.spaceAnchor.x = current.x;
				this.spaceAnchor.y = current.y;
			}
			return true;
		}
		if (event.key === "Shift" || event.key === "Alt") {
			this.shift = event.key === "Shift" || event.shiftKey;
			this.alt = event.key === "Alt" || event.altKey;
			this.applyPointer();
			this.updatePreview();
			return true;
		}
		return false;
	};
	keyDown = (event) => {
		if (this.handleKeyDown(event)) {
			event.preventDefault();
			event.stopImmediatePropagation();
		}
	};
	keyUp = (event) => {
		if (!this.active || this.ignoresKeyboard(event)) return;
		if (event.code === "Space" || event.key === " ") this.space = false;
		if (event.key === "Shift" || event.key === "Alt") {
			this.shift = event.shiftKey;
			this.alt = event.altKey;
		}
		if (event.key === "Shift" || event.key === "Alt" || event.code === "Space" || event.key === " ") {
			this.applyPointer();
			this.updatePreview();
		}
	};
	compositionStart = () => {
		this.composing = true;
	};
	compositionEnd = () => {
		this.composing = false;
		this.compositionEndedAt = performance.now();
	};
	ignoresKeyboard(event) {
		if (this.composing || event.isComposing || event.keyCode === 229 || event.key === "Process" || performance.now() - this.compositionEndedAt < 16) return true;
		for (const target of event.composedPath()) if (target instanceof Element && target.matches(UI_SELECTOR)) return true;
		return event.target instanceof Element && event.target.closest(UI_SELECTOR) !== null;
	}
	modifiersChanged(modifiers) {
		if (!this.active || modifiers.shift === this.shift && modifiers.alt === this.alt) return;
		this.shift = modifiers.shift;
		this.alt = modifiers.alt;
		this.applyPointer();
		this.updatePreview();
	}
	releasePointer() {
		const pointer = this.pointerId;
		this.pointerId = null;
		if (pointer !== null && this.options.surface.hasPointerCapture?.(pointer)) this.options.surface.releasePointerCapture(pointer);
	}
	clearDraft() {
		this.releasePointer();
		this.vertices.length = 0;
		this.previewVertices.length = 0;
		this.previewContour.closed = false;
		this.pointerKnown = false;
		this.closeHovered = false;
		this.dragged = false;
		this.space = false;
		this.shift = false;
		this.alt = false;
		this.scratch.clear();
		this.options.host.requestRender();
	}
	down = (event) => {
		if (!this.active || this.pointerId !== null || event.button !== 0 || event.defaultPrevented || this.composing || event.ctrlKey || event.metaKey || event.getModifierState?.("AltGraph") || this.options.host.isPanGesture?.(event) || this.options.host.isSelectionEnabled?.() === false) return;
		if (event.target instanceof Element && event.target.closest(UI_SELECTOR)) return;
		this.readPointer(event);
		this.updateCursor();
		event.preventDefault();
		event.stopImmediatePropagation();
		if (this.closeHovered) {
			this.finish(true);
			return;
		}
		this.vertices.push({
			x: this.cursor.x,
			y: this.cursor.y,
			inX: 0,
			inY: 0,
			outX: 0,
			outY: 0,
			mirroring: "none"
		});
		this.pointerId = event.pointerId;
		this.startScreen.x = event.clientX;
		this.startScreen.y = event.clientY;
		this.dragged = false;
		this.closeHovered = false;
		this.space = false;
		this.options.surface.setPointerCapture?.(event.pointerId);
		this.options.selection.stateMachine.transition(`${VECTOR_PEN_STATE}.pulling-handles`);
		this.updatePreview();
	};
	move = (event) => {
		if (!this.active || this.pointerId !== null && this.pointerId !== event.pointerId) return;
		if (this.pointerId === null && (this.options.host.isPanGesture?.(event) || event.target instanceof Element && event.target.closest(UI_SELECTOR))) return;
		this.readPointer(event);
		this.applyPointer();
		this.updatePreview();
		event.preventDefault();
		event.stopImmediatePropagation();
	};
	up = (event) => {
		if (event.pointerId !== this.pointerId) return;
		this.readPointer(event);
		this.applyPointer();
		this.releasePointer();
		this.space = false;
		this.options.selection.stateMachine.transition(`${VECTOR_PEN_STATE}.placing`);
		this.updatePreview();
		event.preventDefault();
		event.stopImmediatePropagation();
	};
	cancelPointer = (event) => {
		if (event.pointerId === this.pointerId) this.cancel();
	};
	leave = () => {
		if (this.active && this.pointerId === null) {
			this.pointerKnown = false;
			this.updatePreview();
		}
	};
	readPointer(event) {
		this.pointerKnown = true;
		this.pointerScreen.x = event.clientX;
		this.pointerScreen.y = event.clientY;
		this.options.host.screenToWorld(event.clientX, event.clientY, this.pointerWorld);
		this.shift = event.shiftKey;
		this.alt = event.altKey;
	}
	snapAngle(x, y) {
		const length = Math.hypot(x, y), angle = Math.round(Math.atan2(y, x) / (Math.PI / 4)) * (Math.PI / 4);
		this.snapped.x = Math.cos(angle) * length;
		this.snapped.y = Math.sin(angle) * length;
	}
	updateCursor() {
		this.cursor.x = this.pointerWorld.x;
		this.cursor.y = this.pointerWorld.y;
		const previous = this.vertices[this.vertices.length - 1];
		if (this.shift && previous) {
			this.snapAngle(this.cursor.x - previous.x, this.cursor.y - previous.y);
			this.cursor.x = previous.x + this.snapped.x;
			this.cursor.y = previous.y + this.snapped.y;
		}
		this.closeHovered = false;
		if (this.vertices.length >= 2 && this.pointerKnown) {
			const first = this.vertices[0];
			this.options.host.worldToScreen(first.x, first.y, this.screen);
			this.closeHovered = Math.hypot(this.pointerScreen.x - this.screen.x, this.pointerScreen.y - this.screen.y) <= 10;
		}
	}
	applyPointer() {
		if (!this.pointerKnown) return;
		if (this.pointerId === null) {
			this.updateCursor();
			return;
		}
		const current = this.vertices[this.vertices.length - 1];
		if (!current) return;
		if (this.space) {
			current.x = this.spaceAnchor.x + this.pointerWorld.x - this.spacePointer.x;
			current.y = this.spaceAnchor.y + this.pointerWorld.y - this.spacePointer.y;
			return;
		}
		this.dragged ||= Math.hypot(this.pointerScreen.x - this.startScreen.x, this.pointerScreen.y - this.startScreen.y) >= VECTOR_PEN_DRAG_SLOP_SCREEN_PX;
		if (!this.dragged) return;
		let dx = this.pointerWorld.x - current.x, dy = this.pointerWorld.y - current.y;
		if (this.shift) {
			this.snapAngle(dx, dy);
			dx = this.snapped.x;
			dy = this.snapped.y;
		}
		current.outX = dx;
		current.outY = dy;
		if (this.alt) current.mirroring = "none";
		else {
			current.inX = -dx || 0;
			current.inY = -dy || 0;
			current.mirroring = "angle-and-length";
		}
	}
	updatePreview() {
		if (!this.vertices.length) {
			this.previewVertices.length = 0;
			this.scratch.clear();
			this.options.host.requestRender();
			return;
		}
		if (this.pointerId === null) this.updateCursor();
		this.previewVertices.length = this.vertices.length;
		for (let i = 0; i < this.vertices.length; i++) this.previewVertices[i] = this.vertices[i];
		this.previewContour.closed = this.pointerId === null && this.closeHovered;
		if (this.pointerId === null && this.pointerKnown && !this.closeHovered) this.previewVertices.push(this.cursor);
		this.scratch.setBatch(this.previewOps);
		this.options.host.requestRender();
	}
	/** Plane 3 paint shares the host camera latch; input handlers never write SVG geometry. */
	render = () => {
		if (!this.active || !this.vertices.length) {
			this.guide.style.display = "none";
			return;
		}
		const rect = this.options.hud.getBoundingClientRect();
		this.guide.style.display = "";
		let draft = "", anchors = "", lines = "", dots = "";
		for (let i = 0; i < this.vertices.length; i++) {
			const v = this.vertices[i];
			this.options.host.worldToScreen(v.x, v.y, this.screen);
			const x = this.screen.x - rect.left, y = this.screen.y - rect.top;
			draft += i === 0 ? `M${x},${y}` : this.segment(this.vertices[i - 1], v, rect.left, rect.top);
			anchors += `M${x - 3},${y - 3}h6v6h-6Z`;
		}
		const last = this.vertices[this.vertices.length - 1];
		this.options.host.worldToScreen(last.x, last.y, this.screen);
		const x = this.screen.x - rect.left, y = this.screen.y - rect.top;
		for (const side of ["in", "out"]) {
			const dx = side === "in" ? last.inX : last.outX, dy = side === "in" ? last.inY : last.outY;
			if (!dx && !dy) continue;
			this.options.host.worldToScreen(last.x + dx, last.y + dy, this.screen);
			const hx = this.screen.x - rect.left, hy = this.screen.y - rect.top;
			lines += `M${x},${y}L${hx},${hy}`;
			dots += `M${hx - 3},${hy}a3,3 0 1,0 6,0a3,3 0 1,0 -6,0`;
		}
		this.draftPath.setAttribute("d", draft);
		this.anchors.setAttribute("d", anchors);
		this.handles.setAttribute("d", lines);
		this.handleDots.setAttribute("d", dots);
		this.rubberPath.setAttribute("d", this.pointerId === null && this.pointerKnown ? `M${x},${y}${this.segment(last, this.closeHovered ? this.vertices[0] : this.cursor, rect.left, rect.top)}` : "");
		this.closeRing.style.display = this.vertices.length >= 2 && this.pointerId === null && this.pointerKnown ? "" : "none";
		this.options.host.worldToScreen(this.vertices[0].x, this.vertices[0].y, this.screen);
		this.closeRing.setAttribute("cx", String(this.screen.x - rect.left));
		this.closeRing.setAttribute("cy", String(this.screen.y - rect.top));
		this.closeRing.setAttribute("fill", this.closeHovered ? "var(--alid-accent-soft, #e5f4fe)" : "none");
		this.closeRing.setAttribute("opacity", this.closeHovered ? "1" : ".4");
	};
	segment(a, b, left, top) {
		if (!a.outX && !a.outY && !b.inX && !b.inY) {
			this.options.host.worldToScreen(b.x, b.y, this.screen);
			return `L${this.screen.x - left},${this.screen.y - top}`;
		}
		this.options.host.worldToScreen(a.x + a.outX, a.y + a.outY, this.screen);
		let d = `C${this.screen.x - left},${this.screen.y - top} `;
		this.options.host.worldToScreen(b.x + b.inX, b.y + b.inY, this.screen);
		d += `${this.screen.x - left},${this.screen.y - top} `;
		this.options.host.worldToScreen(b.x, b.y, this.screen);
		return `${d}${this.screen.x - left},${this.screen.y - top}`;
	}
};
// src/node-editor.ts
var VECTOR_EDIT_STATE = "root.select.vector.pen-suite:edit";
var IDLE = "root.select.core.select-suite:idle";
var NS = "http://www.w3.org/2000/svg";
var SLOP = 3.5;
var clone = (contours) => cloneContours(contours);
var blocked = (target) => target instanceof Element && !!target.closest("[data-canvas-ui],button,input,textarea,select,[contenteditable]:not([contenteditable=\"false\"])");
var inputOwned = (event) => blocked(event.target) || event.composedPath().some(blocked);
var instance = 0;
/** Local vertex selection and scratch edits; canonical writes happen only at an explicit commit. */
var VectorNodeEditor = class {
	options;
	owner = `vector:node-editor:${++instance}`;
	scratch;
	abort = new AbortController();
	off = [];
	handles = [];
	chosen = [];
	hit = {
		id: "",
		priority: 0,
		distanceScreenPx: 0
	};
	worldPoint = {
		x: 0,
		y: 0
	};
	localPoint = {
		x: 0,
		y: 0
	};
	screenPoint = {
		x: 0,
		y: 0
	};
	segmentPoint = {
		x: 0,
		y: 0
	};
	modifiers = {
		shift: false,
		alt: false,
		ctrl: false,
		meta: false
	};
	svg;
	lines;
	marquee;
	snapGuide;
	entity;
	originalProps;
	originalTransform;
	originalBounds;
	frame;
	draft = [];
	baseline = [];
	gesture;
	dirty = false;
	change = false;
	mutating = false;
	disposed = false;
	composing = false;
	compositionEnded = -Infinity;
	lastX = 0;
	lastY = 0;
	pendingOps = [];
	previousCursor = "";
	constructor(options) {
		this.options = options;
		this.scratch = options.world.createScratchOverlay(this.owner);
		const doc = options.surface.ownerDocument;
		this.svg = doc.createElementNS(NS, "svg");
		this.svg.dataset.role = "vector-node-editor";
		this.svg.setAttribute("aria-hidden", "true");
		this.svg.style.cssText = "position:absolute;inset:0;width:100%;height:100%;overflow:visible;pointer-events:none;display:none;";
		this.lines = doc.createElementNS(NS, "path");
		this.lines.setAttribute("fill", "none");
		this.lines.setAttribute("stroke", "var(--alid-accent,#008FF0)");
		this.lines.setAttribute("stroke-width", "1");
		this.marquee = doc.createElementNS(NS, "rect");
		this.marquee.dataset.role = "vector-node-marquee";
		this.marquee.setAttribute("fill", "var(--alid-accent-soft,#e5f4fe)");
		this.marquee.setAttribute("fill-opacity", ".35");
		this.marquee.setAttribute("stroke", "var(--alid-accent,#008FF0)");
		this.marquee.style.display = "none";
		this.snapGuide = doc.createElementNS(NS, "path");
		this.snapGuide.setAttribute("fill", "none");
		this.snapGuide.setAttribute("stroke", "var(--alid-accent,#008FF0)");
		this.snapGuide.setAttribute("stroke-dasharray", "3 3");
		this.svg.append(this.lines, this.marquee, this.snapGuide);
		options.hud.append(this.svg);
		this.off.push(options.selection.stateMachine.mountChildState("root.select", {
			id: "vector.pen-suite:edit",
			onExit: () => this.release(),
			onModifiersChanged: (_context, modifiers) => this.setModifiers(modifiers)
		}));
		for (const state of [
			"idle",
			"dragging-vertex",
			"dragging-handle",
			"bending-segment",
			"marquee"
		]) this.off.push(options.selection.stateMachine.mountChildState(VECTOR_EDIT_STATE, { id: state }));
		this.off.push(options.frames?.subscribe(this.render) ?? (() => {}), options.world.subscribe(this.onWorldChanged));
		const signal = this.abort.signal;
		options.surface.addEventListener("pointerdown", this.down, {
			capture: true,
			signal
		});
		options.surface.addEventListener("pointermove", this.move, {
			capture: true,
			signal
		});
		options.surface.addEventListener("pointerup", this.up, {
			capture: true,
			signal
		});
		options.surface.addEventListener("pointercancel", this.cancelPointer, {
			capture: true,
			signal
		});
		options.surface.addEventListener("lostpointercapture", this.cancelPointer, {
			capture: true,
			signal
		});
		options.surface.addEventListener("dblclick", this.doubleClick, {
			capture: true,
			signal
		});
		if (!options.externalKeyboard) doc.addEventListener("keydown", this.keyDown, { signal });
		doc.addEventListener("keyup", this.keyModifiers, { signal });
		doc.addEventListener("compositionstart", () => {
			this.composing = true;
			this.cancelGesture();
		}, { signal });
		doc.addEventListener("compositionend", () => {
			this.composing = false;
			this.compositionEnded = performance.now();
		}, { signal });
		doc.defaultView?.addEventListener("blur", this.exit, { signal });
	}
	get editingEntityId() {
		return this.entity;
	}
	isEditingEntity = (id) => this.entity === id;
	getSelectedVertices() {
		return this.chosen;
	}
	setSelectedMirroring(mode) {
		if (mode !== "none" && mode !== "angle" && mode !== "angle-and-length") return false;
		return this.changeSelected("vector:set-node-mirroring", (point) => {
			const side = point.outX || point.outY ? "out" : "in";
			return setVertexHandle(point, side, side === "out" ? point.outX : point.inX, side === "out" ? point.outY : point.inY, mode);
		});
	}
	/** A radius applies to a corner; converting a smooth point is one undoable edit. */
	setSelectedCornerRadius(radius) {
		if (!Number.isFinite(radius)) return false;
		radius = Math.max(0, Math.min(1e6, radius));
		return this.changeSelected("vector:set-corner-radius", (point) => ({
			...point,
			cornerRadius: radius,
			...radius > 0 ? {
				inX: 0,
				inY: 0,
				outX: 0,
				outY: 0,
				mirroring: "none"
			} : {}
		}));
	}
	changeSelected(symbol, change) {
		if (!this.entity || this.gesture || !this.chosen.length || this.options.world.isEntityReadOnly(this.entity)) return false;
		let changed = false;
		for (const address of this.chosen) {
			const previous = this.draft[address.contour]?.vertices[address.index];
			if (!previous) continue;
			const next = change(previous);
			if (Object.keys(next).some((key) => next[key] !== previous[key])) {
				this.draft[address.contour].vertices[address.index] = { ...next };
				changed = true;
			}
		}
		if (changed) {
			this.commit(symbol);
			this.rebuildHandles();
			this.options.host.requestRender();
		}
		return changed;
	}
	enter(id) {
		if (this.disposed || this.options.world.isEntityReadOnly(id) || !this.options.world.isAlive(id) || !this.options.world.getCanonical(id, "vector.path")) return false;
		if (this.entity === id) return true;
		this.exit();
		this.entity = id;
		this.readCanonical();
		this.chosen.length = 0;
		this.options.selection.select(id);
		this.previousCursor = this.options.surface.style.cursor;
		this.options.surface.style.cursor = "default";
		this.options.selection.stateMachine.transition(`${VECTOR_EDIT_STATE}.idle`);
		this.options.surface.focus({ preventScroll: true });
		this.rebuildHandles();
		this.options.onEditingChanged?.(id);
		this.options.host.requestRender();
		return true;
	}
	exit = () => {
		if (this.entity) this.options.selection.stateMachine.transition(IDLE);
	};
	/** Escape cancels the current gesture first, then exits the local editing state. */
	cancel() {
		if (!this.entity) return false;
		if (this.gesture) this.cancelGesture();
		else this.exit();
		return true;
	}
	dispose() {
		if (this.disposed) return;
		this.exit();
		this.disposed = true;
		this.abort.abort();
		for (let i = this.off.length - 1; i >= 0; i--) this.off[i]();
		this.scratch.dispose();
		this.svg.remove();
	}
	handleKeyDown(event) {
		if (!this.entity || this.options.host.isSelectionEnabled?.() === false || inputOwned(event) || this.imeLocked(event) || event.getModifierState("AltGraph")) return false;
		this.setModifiers(event);
		if (event.key === "Escape") {
			this.cancel();
			return true;
		}
		if (event.key === "Enter") {
			if (this.gesture) this.cancelGesture();
			else this.exit();
			return true;
		}
		if (event.key === "Delete" || event.key === "Backspace") {
			if (!this.gesture) this.deleteVertices();
			return true;
		}
		if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "a") {
			this.chosen.length = 0;
			for (let c = 0; c < this.draft.length; c++) for (let index = 0; index < this.draft[c].vertices.length; index++) this.chosen.push({
				contour: c,
				index
			});
			this.options.host.requestRender();
			return true;
		}
		return false;
	}
	readCanonical() {
		const id = this.entity;
		this.originalProps = this.options.world.getCanonical(id, "vector.path");
		this.originalTransform = this.options.world.getCanonical(id, "core.transform");
		this.originalBounds = this.options.world.getCanonical(id, "core.bounds");
		const normalized = normalizeVectorPathProps(this.originalProps);
		this.frame = createVectorFrame(normalized, this.originalTransform, this.originalBounds);
		this.draft = clone(normalized.contours);
		this.baseline = clone(this.draft);
		this.pendingOps = [{
			id,
			aspect: "vector.path",
			patch: { contours: this.draft }
		}];
		this.dirty = false;
		this.change = false;
	}
	release() {
		this.endCapture();
		this.scratch.clear();
		this.clearHandles();
		this.chosen.length = 0;
		this.entity = void 0;
		this.frame = void 0;
		this.options.surface.style.cursor = this.previousCursor;
		this.options.onEditingChanged?.(void 0);
		this.options.host.requestRender();
	}
	clearHandles() {
		for (const handle of this.handles) {
			handle.off();
			handle.element.remove();
		}
		this.handles.length = 0;
	}
	selected(contour, index) {
		for (const address of this.chosen) if (address.contour === contour && address.index === index) return true;
		return false;
	}
	choose(contour, index, toggle) {
		const position = this.chosen.findIndex((value) => value.contour === contour && value.index === index);
		if (toggle && position >= 0) this.chosen.splice(position, 1);
		else if (position < 0) {
			if (!toggle) this.chosen.length = 0;
			this.chosen.push({
				contour,
				index
			});
		}
	}
	rebuildHandles() {
		this.clearHandles();
		if (!this.entity) return;
		const doc = this.options.surface.ownerDocument;
		for (let c = 0; c < this.draft.length; c++) for (let i = 0; i < this.draft[c].vertices.length; i++) for (const kind of [
			"in",
			"out",
			"vertex",
			"midpoint"
		]) {
			if (kind === "midpoint" && !this.draft[c].closed && i === this.draft[c].vertices.length - 1) continue;
			const id = `${this.owner}:${c}:${i}:${kind}`, element = doc.createElementNS(NS, kind === "vertex" ? "rect" : "circle");
			element.dataset.gizmoId = id;
			element.dataset.vectorHandle = kind;
			element.dataset.contour = String(c);
			element.dataset.vertex = String(i);
			element.setAttribute("fill", "#fff");
			element.setAttribute("stroke", "var(--alid-accent,#008FF0)");
			element.setAttribute("stroke-width", "1.25");
			if (kind === "vertex") {
				element.setAttribute("width", "7");
				element.setAttribute("height", "7");
			} else {
				element.setAttribute("r", kind === "midpoint" ? "3" : "4");
				if (kind === "midpoint") element.setAttribute("opacity", ".5");
			}
			const handle = {
				id,
				kind,
				contour: c,
				index: i,
				element,
				off: () => {}
			};
			handle.off = this.options.selection.gizmos.register({
				id,
				priority: kind === "vertex" ? 30 : kind === "midpoint" ? 25 : 35,
				shape: kind === "vertex" ? "rect" : "circle",
				widthScreenPx: 7,
				heightScreenPx: 7,
				radiusScreenPx: kind === "midpoint" ? 5 : 6,
				getWorldPosition: (out) => this.handlePosition(handle, out),
				onPointerDown: (event) => this.beginHandle(handle, event)
			});
			this.handles.push(handle);
			this.svg.append(element);
		}
	}
	handlePosition(handle, out) {
		if (!this.entity || !this.frame) return false;
		const contour = this.draft[handle.contour], vertex = contour?.vertices[handle.index];
		if (!vertex) return false;
		if (handle.kind === "midpoint") {
			this.segmentAt(contour, handle.index, .5, this.segmentPoint);
			pointToWorld(this.frame, this.segmentPoint.x, this.segmentPoint.y, out);
		} else if (handle.kind === "vertex") pointToWorld(this.frame, vertex.x, vertex.y, out);
		else {
			const x = handle.kind === "in" ? vertex.inX : vertex.outX, y = handle.kind === "in" ? vertex.inY : vertex.outY;
			if (x === 0 && y === 0 && (!this.modifiers.alt || handle.kind === "in")) return false;
			pointToWorld(this.frame, vertex.x + x, vertex.y + y, out);
		}
		return true;
	}
	screenToLocal(x, y) {
		this.options.host.screenToWorld(x, y, this.worldPoint);
		pointToLocal(this.frame, this.worldPoint.x, this.worldPoint.y, this.localPoint);
	}
	setModifiers(modifiers) {
		if ("shiftKey" in modifiers) {
			this.modifiers.shift = modifiers.shiftKey;
			this.modifiers.alt = modifiers.altKey;
			this.modifiers.ctrl = modifiers.ctrlKey;
			this.modifiers.meta = modifiers.metaKey;
		} else Object.assign(this.modifiers, modifiers);
		if (this.gesture) this.dirty = true;
		this.options.host.requestRender();
	}
	keyDown = (event) => {
		if (!event.defaultPrevented && this.handleKeyDown(event)) {
			event.preventDefault();
			event.stopImmediatePropagation();
		}
	};
	keyModifiers = (event) => {
		if (this.entity && !this.imeLocked(event)) this.setModifiers(event);
	};
	imeLocked(event) {
		return this.composing || !!event && (event.isComposing || event.keyCode === 229 || event.key === "Process") || performance.now() - this.compositionEnded < 16;
	}
	stop(event) {
		event.preventDefault();
		event.stopImmediatePropagation();
	}
	startGesture(kind, contour, index, event, handle = "out", t = .5, inserted = false) {
		this.screenToLocal(event.clientX, event.clientY);
		this.baseline = clone(this.draft);
		this.lastX = event.clientX;
		this.lastY = event.clientY;
		const point = this.baseline[contour]?.vertices[index];
		this.gesture = {
			kind,
			contour,
			index,
			handle,
			t,
			x: this.localPoint.x,
			y: this.localPoint.y,
			clientX: event.clientX,
			clientY: event.clientY,
			pointer: event.pointerId,
			moved: false,
			inserted,
			extend: event.shiftKey,
			alt: event.altKey,
			heldInX: point?.inX ?? 0,
			heldInY: point?.inY ?? 0,
			heldOutX: point?.outX ?? 0,
			heldOutY: point?.outY ?? 0
		};
		this.change = inserted;
		this.dirty = inserted;
		this.options.surface.setPointerCapture?.(event.pointerId);
		this.options.surface.focus({ preventScroll: true });
		this.options.host.requestRender();
		this.stop(event);
	}
	beginHandle(handle, event) {
		if (!this.entity || this.gesture || event.button !== 0) return false;
		if (handle.kind === "vertex") {
			this.choose(handle.contour, handle.index, event.shiftKey);
			this.startGesture("vertex", handle.contour, handle.index, event);
		} else if (handle.kind === "midpoint") {
			this.draft[handle.contour] = clone([splitSegment(this.draft[handle.contour], handle.index, .5)])[0];
			this.chosen.length = 0;
			this.chosen.push({
				contour: handle.contour,
				index: handle.index + 1
			});
			this.rebuildHandles();
			this.startGesture("vertex", handle.contour, handle.index + 1, event, "out", .5, true);
		} else {
			this.choose(handle.contour, handle.index, false);
			this.startGesture("handle", handle.contour, handle.index, event, handle.kind);
		}
		return true;
	}
	down = (event) => {
		if (!this.entity || this.gesture || event.button !== 0 || event.defaultPrevented || inputOwned(event) || this.imeLocked() || this.options.host.isPanGesture?.(event) || this.options.host.isSelectionEnabled?.() === false) return;
		this.setModifiers(event);
		if (this.options.selection.gizmos.hitTest(event.clientX, event.clientY, this.options.host.worldToScreen, this.hit)) {
			const handle = this.handles.find((value) => value.id === this.hit.id);
			if (handle && this.beginHandle(handle, event)) return;
		}
		this.screenToLocal(event.clientX, event.clientY);
		const segment = this.nearestSegment(this.worldPoint.x, this.worldPoint.y);
		if (segment) this.startGesture("segment", segment.contour, segment.index, event, "out", segment.t);
		else {
			if (!event.shiftKey) this.chosen.length = 0;
			this.startGesture("marquee", 0, 0, event);
		}
	};
	move = (event) => {
		if (!this.gesture || this.gesture.pointer !== event.pointerId) return;
		this.lastX = event.clientX;
		this.lastY = event.clientY;
		this.modifiers.shift = event.shiftKey;
		this.modifiers.alt = event.altKey;
		this.gesture.moved ||= Math.hypot(event.clientX - this.gesture.clientX, event.clientY - this.gesture.clientY) >= SLOP;
		this.dirty = true;
		this.options.host.requestRender();
		this.stop(event);
	};
	applyGesture() {
		const gesture = this.gesture;
		if (!gesture || !this.dirty) return;
		this.dirty = false;
		if (gesture.kind === "marquee") {
			if (gesture.moved) this.options.selection.stateMachine.transition(`${VECTOR_EDIT_STATE}.marquee`);
			return;
		}
		if (!gesture.moved && !gesture.inserted) return;
		this.screenToLocal(this.lastX, this.lastY);
		let dx = this.localPoint.x - gesture.x, dy = this.localPoint.y - gesture.y;
		if (this.modifiers.shift && gesture.kind !== "handle") {
			pointToWorld(this.frame, gesture.x, gesture.y, this.segmentPoint);
			const wx = this.worldPoint.x - this.segmentPoint.x, wy = this.worldPoint.y - this.segmentPoint.y;
			const length = Math.hypot(wx, wy), angle = Math.round(Math.atan2(wy, wx) / (Math.PI / 4)) * Math.PI / 4;
			pointToLocal(this.frame, this.segmentPoint.x + length * Math.cos(angle), this.segmentPoint.y + length * Math.sin(angle), this.localPoint);
			dx = this.localPoint.x - gesture.x;
			dy = this.localPoint.y - gesture.y;
		}
		if (gesture.kind === "vertex") {
			const step = this.options.host.isSnapEnabled?.() === false ? 0 : this.options.host.getSnapStep?.() ?? 0;
			if (step > 0 && !this.modifiers.shift) {
				const anchor = this.baseline[gesture.contour].vertices[gesture.index];
				pointToWorld(this.frame, anchor.x + dx, anchor.y + dy, this.worldPoint);
				pointToLocal(this.frame, Math.round(this.worldPoint.x / step) * step, Math.round(this.worldPoint.y / step) * step, this.localPoint);
				dx = this.localPoint.x - anchor.x;
				dy = this.localPoint.y - anchor.y;
			}
			for (const address of this.chosen) {
				const source = this.baseline[address.contour]?.vertices[address.index], target = this.draft[address.contour]?.vertices[address.index];
				if (source && target) {
					target.x = source.x + dx;
					target.y = source.y + dy;
				}
			}
		} else if (gesture.kind === "handle") {
			const source = this.baseline[gesture.contour].vertices[gesture.index];
			let x = this.localPoint.x - source.x, y = this.localPoint.y - source.y;
			if (this.modifiers.shift) {
				const length = Math.hypot(x, y), angle = Math.round(Math.atan2(y, x) / (Math.PI / 4)) * Math.PI / 4;
				x = length * Math.cos(angle);
				y = length * Math.sin(angle);
			}
			if (this.modifiers.alt && !gesture.alt) {
				const current = this.draft[gesture.contour].vertices[gesture.index];
				gesture.heldInX = current.inX;
				gesture.heldInY = current.inY;
				gesture.heldOutX = current.outX;
				gesture.heldOutY = current.outY;
			}
			gesture.alt = this.modifiers.alt;
			const origin = this.modifiers.alt ? {
				...source,
				inX: gesture.heldInX,
				inY: gesture.heldInY,
				outX: gesture.heldOutX,
				outY: gesture.heldOutY
			} : source;
			this.draft[gesture.contour].vertices[gesture.index] = { ...setVertexHandle(origin, gesture.handle, x, y, this.modifiers.alt ? "none" : source.mirroring) };
		} else this.draft[gesture.contour] = clone([bendSegment(this.baseline[gesture.contour], gesture.index, gesture.t, dx, dy)])[0];
		this.change = true;
		this.pendingOps[0].patch = { contours: this.draft };
		this.scratch.setBatch(this.pendingOps);
		this.options.selection.stateMachine.transition(`${VECTOR_EDIT_STATE}.${gesture.kind === "vertex" ? "dragging-vertex" : gesture.kind === "handle" ? "dragging-handle" : "bending-segment"}`);
	}
	up = (event) => {
		const gesture = this.gesture;
		if (!gesture || gesture.pointer !== event.pointerId) return;
		this.move(event);
		this.applyGesture();
		if (gesture.kind === "marquee") this.selectMarquee(gesture);
		else if (gesture.kind === "segment" && !gesture.moved) {
			this.draft[gesture.contour] = clone([splitSegment(this.draft[gesture.contour], gesture.index, gesture.t)])[0];
			this.chosen.length = 0;
			this.chosen.push({
				contour: gesture.contour,
				index: gesture.index + 1
			});
			this.change = true;
		}
		this.endCapture();
		if (this.change) this.commit("vector:edit-nodes");
		else this.scratch.clear();
		if (this.entity) {
			this.options.selection.stateMachine.transition(`${VECTOR_EDIT_STATE}.idle`);
			this.rebuildHandles();
		}
		this.options.host.requestRender();
		this.stop(event);
	};
	selectMarquee(gesture) {
		if (!gesture.extend) this.chosen.length = 0;
		const minX = Math.min(gesture.clientX, this.lastX), minY = Math.min(gesture.clientY, this.lastY), maxX = Math.max(gesture.clientX, this.lastX), maxY = Math.max(gesture.clientY, this.lastY);
		for (let c = 0; c < this.draft.length; c++) for (let i = 0; i < this.draft[c].vertices.length; i++) {
			const vertex = this.draft[c].vertices[i];
			pointToWorld(this.frame, vertex.x, vertex.y, this.worldPoint);
			this.options.host.worldToScreen(this.worldPoint.x, this.worldPoint.y, this.screenPoint);
			if (this.screenPoint.x >= minX && this.screenPoint.x <= maxX && this.screenPoint.y >= minY && this.screenPoint.y <= maxY && !this.selected(c, i)) this.chosen.push({
				contour: c,
				index: i
			});
		}
	}
	endCapture() {
		const pointer = this.gesture?.pointer;
		this.gesture = void 0;
		this.dirty = false;
		if (pointer !== void 0 && this.options.surface.hasPointerCapture?.(pointer)) this.options.surface.releasePointerCapture(pointer);
	}
	cancelGesture() {
		if (!this.gesture) return;
		this.endCapture();
		this.scratch.clear();
		if (this.entity) {
			this.readCanonical();
			this.rebuildHandles();
			this.options.selection.stateMachine.transition(`${VECTOR_EDIT_STATE}.idle`);
		}
		this.options.host.requestRender();
	}
	cancelPointer = (event) => {
		if (this.gesture?.pointer === event.pointerId) this.cancelGesture();
	};
	doubleClick = (event) => {
		if (event.button !== 0 || event.defaultPrevented || inputOwned(event) || this.imeLocked() || event.ctrlKey || event.metaKey || event.altKey || this.options.host.isSelectionEnabled?.() === false || this.options.host.isPanGesture?.(event)) return;
		if (!this.entity) {
			if (this.options.selection.stateMachine.stateId !== IDLE) return;
			const selected = this.options.selection.getSelection();
			if (selected.length !== 1 || !this.options.world.getCanonical(selected[0], "vector.path")) return;
			this.options.host.screenToWorld(event.clientX, event.clientY, this.worldPoint);
			const contribution = this.options.world.getSelectionContribution(selected[0]);
			if (!contribution || contribution.hitTest(selected[0], this.options.world.getPreviewView(), this.worldPoint.x, this.worldPoint.y, this.options.host.getZoom()) > 8 / this.options.host.getZoom()) return;
			if (this.enter(selected[0])) this.stop(event);
			return;
		}
		this.setModifiers(event);
		for (const handle of this.handles) if (handle.kind === "vertex" && this.handlePosition(handle, this.worldPoint)) {
			this.options.host.worldToScreen(this.worldPoint.x, this.worldPoint.y, this.screenPoint);
			if (Math.hypot(event.clientX - this.screenPoint.x, event.clientY - this.screenPoint.y) <= 7) {
				this.cancelGesture();
				this.draft[handle.contour] = clone([toggleVertex(this.draft[handle.contour], handle.index)])[0];
				this.choose(handle.contour, handle.index, false);
				this.commit("vector:toggle-node");
				this.rebuildHandles();
				this.stop(event);
				break;
			}
		}
	};
	deleteVertices() {
		if (!this.entity || !this.chosen.length) return;
		this.draft = this.draft.map((contour, c) => {
			const vertices = contour.vertices.filter((_vertex, i) => !this.selected(c, i));
			return {
				closed: contour.closed && vertices.length > 2,
				vertices
			};
		}).filter((contour) => contour.vertices.length >= 2);
		this.chosen.length = 0;
		if (!this.draft.length) {
			const id = this.entity;
			this.mutating = true;
			this.options.host.history.begin();
			try {
				this.options.world.applyCanonicalTransaction("vector:delete-nodes", [{
					id,
					aspect: "core.transform",
					patch: null
				}], "local:user");
				this.options.host.history.commit();
			} catch (error) {
				this.options.host.history.abort();
				this.report(error);
			} finally {
				this.mutating = false;
				this.exit();
			}
		} else {
			this.commit("vector:delete-nodes");
			this.rebuildHandles();
		}
		this.options.host.requestRender();
	}
	commit(symbol) {
		if (!this.entity || !this.frame || !this.originalProps) return;
		const result = reboundRotatedVector(this.draft, this.frame, this.frame, void 0, void 0, this.frame);
		const ops = [
			{
				id: this.entity,
				aspect: "vector.path",
				patch: {
					contours: result.nextContours,
					...result.nextBaseSize
				}
			},
			{
				id: this.entity,
				aspect: "core.transform",
				patch: result.nextTransform
			},
			{
				id: this.entity,
				aspect: "core.bounds",
				patch: result.nextBounds
			}
		];
		this.scratch.clear();
		this.mutating = true;
		this.options.host.history.begin();
		try {
			this.options.world.applyCanonicalTransaction(symbol, ops, "local:user");
			this.options.host.history.commit();
		} catch (error) {
			this.options.host.history.abort();
			this.report(error);
		} finally {
			this.mutating = false;
			if (this.entity) this.readCanonical();
		}
	}
	report(error) {
		this.options.host.onError?.(error instanceof Error ? error : new Error(String(error)));
	}
	onWorldChanged = () => {
		if (this.mutating || !this.entity) return;
		if (!this.options.world.isAlive(this.entity) || this.options.world.isEntityReadOnly(this.entity) || !this.options.world.getCanonical(this.entity, "vector.path")) {
			this.exit();
			return;
		}
		if (this.originalProps !== this.options.world.getCanonical(this.entity, "vector.path") || this.originalTransform !== this.options.world.getCanonical(this.entity, "core.transform") || this.originalBounds !== this.options.world.getCanonical(this.entity, "core.bounds")) {
			if (this.originalProps?.contours !== this.options.world.getCanonical(this.entity, "vector.path")?.contours) this.chosen.length = 0;
			this.cancelGesture();
			this.readCanonical();
			this.rebuildHandles();
			this.options.host.requestRender();
		}
	};
	segmentAt(contour, index, t, out) {
		cubicAt(contour.vertices[index], contour.vertices[(index + 1) % contour.vertices.length], t, out);
	}
	nearestSegment(x, y) {
		let best = (8 / this.options.host.getZoom()) ** 2, found;
		for (let c = 0; c < this.draft.length; c++) {
			const contour = this.draft[c], count = contour.vertices.length - (contour.closed ? 0 : 1);
			for (let index = 0; index < count; index++) {
				let tBest = .5, distance = Infinity;
				for (let sample = 1; sample < 64; sample++) {
					const t = sample / 64;
					this.segmentAt(contour, index, t, this.segmentPoint);
					pointToWorld(this.frame, this.segmentPoint.x, this.segmentPoint.y, this.worldPoint);
					const d = (this.worldPoint.x - x) ** 2 + (this.worldPoint.y - y) ** 2;
					if (d < distance) {
						distance = d;
						tBest = t;
					}
				}
				let lo = Math.max(.001, tBest - 1 / 64), hi = Math.min(.999, tBest + 1 / 64);
				for (let step = 0; step < 12; step++) {
					const left = lo + (hi - lo) / 3, right = hi - (hi - lo) / 3;
					this.segmentAt(contour, index, left, this.segmentPoint);
					pointToWorld(this.frame, this.segmentPoint.x, this.segmentPoint.y, this.worldPoint);
					const d1 = (this.worldPoint.x - x) ** 2 + (this.worldPoint.y - y) ** 2;
					this.segmentAt(contour, index, right, this.segmentPoint);
					pointToWorld(this.frame, this.segmentPoint.x, this.segmentPoint.y, this.worldPoint);
					if (d1 < (this.worldPoint.x - x) ** 2 + (this.worldPoint.y - y) ** 2) hi = right;
					else lo = left;
				}
				const t = (lo + hi) / 2;
				this.segmentAt(contour, index, t, this.segmentPoint);
				pointToWorld(this.frame, this.segmentPoint.x, this.segmentPoint.y, this.worldPoint);
				distance = (this.worldPoint.x - x) ** 2 + (this.worldPoint.y - y) ** 2;
				if (distance <= best) {
					best = distance;
					found = {
						contour: c,
						index,
						t
					};
				}
			}
		}
		return found;
	}
	render = () => {
		if (!this.entity) {
			this.svg.style.display = "none";
			return;
		}
		if (!this.options.selection.getSelection().includes(this.entity) || this.options.world.isEntityReadOnly(this.entity)) {
			this.exit();
			this.svg.style.display = "none";
			return;
		}
		this.applyGesture();
		this.svg.style.display = "";
		const rect = this.options.hud.getBoundingClientRect();
		let lines = "";
		for (const handle of this.handles) {
			const visible = this.handlePosition(handle, this.worldPoint);
			handle.element.style.display = visible ? "" : "none";
			if (!visible) continue;
			this.options.host.worldToScreen(this.worldPoint.x, this.worldPoint.y, this.screenPoint);
			const x = this.screenPoint.x - rect.left, y = this.screenPoint.y - rect.top;
			if (handle.kind === "vertex") {
				handle.element.setAttribute("x", String(x - 3.5));
				handle.element.setAttribute("y", String(y - 3.5));
				handle.element.setAttribute("fill", this.selected(handle.contour, handle.index) ? "var(--alid-accent,#008FF0)" : "#fff");
			} else {
				handle.element.setAttribute("cx", String(x));
				handle.element.setAttribute("cy", String(y));
			}
			if (handle.kind === "in" || handle.kind === "out") {
				const vertex = this.draft[handle.contour].vertices[handle.index];
				pointToWorld(this.frame, vertex.x, vertex.y, this.worldPoint);
				this.options.host.worldToScreen(this.worldPoint.x, this.worldPoint.y, this.screenPoint);
				lines += `M${x},${y}L${this.screenPoint.x - rect.left},${this.screenPoint.y - rect.top}`;
			}
		}
		this.lines.setAttribute("d", lines);
		const gesture = this.gesture, marquee = gesture?.kind === "marquee" && gesture.moved;
		this.marquee.style.display = marquee ? "" : "none";
		if (marquee) {
			this.marquee.setAttribute("x", String(Math.min(gesture.clientX, this.lastX) - rect.left));
			this.marquee.setAttribute("y", String(Math.min(gesture.clientY, this.lastY) - rect.top));
			this.marquee.setAttribute("width", String(Math.abs(this.lastX - gesture.clientX)));
			this.marquee.setAttribute("height", String(Math.abs(this.lastY - gesture.clientY)));
		}
		let guide = "";
		if (gesture?.kind === "vertex" && gesture.moved && (this.modifiers.shift || this.options.host.isSnapEnabled?.() !== false && (this.options.host.getSnapStep?.() ?? 0) > 0)) {
			const anchor = this.draft[gesture.contour].vertices[gesture.index];
			pointToWorld(this.frame, anchor.x, anchor.y, this.worldPoint);
			this.options.host.worldToScreen(this.worldPoint.x, this.worldPoint.y, this.screenPoint);
			guide = `M${gesture.clientX - rect.left},${gesture.clientY - rect.top}L${this.screenPoint.x - rect.left},${this.screenPoint.y - rect.top}`;
		}
		this.snapGuide.setAttribute("d", guide);
	};
};
// src/install.ts
function createVectorPathExtension() {
	let editor;
	return {
		id: "vector.pen-suite",
		summary: "자유 벡터 경로를 그리고 정점·핸들·곡선을 직접 편집합니다.",
		aspects: [createVectorPathAspect((id) => editor?.isEditingEntity(id) ?? false)],
		ui: { controls: [{
			id: "vector.pen",
			kind: "action",
			icon: "pen",
			label: "펜 도구",
			mnemonic: "p",
			commandSymbol: "vector:pen-tool",
			placement: "tool-shelf",
			activeToolState: VECTOR_PEN_STATE
		}] },
		activate(context) {
			let surface = context.services.get("canvas.surface");
			let host = context.services.get("canvas.interaction");
			if (!surface || !host) return;
			const activeSurface = context.services.get("canvas.active-tool-surface");
			let pen, boundSelection;
			const ensureTools = () => {
				const active = activeSurface?.get();
				if (activeSurface && !active) {
					pen?.dispose();
					editor?.dispose();
					pen = void 0;
					editor = void 0;
					boundSelection = void 0;
					return false;
				}
				const selection = active?.selection ?? context.services.get("canvas.selection");
				if (selection !== boundSelection) {
					pen?.dispose();
					editor?.dispose();
					pen = void 0;
					editor = void 0;
					boundSelection = selection;
				}
				surface = active?.surface ?? surface;
				host = active?.host ?? host;
				const creation = context.services.get("canvas.creation");
				if (!selection || !creation || !surface || !host) return false;
				const options = {
					world: context.world,
					selection,
					host,
					surface: surface.element,
					hud: surface.hud,
					frames: context.services.get("canvas.frames"),
					externalKeyboard: !!context.services.get("canvas.tool-input")
				};
				editor ??= new VectorNodeEditor({
					...options,
					onEditingChanged: () => host?.requestRender()
				});
				pen ??= new VectorPenTool({
					...options,
					creation
				});
				return true;
			};
			const enterEdit = () => {
				if (!ensureTools()) return false;
				if (host?.isSelectionEnabled?.() === false) return false;
				const ids = boundSelection.getSelection();
				if (ids.length !== 1 || !context.world.getCanonical(ids[0], "vector.path")) return false;
				pen?.cancel();
				return editor.enter(ids[0]);
			};
			ensureTools();
			const disposers = [
				context.commands.register({
					id: "vector:pen-tool",
					title: "펜 도구",
					summary: "클릭으로 직선, 드래그로 곡선 정점을 추가합니다.",
					keys: ["p"],
					shortcutScope: "canvas",
					run: () => {
						if (context.commands.get("canvas:select-tool")) context.commands.execute("canvas:select-tool");
						if (ensureTools()) {
							editor?.exit();
							pen.enter();
							surface.element.focus();
						}
					}
				}),
				context.commands.register({
					id: "vector:enter-edit",
					title: "벡터 경로 편집",
					summary: "선택한 벡터의 정점과 핸들을 직접 편집합니다.",
					keys: ["enter"],
					shortcutScope: "canvas",
					shortcutSelectionAspect: "vector.path",
					run: enterEdit
				}),
				context.commands.register({
					id: "vector:toggle-fill",
					title: "벡터 채우기 켜기 / 끄기",
					summary: "선택한 벡터의 채우기를 전환합니다.",
					run: () => {
						ensureTools();
						editor?.exit();
						const patches = (boundSelection?.getSelection() ?? []).flatMap((id) => {
							const props = context.world.getCanonical(id, "vector.path");
							return props && !context.world.isEntityReadOnly(id) ? [{
								id,
								aspect: "vector.path",
								patch: { fill: props.fill === "none" ? "#008FF0" : "none" }
							}] : [];
						});
						if (!patches.length) return;
						host.history.begin();
						try {
							context.world.applyCanonicalTransaction("vector:toggle-fill", patches, "local:user");
							host.history.commit();
						} catch (error) {
							host.history.abort();
							throw error;
						}
					}
				})
			];
			if (activeSurface) disposers.push(activeSurface.subscribe(() => {
				ensureTools();
			}));
			for (const [mode, title] of [
				["none", "독립 핸들"],
				["angle", "각도만 대칭"],
				["angle-and-length", "각도와 길이 대칭"]
			]) disposers.push(context.commands.register({
				id: `vector:mirror-${mode}`,
				title: `벡터 정점 · ${title}`,
				summary: "정점 편집 중 선택한 정점에 적용합니다.",
				run: () => editor?.setSelectedMirroring(mode)
			}));
			for (const [radius, name] of [[12, "round"], [0, "sharp"]]) disposers.push(context.commands.register({
				id: `vector:corners-${name}`,
				title: radius ? "벡터 정점 · 모서리 둥글게" : "벡터 정점 · 둥글기 제거",
				summary: "정점 편집 중 선택한 모서리에 적용합니다.",
				run: () => editor?.setSelectedCornerRadius(radius)
			}));
			const input = context.services.get("canvas.tool-input");
			if (input) disposers.push(input.register("vector.pen-suite", { handleKeyDown(event) {
				if (!ensureTools()) return false;
				if (pen?.isActive) return pen.handleKeyDown(event);
				if (editor?.editingEntityId) return editor.handleKeyDown(event);
				return event.key === "Enter" && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && enterEdit();
			} }));
			return () => {
				for (const off of disposers.reverse()) off();
				pen?.dispose();
				editor?.dispose();
				editor = void 0;
			};
		}
	};
}
// src/render-gpu.ts
var cache = /* @__PURE__ */ new WeakMap();
/** Opt in only when the generic GPU polyline preserves the authored SVG style. */
function getVectorGpuPolyline(id, world) {
	if (!world.getExtension("vector.path")) return void 0;
	const geometry = world.getComputed(id, "computed.vector.path");
	if (!geometry) return void 0;
	const props = geometry.style;
	if (geometry.sampledContours.length !== 1 || geometry.sampledContours[0].closed || props.fill !== "none" && props.fill !== "transparent" && props.fillOpacity > 0 || props.strokeDash !== "solid" || props.strokeCap !== "round" || props.strokeJoin !== "round" || props.arrowStart || props.arrowEnd || props.strokeWidth <= 0 || !/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(props.stroke)) return void 0;
	const existing = cache.get(geometry);
	if (existing) return existing;
	const hex = props.stroke.length === 4 ? props.stroke.slice(1).split("").map((value) => value + value).join("") : props.stroke.slice(1);
	const rgb = Number.parseInt(hex, 16);
	const line = {
		points: geometry.sampledContours[0].points,
		endTangent: geometry.sampledContours[0].endTangent,
		strokeWidth: props.strokeWidth,
		strokeCap: "round",
		strokeJoin: "round",
		color: [
			(rgb >> 16) / 255,
			(rgb >> 8 & 255) / 255,
			(rgb & 255) / 255,
			1
		]
	};
	cache.set(geometry, line);
	return line;
}
// src/plugin.ts
var spec = createVectorPathExtension();
var plugin_default = {
	...spec,
	...createPackageManifest(extension_default),
	summary: extension_default.summary,
	activate(context) {
		const off = context.services.get("canvas.gpu-contributions")?.register({ getPolyline: getVectorGpuPolyline });
		try {
			const dispose = spec.activate?.(context);
			return () => {
				try {
					if (typeof dispose === "function") dispose();
					else dispose?.dispose();
				} finally {
					off?.();
				}
			};
		} catch (error) {
			off?.();
			throw error;
		}
	}
};
export { plugin_default as default };

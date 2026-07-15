// scene.ts — Box-ops (inkl. yaw), ray/golv, ray/obb, stabling (§2 treff, §3 datamodell)

import { rotX, rotY, vadd, vscale, vsub, type CameraState, type V3 } from './projection';
import { defaultCamera } from './camera';

// mm; yaw (kring +y) og valfri pitch (kring lokal +x, etter yaw), begge kring sentroid.
// grp bind delboksar saman til éin figur (mannekeng): flytt/rotér/slett som eining.
export type Box = { id: string; min: V3; size: V3; yaw: number; pitch?: number; grp?: string };
export type Ray = { origin: V3; dir: V3 };

export type Settings = {
	fit: 'inscribe' | 'cover';
	gridX: boolean;
	gridY: boolean;
	gridZ: boolean;
	floor: boolean;
	horizon: boolean;
	vps: boolean;
	jitter: boolean;
	moduleTicks: boolean;
	maskFaces: boolean;
	theme: 'light' | 'dark';
	locked: boolean; // referanselås: ingen redigering/kamera før opplåsing
};

// versjon 3: boksar kan ha pitch og grp (mannekeng); v2 var cover-default-skiftet
export type Doc = { version: 3; boxes: Box[]; camera: CameraState; settings: Settings };

export function defaultSettings(): Settings {
	return {
		fit: 'cover', // heile skjermen er papir; innskriven sirkel er valet (c)
		gridX: true,
		gridY: true,
		gridZ: true,
		floor: true,
		horizon: true,
		vps: true,
		jitter: false,
		moduleTicks: false,
		maskFaces: false,
		theme: 'light',
		locked: false
	};
}

export function defaultDoc(): Doc {
	return { version: 3, boxes: [], camera: defaultCamera(), settings: defaultSettings() };
}
export type Face = 'top' | 'bottom' | 'side';
export type Hit = { box: Box; t: number; point: V3; normal: V3; face: Face };

export const FIGURBOKS = { w: 500, h: 1750, d: 300 } as const; // ståande menneske, kjg-proxy

export const SNAP_MM = 50;
export const SNAP_YAW = (15 * Math.PI) / 180;

export function snapMm(v: number, step = SNAP_MM): number {
	return Math.round(v / step) * step;
}

// intern eining er mm (§2); grensesnittet viser meter sidan alt er menneskeskala.
// 1780 → "1.78", 300 → "0.3", 10000 → "10"
export function formatM(mm: number): string {
	const m = mm / 1000;
	const s = Math.abs(m) >= 10 ? m.toFixed(1) : m.toFixed(2);
	return s.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}

export function snapYaw(a: number, step = SNAP_YAW): number {
	return Math.round(a / step) * step;
}

export function centroid(b: Box): V3 {
	return [b.min[0] + b.size[0] / 2, b.min[1] + b.size[1] / 2, b.min[2] + b.size[2] / 2];
}

// lokal → verd for retningar: rotY(yaw)·rotX(pitch)
export function orientBox(v: V3, b: Box): V3 {
	return rotY(b.pitch ? rotX(v, b.pitch) : v, b.yaw);
}

// verd → lokal: rotX(−pitch)·rotY(−yaw)
export function unorientBox(v: V3, b: Box): V3 {
	const r = rotY(v, -b.yaw);
	return b.pitch ? rotX(r, -b.pitch) : r;
}

// 8 hjørne i verdskoordinatar (yaw+pitch kring sentroid). bit0=x, bit1=z, bit2=y.
export function boxCorners(b: Box): V3[] {
	const c = centroid(b);
	const h: V3 = [b.size[0] / 2, b.size[1] / 2, b.size[2] / 2];
	const out: V3[] = [];
	for (let i = 0; i < 8; i++) {
		const local: V3 = [
			(i & 1 ? 1 : -1) * h[0],
			(i & 4 ? 1 : -1) * h[1],
			(i & 2 ? 1 : -1) * h[2]
		];
		out.push(vadd(c, orientBox(local, b)));
	}
	return out;
}

export const EDGE_IDX: Array<[number, number]> = [
	// botn (y−)
	[0, 1],
	[1, 3],
	[3, 2],
	[2, 0],
	// topp (y+)
	[4, 5],
	[5, 7],
	[7, 6],
	[6, 4],
	// vertikalar
	[0, 4],
	[1, 5],
	[3, 7],
	[2, 6]
];

export const VERTICAL_EDGE_START = 8; // indeks der vertikalane byrjar i boxEdges

export function boxEdges(b: Box): Array<[V3, V3]> {
	const c = boxCorners(b);
	return EDGE_IDX.map(([i, j]) => [c[i], c[j]]);
}

// golvtreff: krev d.y < 0 og t > 0
export function rayFloor(ray: Ray): V3 | null {
	if (ray.dir[1] >= -1e-12) return null;
	const t = -ray.origin[1] / ray.dir[1];
	if (t <= 0) return null;
	return vadd(ray.origin, vscale(ray.dir, t));
}

// treff mot vilkårleg horisontalplan y = h (for basisplan/stabling)
export function rayPlaneY(ray: Ray, y: number): V3 | null {
	if (Math.abs(ray.dir[1]) < 1e-12) return null;
	const t = (y - ray.origin[1]) / ray.dir[1];
	if (t <= 1e-9) return null;
	return vadd(ray.origin, vscale(ray.dir, t));
}

// obb-treff: strålen inn i boksens lokale ramme (trekk frå sentroid, inverter orientering), så slab-test
export function rayBox(ray: Ray, b: Box): Hit | null {
	const c = centroid(b);
	const o = unorientBox(vsub(ray.origin, c), b);
	const d = unorientBox(ray.dir, b);
	const h: V3 = [b.size[0] / 2, b.size[1] / 2, b.size[2] / 2];

	let tmin = -Infinity;
	let tmax = Infinity;
	let axis = -1;
	let sign = 1;

	for (let i = 0; i < 3; i++) {
		if (Math.abs(d[i]) < 1e-12) {
			if (Math.abs(o[i]) > h[i]) return null;
			continue;
		}
		const inv = 1 / d[i];
		let tNear = (-h[i] - o[i]) * inv;
		let tFar = (h[i] - o[i]) * inv;
		let s = -Math.sign(d[i]);
		if (tNear > tFar) {
			const tmp = tNear;
			tNear = tFar;
			tFar = tmp;
		}
		if (tNear > tmin) {
			tmin = tNear;
			axis = i;
			sign = s;
		}
		if (tFar < tmax) tmax = tFar;
		if (tmin > tmax) return null;
	}

	if (axis < 0 || tmin <= 1e-9) return null; // opphav inne i boksen: berre inngangstreff tel
	const nLocal: V3 = [0, 0, 0];
	nLocal[axis] = sign;
	const normal = orientBox(nLocal, b);
	const point = vadd(ray.origin, vscale(ray.dir, tmin));
	const face: Face = axis === 1 ? (sign > 0 ? 'top' : 'bottom') : 'side';
	return { box: b, t: tmin, point, normal, face };
}

// er punktet inne i boksen? (til kamera-i-boks-vakta for presetar)
export function pointInBox(p: V3, b: Box): boolean {
	const c = centroid(b);
	const l = unorientBox(vsub(p, c), b);
	return (
		Math.abs(l[0]) <= b.size[0] / 2 &&
		Math.abs(l[1]) <= b.size[1] / 2 &&
		Math.abs(l[2]) <= b.size[2] / 2
	);
}

export function raycast(boxes: readonly Box[], ray: Ray): Hit | null {
	let best: Hit | null = null;
	for (const b of boxes) {
		const hit = rayBox(ray, b);
		if (hit && (!best || hit.t < best.t)) best = hit;
	}
	return best;
}

// stabling: fyrste treff på topp-flate (normal +y) gjev basisplan y = flatas høgd; elles golvet (0)
export function stackBaseY(boxes: readonly Box[], ray: Ray): number {
	const hits: Hit[] = [];
	for (const b of boxes) {
		const hit = rayBox(ray, b);
		if (hit) hits.push(hit);
	}
	hits.sort((a, b) => a.t - b.t);
	for (const h of hits) {
		if (h.face === 'top') return h.box.min[1] + h.box.size[1];
	}
	return 0;
}

// fotavtrykk (to golvpunkt) + basisplan + høgd → normalisert boks
export function makeBoxFromFootprint(
	id: string,
	a: [number, number],
	b: [number, number],
	baseY: number,
	height: number,
	yaw = 0
): Box {
	const x0 = Math.min(a[0], b[0]);
	const x1 = Math.max(a[0], b[0]);
	const z0 = Math.min(a[1], b[1]);
	const z1 = Math.max(a[1], b[1]);
	return { id, min: [x0, baseY, z0], size: [x1 - x0, height, z1 - z0], yaw };
}

// figurboks-stempel: sentrert på (px,pz), front (+z lokalt) vend mot kameraet
export function figureBoxAt(id: string, px: number, pz: number, baseY: number, camPos: V3): Box {
	const yaw = Math.atan2(camPos[0] - px, camPos[2] - pz);
	return {
		id,
		min: [px - FIGURBOKS.w / 2, baseY, pz - FIGURBOKS.d / 2],
		size: [FIGURBOKS.w, FIGURBOKS.h, FIGURBOKS.d],
		yaw
	};
}

let idCounter = 0;

export function newId(): string {
	const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
	if (c?.randomUUID) return c.randomUUID().slice(0, 8);
	idCounter += 1;
	return `b${idCounter.toString(36)}${Date.now().toString(36)}`;
}

export function cloneBox(b: Box, id?: string): Box {
	const out: Box = { id: id ?? newId(), min: [...b.min], size: [...b.size], yaw: b.yaw };
	if (b.pitch) out.pitch = b.pitch;
	if (b.grp) out.grp = b.grp;
	return out;
}

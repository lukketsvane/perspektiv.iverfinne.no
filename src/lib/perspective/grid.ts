// grid.ts — storsirkelfamiliar, golvgrid, horisont, vp-ar (§5)

import type { V3 } from './projection';

export type CirclePair = { u: V3; v: V3 };

// storsirklar som inneheld verdsaksen `axis`, roterte kvar `stepDeg`.
// y-familien er biletet av alle vertikalar; x/z er guidar for horisontalar.
export function greatCircleFamily(axis: 0 | 1 | 2, stepDeg = 15): CirclePair[] {
	const n = Math.round(180 / stepDeg);
	const out: CirclePair[] = [];
	for (let k = 0; k < n; k++) {
		const a = (k * stepDeg * Math.PI) / 180;
		const c = Math.cos(a);
		const s = Math.sin(a);
		if (axis === 1) out.push({ u: [0, 1, 0], v: [c, 0, -s] });
		else if (axis === 0) out.push({ u: [1, 0, 0], v: [0, c, s] });
		else out.push({ u: [0, 0, 1], v: [c, s, 0] });
	}
	return out;
}

// horisonten: storsirkelen d.y = 0
export const HORIZON: CirclePair = { u: [1, 0, 0], v: [0, 0, 1] };

export function vpList(): Array<{ d: V3; label: string }> {
	return [
		{ d: [1, 0, 0], label: '+x' },
		{ d: [-1, 0, 0], label: '−x' },
		{ d: [0, 1, 0], label: '+y' },
		{ d: [0, -1, 0], label: '−y' },
		{ d: [0, 0, 1], label: '+z' },
		{ d: [0, 0, -1], label: '−z' }
	];
}

export const FLOOR_FINE_STEP = 100;
export const FLOOR_FINE_RADIUS = 5000;
export const FLOOR_COARSE_STEP = 1000;
export const FLOOR_COARSE_RADIUS = 30000;

// verdslåste golvliner (y=0) klipte til sirklar kring kamerafoten
export function floorGridSegments(camPos: V3): {
	fine: Array<[V3, V3]>;
	coarse: Array<[V3, V3]>;
} {
	const fine: Array<[V3, V3]> = [];
	const coarse: Array<[V3, V3]> = [];
	buildDisc(fine, camPos, FLOOR_FINE_STEP, FLOOR_FINE_RADIUS);
	buildDisc(coarse, camPos, FLOOR_COARSE_STEP, FLOOR_COARSE_RADIUS);
	return { fine, coarse };
}

function buildDisc(out: Array<[V3, V3]>, camPos: V3, step: number, radius: number): void {
	const cx = camPos[0];
	const cz = camPos[2];
	const r2 = radius * radius;
	for (let k = Math.ceil((cx - radius) / step); k * step <= cx + radius; k++) {
		const x = k * step;
		const d2 = r2 - (x - cx) * (x - cx);
		if (d2 <= 0) continue;
		const half = Math.sqrt(d2);
		out.push([
			[x, 0, cz - half],
			[x, 0, cz + half]
		]);
	}
	for (let k = Math.ceil((cz - radius) / step); k * step <= cz + radius; k++) {
		const z = k * step;
		const d2 = r2 - (z - cz) * (z - cz);
		if (d2 <= 0) continue;
		const half = Math.sqrt(d2);
		out.push([
			[cx - half, 0, z],
			[cx + half, 0, z]
		]);
	}
}

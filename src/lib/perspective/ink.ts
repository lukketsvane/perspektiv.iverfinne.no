// ink.ts — blekk-geometri for M6: avstandsvekta linjevekt, hovudmodul-merke,
// kvitmaska flater (pseudo-okklusjon), deterministisk jitter.
// rein modul: produserer polylinjer; canvas og svg teiknar.

import { project, type Frame, type V3 } from './projection';
import { sampleSegment, type Polyline, type SampleOpts } from './sample';
import { boxCorners, centroid, EDGE_IDX, orientBox, VERTICAL_EDGE_START, type Box, type Doc } from './scene';

export const INK_W_NEAR = 2.0;
export const INK_W_FAR = 0.8;
const D_NEAR = 800; // mm: nærare enn dette → full vekt
const D_FAR = 16000; // mm: lenger enn dette → minstevekt
export const MODULE_DIVS = 8; // 8-hovuds figurpraksis

// flateloopar (hjørneindeksar frå boxCorners: bit0=x+, bit1=z+, bit2=y+)
const FACES: Array<{ loop: [number, number, number, number]; normal: V3 }> = [
	{ loop: [0, 2, 6, 4], normal: [-1, 0, 0] },
	{ loop: [1, 3, 7, 5], normal: [1, 0, 0] },
	{ loop: [0, 1, 5, 4], normal: [0, 0, -1] },
	{ loop: [2, 3, 7, 6], normal: [0, 0, 1] },
	{ loop: [0, 1, 3, 2], normal: [0, -1, 0] },
	{ loop: [4, 5, 7, 6], normal: [0, 1, 0] }
];

export function inkWidth(distMm: number): number {
	const inv = 1 / Math.max(1, distMm);
	const t = Math.min(1, Math.max(0, (inv - 1 / D_FAR) / (1 / D_NEAR - 1 / D_FAR)));
	const w = INK_W_FAR + (INK_W_NEAR - INK_W_FAR) * t;
	return Math.round(w * 10) / 10; // bøtter på 0.1 px for batching
}

export type BoxInk = {
	id: string;
	distMm: number;
	// papirfylte, kameravende flater (malar-rekkjefylgje handterast av mottakaren)
	fills: Polyline[][];
	// kantstrøk gruppert på breidd
	strokes: Array<{ w: number; lines: Polyline[] }>;
	ticks: Polyline[];
};

export type InkOpts = {
	maskFaces: boolean;
	moduleTicks: boolean;
	sample?: SampleOpts;
};

// snu retninga på ein kant-sampel (liste av polylinjer)
function reverseLines(lines: Polyline[]): Polyline[] {
	const out: Polyline[] = [];
	for (let li = lines.length - 1; li >= 0; li--) {
		const l = lines[li];
		const r: Polyline = [];
		for (let i = l.length - 2; i >= 0; i -= 2) r.push(l[i], l[i + 1]);
		out.push(r);
	}
	return out;
}

// oppslagsnøkkel hjørnepar → kantindeks + retning
const EDGE_LOOKUP = new Map<string, { e: number; rev: boolean }>();
EDGE_IDX.forEach(([i, j], e) => {
	EDGE_LOOKUP.set(`${i}-${j}`, { e, rev: false });
	EDGE_LOOKUP.set(`${j}-${i}`, { e, rev: true });
});

export function buildBoxInk(f: Frame, b: Box, opts: InkOpts): BoxInk {
	const so: SampleOpts = { camPos: f.pos, ...opts.sample };
	const P = (p: V3) => project(f, p);
	const corners = boxCorners(b);
	const c = centroid(b);
	const distMm = Math.hypot(c[0] - f.pos[0], c[1] - f.pos[1], c[2] - f.pos[2]);

	// sampl kvar av dei 12 kantane nøyaktig éin gong; flatene gjenbrukar
	const edgeLines: Polyline[][] = EDGE_IDX.map(([i, j]) =>
		sampleSegment(P, corners[i], corners[j], so)
	);

	// flater (berre kameravende)
	const fills: Polyline[][] = [];
	if (opts.maskFaces) {
		for (const face of FACES) {
			const nWorld = orientBox(face.normal, b);
			// flatesentrum
			const fc: V3 = [0, 0, 0];
			for (const i of face.loop) {
				fc[0] += corners[i][0] / 4;
				fc[1] += corners[i][1] / 4;
				fc[2] += corners[i][2] / 4;
			}
			const toFace: V3 = [fc[0] - f.pos[0], fc[1] - f.pos[1], fc[2] - f.pos[2]];
			if (nWorld[0] * toFace[0] + nWorld[1] * toFace[1] + nWorld[2] * toFace[2] >= 0) continue;
			const loop: Polyline[] = [];
			for (let e = 0; e < 4; e++) {
				const hit = EDGE_LOOKUP.get(`${face.loop[e]}-${face.loop[(e + 1) % 4]}`);
				if (!hit) continue;
				loop.push(...(hit.rev ? reverseLines(edgeLines[hit.e]) : edgeLines[hit.e]));
			}
			if (loop.length) fills.push(loop);
		}
	}

	// kantar med avstandsvekta breidd
	const buckets = new Map<number, Polyline[]>();
	for (let e = 0; e < EDGE_IDX.length; e++) {
		const [i, j] = EDGE_IDX[e];
		const a = corners[i];
		const d = corners[j];
		const mid: V3 = [(a[0] + d[0]) / 2, (a[1] + d[1]) / 2, (a[2] + d[2]) / 2];
		const w = inkWidth(Math.hypot(mid[0] - f.pos[0], mid[1] - f.pos[1], mid[2] - f.pos[2]));
		const lines = edgeLines[e];
		if (!lines.length) continue;
		const arr = buckets.get(w);
		if (arr) arr.push(...lines);
		else buckets.set(w, [...lines]);
	}
	const strokes = [...buckets.entries()].map(([w, lines]) => ({ w, lines }));

	// hovudmodul-merke: tick kvar 1/8 av h på dei fire vertikale kantane
	const ticks: Polyline[] = [];
	if (opts.moduleTicks) {
		for (let e = VERTICAL_EDGE_START; e < VERTICAL_EDGE_START + 4; e++) {
			const [i, j] = EDGE_IDX[e];
			const a = corners[i];
			const d = corners[j];
			for (let k = 1; k < MODULE_DIVS; k++) {
				const t = k / MODULE_DIVS;
				const p: V3 = [
					a[0] + (d[0] - a[0]) * t,
					a[1] + (d[1] - a[1]) * t,
					a[2] + (d[2] - a[2]) * t
				];
				const p2: V3 = [
					a[0] + (d[0] - a[0]) * (t + 0.004),
					a[1] + (d[1] - a[1]) * (t + 0.004),
					a[2] + (d[2] - a[2]) * (t + 0.004)
				];
				const s0 = P(p);
				const s1 = P(p2);
				if (!s0.visible || !s1.visible) continue;
				const l = Math.hypot(s1.x - s0.x, s1.y - s0.y);
				if (l < 1e-6) continue;
				// normal til den projiserte kanten
				const nx = -(s1.y - s0.y) / l;
				const ny = (s1.x - s0.x) / l;
				const half = k === MODULE_DIVS / 2 ? 3.4 : 2.2; // midtmerket (4/8) litt lengre
				ticks.push([s0.x - nx * half, s0.y - ny * half, s0.x + nx * half, s0.y + ny * half]);
			}
		}
	}

	return { id: b.id, distMm, fills, strokes, ticks };
}

// bygg blekk for heile scena, sortert på sentroid-djupn (fjernast fyrst)
export function buildInk(f: Frame, doc: Doc, opts: InkOpts): BoxInk[] {
	const out = doc.boxes.map((b) => buildBoxInk(f, b, opts));
	out.sort((a, b) => b.distMm - a.distMm);
	return out;
}

// deterministisk jitter: hash på (seed, linjeindeks, punktindeks); endepunkt uendra
export function jitterPolylines(lines: Polyline[], seed: number, amp = 0.45): Polyline[] {
	const out: Polyline[] = [];
	for (let li = 0; li < lines.length; li++) {
		const l = lines[li];
		const j = l.slice();
		for (let i = 2; i + 3 < l.length; i += 2) {
			let h = (seed ^ (li * 0x9e3779b1) ^ (i * 0x85ebca6b)) >>> 0;
			h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
			h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
			const a = ((h & 0xffff) / 0xffff - 0.5) * 2 * amp;
			const bnoise = (((h >>> 16) & 0xffff) / 0xffff - 0.5) * 2 * amp;
			j[i] = l[i] + a;
			j[i + 1] = l[i + 1] + bnoise;
		}
		out.push(j);
	}
	return out;
}

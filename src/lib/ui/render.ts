// render.ts — teiknar polylinjer frå perspektivkjerna til canvas. inga interaksjonslogikk her.

import {
	makeFrame,
	project,
	projectDir,
	isPano,
	type Frame,
	type V3
} from '../perspective/projection';
import {
	sampleDirLoop,
	sampleSegment,
	type Polyline,
	type SampleOpts
} from '../perspective/sample';
import { boxEdges, type Box, type Doc } from '../perspective/scene';
import { buildInk, jitterPolylines } from '../perspective/ink';
import { floorGridSegments, greatCircleFamily, HORIZON, vpList } from '../perspective/grid';

const JITTER_SEED = 0x5eed;

export const PAPER = '#f7f4ee';
export const INK = '#1a1a1c';
export const RED = '#c8232e';
export const BLUE = '#1155cc';

export type View = { w: number; h: number };

export type Overlay = {
	selection?: string | null;
	ghost?: Box | null; // boks under teikning/ekstrudering
	footprint?: [[number, number], [number, number], number] | null; // [a, b, baseY] på golvet
	pressRing?: { x: number; y: number; t: number } | null; // long-press-progress 0..1
};

function strokeLines(
	ctx: CanvasRenderingContext2D,
	lines: Polyline[],
	style: string,
	width: number,
	alpha: number
): void {
	if (lines.length === 0) return;
	ctx.globalAlpha = alpha;
	ctx.strokeStyle = style;
	ctx.lineWidth = width;
	ctx.beginPath();
	for (const l of lines) {
		ctx.moveTo(l[0], l[1]);
		for (let i = 2; i + 1 < l.length; i += 2) ctx.lineTo(l[i], l[i + 1]);
	}
	ctx.stroke();
	ctx.globalAlpha = 1;
}

function boxLines(f: Frame, b: Box, so: SampleOpts): Polyline[] {
	const P = (p: V3) => project(f, p);
	const out: Polyline[] = [];
	for (const [a, c] of boxEdges(b)) out.push(...sampleSegment(P, a, c, so));
	return out;
}

// fyll ein flateloop (fleire polylinjedelar vert kopla med rette liner)
function fillLoop(ctx: CanvasRenderingContext2D, loop: Polyline[], style: string): void {
	if (loop.length === 0) return;
	ctx.fillStyle = style;
	ctx.beginPath();
	let started = false;
	for (const l of loop) {
		for (let i = 0; i + 1 < l.length; i += 2) {
			if (!started) {
				ctx.moveTo(l[i], l[i + 1]);
				started = true;
			} else {
				ctx.lineTo(l[i], l[i + 1]);
			}
		}
	}
	if (started) {
		ctx.closePath();
		ctx.fill();
	}
}

// grid-cache (§8): retningslaga (storsirklar, horisont) er uavhengige av
// kameraposisjonen og vert berre reprosjiserte ved orienterings-/fov-/view-endring;
// golvgridet i tillegg ved posisjonsendring.
type GridCache = {
	dirKey: string;
	families: [Polyline[], Polyline[], Polyline[]];
	horizon: Polyline[];
	floorKey: string;
	floorFine: Polyline[];
	floorCoarse: Polyline[];
};
const cache: GridCache = {
	dirKey: '',
	families: [[], [], []],
	horizon: [],
	floorKey: '',
	floorFine: [],
	floorCoarse: []
};

export function renderScene(
	ctx: CanvasRenderingContext2D,
	doc: Doc,
	view: View,
	overlay: Overlay = {}
): Frame {
	const f = makeFrame(doc.camera, { w: view.w, h: view.h, fit: doc.settings.fit });
	const D = (d: V3) => projectDir(f, d);
	const pano = isPano(doc.camera.proj);
	const so: SampleOpts = { camPos: f.pos, maxJumpPx: pano ? view.w / 3 : undefined };
	const gridSo: SampleOpts = { ...so, eps: 0.5 };
	const floorSo: SampleOpts = { ...so, eps: 0.8 };
	const cam = doc.camera;
	const s = doc.settings;

	ctx.fillStyle = PAPER;
	ctx.fillRect(0, 0, view.w, view.h);

	const inscribe = doc.settings.fit !== 'cover' && !pano;
	ctx.save();
	if (inscribe) {
		ctx.beginPath();
		ctx.arc(f.cx, f.cy, f.R, 0, Math.PI * 2);
		ctx.clip();
	}
	ctx.lineJoin = 'round';
	ctx.lineCap = 'round';

	const dirKey = `${cam.yaw}|${cam.pitch}|${cam.fov}|${cam.proj}|${f.R}|${f.cx}|${f.cy}|${f.w}x${f.h}|${s.gridX}${s.gridY}${s.gridZ}${s.horizon}`;
	if (cache.dirKey !== dirKey) {
		cache.dirKey = dirKey;
		const axes: Array<[boolean, 0 | 1 | 2]> = [
			[s.gridX, 0],
			[s.gridY, 1],
			[s.gridZ, 2]
		];
		for (const [on, axis] of axes) {
			const lines: Polyline[] = [];
			if (on)
				for (const { u, v } of greatCircleFamily(axis))
					lines.push(...sampleDirLoop(D, u, v, gridSo));
			cache.families[axis] = lines;
		}
		cache.horizon = s.horizon ? sampleDirLoop(D, HORIZON.u, HORIZON.v, so) : [];
	}

	const floorKey = `${dirKey}|${f.pos[0]},${f.pos[1]},${f.pos[2]}|${s.floor}`;
	if (cache.floorKey !== floorKey) {
		cache.floorKey = floorKey;
		cache.floorFine = [];
		cache.floorCoarse = [];
		if (s.floor) {
			const { fine, coarse } = floorGridSegments(f.pos);
			const P = (p: V3) => project(f, p);
			for (const [a, b] of fine) cache.floorFine.push(...sampleSegment(P, a, b, floorSo));
			for (const [a, b] of coarse) cache.floorCoarse.push(...sampleSegment(P, a, b, floorSo));
		}
	}

	// golvgrid (verdslåst, klipt til skiver kring kamerafoten)
	strokeLines(ctx, cache.floorFine, RED, 0.6, 0.22);
	strokeLines(ctx, cache.floorCoarse, RED, 0.6, 0.4);

	// raudgrid: tre storsirkelfamiliar, éi per verdsakse
	for (const lines of cache.families) strokeLines(ctx, lines, RED, 0.6, 0.55);

	// horisont med mm-merke for augehøgda
	if (doc.settings.horizon) {
		strokeLines(ctx, cache.horizon, RED, 1.0, 0.8);
		const ahead: V3 = [-Math.sin(doc.camera.yaw), 0, -Math.cos(doc.camera.yaw)];
		const s = D(ahead);
		if (s.visible) {
			ctx.globalAlpha = 0.8;
			ctx.fillStyle = RED;
			ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
			ctx.textAlign = 'left';
			ctx.textBaseline = 'bottom';
			ctx.fillText(`${Math.round(doc.camera.pos[1])} mm`, s.x + 8, s.y - 4);
			ctx.globalAlpha = 1;
		}
	}

	// vp-prikkar med liten label
	if (doc.settings.vps) {
		ctx.fillStyle = RED;
		ctx.font = '9px ui-monospace, SFMono-Regular, Menlo, monospace';
		ctx.textAlign = 'left';
		ctx.textBaseline = 'top';
		for (const { d, label } of vpList()) {
			const s = D(d);
			if (!s.visible) continue;
			const xs = pano ? panoRepeats(f, s.x) : [s.x];
			for (const x of xs) {
				ctx.globalAlpha = 0.9;
				ctx.beginPath();
				ctx.arc(x, s.y, 2.4, 0, Math.PI * 2);
				ctx.fill();
				ctx.globalAlpha = 0.75;
				ctx.fillText(label, x + 5, s.y + 3);
			}
		}
		ctx.globalAlpha = 1;
	}

	// blekk: boksane (M6: avstandsvekta vekt, masker, modul-merke, jitter)
	const sel = overlay.selection ?? null;
	const inkBoxes = buildInk(f, doc, {
		maskFaces: s.maskFaces,
		moduleTicks: s.moduleTicks,
		sample: so
	});
	const jit = (lines: Polyline[]) => (s.jitter ? jitterPolylines(lines, JITTER_SEED) : lines);

	if (s.maskFaces) {
		// malar-rekkjefylgje (fjernast fyrst): kvar boks maskar det bak seg
		for (const bi of inkBoxes) {
			for (const loop of bi.fills) fillLoop(ctx, loop, PAPER);
			const blue = bi.id === sel;
			for (const { w, lines } of bi.strokes)
				strokeLines(ctx, jit(lines), blue ? BLUE : INK, blue ? 1.2 : w, 0.95);
			if (bi.ticks.length)
				strokeLines(ctx, jit(bi.ticks), blue ? BLUE : INK, 0.9, 0.85);
		}
	} else {
		// rask veg: globale breidd-bøtter
		const buckets = new Map<number, Polyline[]>();
		const ticks: Polyline[] = [];
		let selInk: Polyline[] = [];
		let selTicks: Polyline[] = [];
		for (const bi of inkBoxes) {
			if (bi.id === sel) {
				for (const st of bi.strokes) selInk.push(...st.lines);
				selTicks = bi.ticks;
				continue;
			}
			for (const { w, lines } of bi.strokes) {
				const arr = buckets.get(w);
				if (arr) arr.push(...lines);
				else buckets.set(w, [...lines]);
			}
			ticks.push(...bi.ticks);
		}
		for (const [w, lines] of buckets) strokeLines(ctx, jit(lines), INK, w, 0.95);
		if (ticks.length) strokeLines(ctx, jit(ticks), INK, 0.9, 0.85);
		if (selInk.length) strokeLines(ctx, jit(selInk), BLUE, 1.2, 0.95);
		if (selTicks.length) strokeLines(ctx, jit(selTicks), BLUE, 0.9, 0.85);
	}

	// gest-spøkjelse: fotavtrykk under oppteikning
	if (overlay.footprint) {
		const [a, b, y] = overlay.footprint;
		const P = (p: V3) => project(f, p);
		const corners: V3[] = [
			[a[0], y, a[1]],
			[b[0], y, a[1]],
			[b[0], y, b[1]],
			[a[0], y, b[1]]
		];
		const lines: Polyline[] = [];
		for (let i = 0; i < 4; i++)
			lines.push(...sampleSegment(P, corners[i], corners[(i + 1) % 4], so));
		strokeLines(ctx, lines, BLUE, 1.2, 0.9);
	}

	// gest-spøkjelse: boks under ekstrudering/flytting
	if (overlay.ghost) {
		strokeLines(ctx, boxLines(f, overlay.ghost, so), BLUE, 1.2, 0.9);
	}

	ctx.restore();

	// fiskeaugeranda
	if (inscribe) {
		ctx.globalAlpha = 0.5;
		ctx.strokeStyle = INK;
		ctx.lineWidth = 1;
		ctx.beginPath();
		ctx.arc(f.cx, f.cy, f.R, 0, Math.PI * 2);
		ctx.stroke();
		ctx.globalAlpha = 1;
	}

	// long-press progressring (touch-slett)
	if (overlay.pressRing) {
		const { x, y, t } = overlay.pressRing;
		ctx.strokeStyle = BLUE;
		ctx.lineWidth = 2;
		ctx.globalAlpha = 0.85;
		ctx.beginPath();
		ctx.arc(x, y, 22, -Math.PI / 2, -Math.PI / 2 + t * Math.PI * 2);
		ctx.stroke();
		ctx.globalAlpha = 1;
	}

	return f;
}

// gjentekne vp-ar langs horisonten i panorama (periode = full breidd)
function panoRepeats(f: Frame, x: number): number[] {
	const period = f.kh * 2 * Math.PI;
	const out: number[] = [];
	for (let k = -2; k <= 2; k++) {
		const xx = x + k * period;
		if (xx >= -20 && xx <= f.w + 20) out.push(xx);
	}
	return out;
}

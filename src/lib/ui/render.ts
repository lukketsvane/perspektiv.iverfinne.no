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
import { floorGridSegments, greatCircleFamily, HORIZON, vpList } from '../perspective/grid';

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

	// golvgrid (verdslåst, klipt til skiver kring kamerafoten)
	if (doc.settings.floor) {
		const { fine, coarse } = floorGridSegments(f.pos);
		const P = (p: V3) => project(f, p);
		const fineLines: Polyline[] = [];
		for (const [a, b] of fine) fineLines.push(...sampleSegment(P, a, b, gridSo));
		strokeLines(ctx, fineLines, RED, 0.6, 0.22);
		const coarseLines: Polyline[] = [];
		for (const [a, b] of coarse) coarseLines.push(...sampleSegment(P, a, b, gridSo));
		strokeLines(ctx, coarseLines, RED, 0.6, 0.4);
	}

	// raudgrid: tre storsirkelfamiliar, éi per verdsakse
	const families: Array<[boolean, 0 | 1 | 2]> = [
		[doc.settings.gridX, 0],
		[doc.settings.gridY, 1],
		[doc.settings.gridZ, 2]
	];
	for (const [on, axis] of families) {
		if (!on) continue;
		const lines: Polyline[] = [];
		for (const { u, v } of greatCircleFamily(axis)) lines.push(...sampleDirLoop(D, u, v, gridSo));
		strokeLines(ctx, lines, RED, 0.6, 0.55);
	}

	// horisont med mm-merke for augehøgda
	if (doc.settings.horizon) {
		const lines = sampleDirLoop(D, HORIZON.u, HORIZON.v, so);
		strokeLines(ctx, lines, RED, 1.0, 0.8);
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

	// blekk: boksane
	const sel = overlay.selection ?? null;
	const inkLines: Polyline[] = [];
	let selLines: Polyline[] = [];
	for (const b of doc.boxes) {
		const lines = boxLines(f, b, so);
		if (b.id === sel) selLines = lines;
		else inkLines.push(...lines);
	}
	strokeLines(ctx, inkLines, INK, 1.4, 0.95);
	if (selLines.length) strokeLines(ctx, selLines, BLUE, 1.2, 0.95);

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

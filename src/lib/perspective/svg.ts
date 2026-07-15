// svg.ts — lag-eksport: g#raudgrid, g#golv, g#blekk, g#vp; clip-path sirkel (§6)
// same samplingspipeline som canvas; plottarvennlege polylinjer.

import { isPano, makeFrame, project, projectDir, type Frame, type V3 } from './projection';
import { sampleDirLoop, sampleSegment, type Polyline, type SampleOpts } from './sample';
import type { Doc } from './scene';
import { buildInk, jitterPolylines } from './ink';
import { floorGridSegments, greatCircleFamily, HORIZON, vpList } from './grid';

// bic-fargane (§5)
const PAPER = '#f7f4ee';
const INK = '#1a1a1c';
const RED = '#c8232e';

function fmt(n: number): string {
	return (Math.round(n * 100) / 100).toString();
}

function pathData(lines: Polyline[]): string {
	let d = '';
	for (const l of lines) {
		d += `M${fmt(l[0])} ${fmt(l[1])}`;
		for (let i = 2; i + 1 < l.length; i += 2) d += `L${fmt(l[i])} ${fmt(l[i + 1])}`;
	}
	return d;
}

function pathEl(lines: Polyline[], stroke: string, width: number, opacity: number): string {
	if (lines.length === 0) return '';
	return `<path d="${pathData(lines)}" fill="none" stroke="${stroke}" stroke-width="${width}" stroke-opacity="${opacity}" stroke-linejoin="round" stroke-linecap="round"/>`;
}

// papirfylt flateloop (delane vert kopla og lukka)
function fillEl(loop: Polyline[], fill: string): string {
	if (loop.length === 0) return '';
	let d = '';
	let started = false;
	for (const l of loop) {
		for (let i = 0; i + 1 < l.length; i += 2) {
			d += started ? `L${fmt(l[i])} ${fmt(l[i + 1])}` : `M${fmt(l[i])} ${fmt(l[i + 1])}`;
			started = true;
		}
	}
	return `<path d="${d}Z" fill="${fill}"/>`;
}

export function docToSvg(doc: Doc, view: { w: number; h: number }): string {
	const f: Frame = makeFrame(doc.camera, { w: view.w, h: view.h, fit: doc.settings.fit });
	const pano = isPano(doc.camera.proj);
	const so: SampleOpts = { camPos: f.pos, maxJumpPx: pano ? view.w / 3 : undefined };
	const P = (p: V3) => project(f, p);
	const D = (d: V3) => projectDir(f, d);
	const s = doc.settings;

	// golv
	let golv = '';
	if (s.floor) {
		const { fine, coarse } = floorGridSegments(f.pos);
		const fineLines: Polyline[] = [];
		for (const [a, b] of fine) fineLines.push(...sampleSegment(P, a, b, so));
		const coarseLines: Polyline[] = [];
		for (const [a, b] of coarse) coarseLines.push(...sampleSegment(P, a, b, so));
		golv = pathEl(fineLines, RED, 0.6, 0.22) + pathEl(coarseLines, RED, 0.6, 0.4);
	}

	// raudgrid + horisont
	let raud = '';
	const axes: Array<[boolean, 0 | 1 | 2]> = [
		[s.gridX, 0],
		[s.gridY, 1],
		[s.gridZ, 2]
	];
	for (const [on, axis] of axes) {
		if (!on) continue;
		const lines: Polyline[] = [];
		for (const { u, v } of greatCircleFamily(axis)) lines.push(...sampleDirLoop(D, u, v, so));
		raud += pathEl(lines, RED, 0.6, 0.55);
	}
	if (s.horizon) {
		raud += pathEl(sampleDirLoop(D, HORIZON.u, HORIZON.v, so), RED, 1.0, 0.8);
	}

	// vp-prikkar
	let vp = '';
	if (s.vps) {
		for (const { d, label } of vpList()) {
			const p = D(d);
			if (!p.visible) continue;
			vp += `<circle cx="${fmt(p.x)}" cy="${fmt(p.y)}" r="2.4" fill="${RED}" fill-opacity="0.9"/>`;
			vp += `<text x="${fmt(p.x + 5)}" y="${fmt(p.y + 10)}" font-family="ui-monospace, Menlo, monospace" font-size="9" fill="${RED}" fill-opacity="0.75">${label}</text>`;
		}
	}

	// blekk (M6: avstandsvekta vekt, masker, modul-merke, jitter) i malar-rekkjefylgje
	const jit = (lines: Polyline[]) => (s.jitter ? jitterPolylines(lines, 0x5eed) : lines);
	let blekk = '';
	for (const bi of buildInk(f, doc, { maskFaces: s.maskFaces, moduleTicks: s.moduleTicks, sample: so })) {
		for (const loop of bi.fills) blekk += fillEl(loop, PAPER);
		for (const { w, lines } of bi.strokes) blekk += pathEl(jit(lines), INK, w, 0.95);
		if (bi.ticks.length) blekk += pathEl(jit(bi.ticks), INK, 0.9, 0.85);
	}

	const inscribe = s.fit !== 'cover' && !pano;
	const clipShape = inscribe
		? `<circle cx="${fmt(f.cx)}" cy="${fmt(f.cy)}" r="${fmt(f.R)}"/>`
		: `<rect x="0" y="0" width="${view.w}" height="${view.h}"/>`;
	const rim = inscribe
		? `<circle cx="${fmt(f.cx)}" cy="${fmt(f.cy)}" r="${fmt(f.R)}" fill="none" stroke="${INK}" stroke-width="1" stroke-opacity="0.5"/>`
		: '';

	return (
		`<svg xmlns="http://www.w3.org/2000/svg" width="${view.w}" height="${view.h}" viewBox="0 0 ${view.w} ${view.h}">` +
		`<defs><clipPath id="femtepunkt-clip">${clipShape}</clipPath></defs>` +
		`<rect width="${view.w}" height="${view.h}" fill="${PAPER}"/>` +
		`<g clip-path="url(#femtepunkt-clip)">` +
		`<g id="golv">${golv}</g>` +
		`<g id="raudgrid">${raud}</g>` +
		`<g id="vp">${vp}</g>` +
		`<g id="blekk">${blekk}</g>` +
		`</g>` +
		rim +
		`</svg>`
	);
}

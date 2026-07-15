import { describe, expect, it } from 'vitest';
import { makeFrame, project, projectDir, type CameraState, type V3 } from '../src/lib/perspective/projection';
import { sampleDirLoop, sampleSegment, type Polyline } from '../src/lib/perspective/sample';

const DEG = Math.PI / 180;
const VIEW = { w: 1200, h: 800 };
const R = 0.485 * 800;
const CX = 600;
const CY = 400;

function cam(partial: Partial<CameraState> = {}): CameraState {
	return { pos: [0, 1780, 0], yaw: 0, pitch: 0, fov: 220 * DEG, proj: 'stereo', ...partial };
}

function lerp3(a: V3, b: V3, t: number): V3 {
	return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

// avstand punkt → polylinjekjede
function distToPolylines(x: number, y: number, lines: Polyline[]): number {
	let best = Infinity;
	for (const line of lines) {
		for (let i = 0; i + 3 < line.length; i += 2) {
			const ax = line[i];
			const ay = line[i + 1];
			const bx = line[i + 2];
			const by = line[i + 3];
			const dx = bx - ax;
			const dy = by - ay;
			const l2 = dx * dx + dy * dy;
			const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2));
			best = Math.min(best, Math.hypot(x - (ax + t * dx), y - (ay + t * dy)));
		}
	}
	return best;
}

function assertNoNaN(lines: Polyline[]) {
	for (const line of lines) for (const v of line) expect(Number.isFinite(v)).toBe(true);
}

describe('adaptiv sampling (§9.5)', () => {
	it('kurvefeil < ε: heilt synleg segment', () => {
		const f = makeFrame(cam(), VIEW);
		const proj = (p: V3) => project(f, p);
		const A: V3 = [-3000, 0, -2500];
		const B: V3 = [3000, 0, -2500];
		const lines = sampleSegment(proj, A, B, { camPos: f.pos });
		expect(lines.length).toBe(1);
		assertNoNaN(lines);
		// tett fasit mot polylinja
		for (let i = 0; i <= 400; i++) {
			const s = proj(lerp3(A, B, i / 400));
			expect(s.visible).toBe(true);
			expect(distToPolylines(s.x, s.y, lines)).toBeLessThan(0.6);
		}
		// og polylinja er faktisk krum (fleire enn to punkt)
		expect(lines[0].length).toBeGreaterThan(8);
	});

	it('polylinjebrot ved θmax: segment som endar bak kameraet', () => {
		const f = makeFrame(cam(), VIEW);
		const proj = (p: V3) => project(f, p);
		const A: V3 = [800, 1780, -2000];
		const B: V3 = [800, 1780, 4000];
		const lines = sampleSegment(proj, A, B, { camPos: f.pos });
		expect(lines.length).toBe(1);
		assertNoNaN(lines);
		const line = lines[0];
		// alle punkt innanfor randa
		for (let i = 0; i + 1 < line.length; i += 2) {
			const r = Math.hypot(line[i] - CX, line[i + 1] - CY);
			expect(r).toBeLessThanOrEqual(R + 1e-6);
		}
		// siste punkt ligg inntil randa (< 0.1 px-bisseksjon + slakk)
		const lx = line[line.length - 2];
		const ly = line[line.length - 1];
		expect(Math.hypot(lx - CX, ly - CY)).toBeGreaterThan(R - 0.6);
	});

	it('nærkamera-vakt: segment gjennom kameraet gjev endelege tal og brot', () => {
		const f = makeFrame(cam(), VIEW);
		const proj = (p: V3) => project(f, p);
		// passerer 0.5 mm frå C = (0,1780,0)
		const A: V3 = [-1000, 1780, 0.5];
		const B: V3 = [1000, 1780, 0.5];
		const lines = sampleSegment(proj, A, B, { camPos: f.pos });
		assertNoNaN(lines);
		expect(lines.length).toBeGreaterThanOrEqual(2); // biten nærast auget er droppa
	});

	it('segment heilt bak kameraet vert droppa', () => {
		const f = makeFrame(cam({ fov: 180 * DEG }), VIEW);
		const proj = (p: V3) => project(f, p);
		const lines = sampleSegment(proj, [-500, 1780, 3000], [500, 1780, 3000], {
			camPos: f.pos
		});
		expect(lines.length).toBe(0);
	});
});

describe('storsirkel-loop', () => {
	it('horisonten ved τ≠0, equi 360: lukka kurve innanfor randa', () => {
		// horisonten spenner θ ∈ [τ, 180°−τ]; lukka bilete krev full sfære (fov 360, equi)
		const f = makeFrame(cam({ pitch: 15 * DEG, proj: 'equi', fov: 360 * DEG }), VIEW);
		const pd = (d: V3) => projectDir(f, d);
		const u: V3 = [1, 0, 0];
		const v: V3 = [0, 0, 1];
		const lines = sampleDirLoop(pd, u, v);
		expect(lines.length).toBe(1);
		assertNoNaN(lines);
		const line = lines[0];
		expect(line.length).toBeGreaterThan(32);
		// lukka: fyrste ≈ siste
		expect(Math.hypot(line[0] - line[line.length - 2], line[1] - line[line.length - 1])).toBeLessThan(
			0.5
		);
		// fasit: tett sampla horisont ligg på polylinja
		for (let i = 0; i < 360; i++) {
			const t = (i / 360) * 2 * Math.PI;
			const s = pd([Math.cos(t), 0, Math.sin(t)]);
			expect(s.visible).toBe(true);
			expect(distToPolylines(s.x, s.y, lines)).toBeLessThan(0.6);
		}
	});

	it('storsirkel delvis utanfor fov vert broten i bogar', () => {
		const f = makeFrame(cam({ fov: 150 * DEG }), VIEW);
		const pd = (d: V3) => projectDir(f, d);
		// vertikal storsirkel gjennom ±y og ±z: delar bak kameraet er usynlege
		const lines = sampleDirLoop(pd, [0, 1, 0], [0, 0, 1]);
		expect(lines.length).toBeGreaterThanOrEqual(1);
		assertNoNaN(lines);
		for (const line of lines) {
			for (let i = 0; i + 1 < line.length; i += 2) {
				expect(Math.hypot(line[i] - CX, line[i + 1] - CY)).toBeLessThanOrEqual(R + 1e-6);
			}
		}
	});
});

import { describe, expect, it } from 'vitest';
import {
	FIGURBOKS,
	boxCorners,
	boxEdges,
	centroid,
	figureBoxAt,
	formatM,
	makeBoxFromFootprint,
	rayBox,
	rayFloor,
	rayPlaneY,
	raycast,
	snapMm,
	snapYaw,
	stackBaseY,
	type Box,
	type Ray
} from '../src/lib/perspective/scene';
import { clampCamera, defaultCamera, lookAt, orbit } from '../src/lib/perspective/camera';
import { makeFrame, vdot, vnorm, type V3 } from '../src/lib/perspective/projection';

const DEG = Math.PI / 180;

function box(id: string, min: V3, size: V3, yaw = 0): Box {
	return { id, min, size, yaw };
}

describe('ray/golv (§9.6)', () => {
	it('kjend fasit: 45° ned-fram frå augehøgd 1780', () => {
		const ray: Ray = { origin: [0, 1780, 0], dir: vnorm([0, -1, -1]) };
		const p = rayFloor(ray);
		expect(p).not.toBeNull();
		expect(p![0]).toBeCloseTo(0, 9);
		expect(p![1]).toBeCloseTo(0, 9);
		expect(p![2]).toBeCloseTo(-1780, 9);
	});
	it('stråle oppover eller parallell → null', () => {
		expect(rayFloor({ origin: [0, 1780, 0], dir: vnorm([0, 1, -1]) })).toBeNull();
		expect(rayFloor({ origin: [0, 1780, 0], dir: [0, 0, -1] })).toBeNull();
	});
	it('rayPlaneY treff vilkårleg høgd', () => {
		const p = rayPlaneY({ origin: [0, 2000, 0], dir: vnorm([0, -1, -1]) }, 400);
		expect(p![1]).toBeCloseTo(400, 9);
		expect(p![2]).toBeCloseTo(-1600, 9);
	});
});

describe('ray/obb med yaw (§9.6)', () => {
	it('urotert boks: kjend fasit t=1800, sideflate', () => {
		const b = box('a', [-200, 0, -2200], [400, 400, 400]);
		const hit = rayBox({ origin: [0, 200, 0], dir: [0, 0, -1] }, b);
		expect(hit).not.toBeNull();
		expect(hit!.t).toBeCloseTo(1800, 6);
		expect(hit!.normal[2]).toBeCloseTo(1, 9);
		expect(hit!.face).toBe('side');
	});

	it('45° yaw: hjørnet vender mot kameraet; t = 2000 − 200√2', () => {
		const b = box('a', [-200, 0, -2200], [400, 400, 400], 45 * DEG);
		const hit = rayBox({ origin: [0, 200, 0], dir: [0, 0, -1] }, b);
		expect(hit).not.toBeNull();
		expect(hit!.t).toBeCloseTo(2000 - 200 * Math.SQRT2, 6);
		expect(hit!.face).toBe('side');
	});

	it('yaw flyttar treffet: stråle som bommar urotert, treffer rotert', () => {
		const b0 = box('a', [-200, 0, -2200], [400, 100, 400]);
		// x = a·|z|: urotert bom krev a > 200/1800 ≈ 0.111;
		// rotert 45° (diamant, halvdiagonal 200√2) treff krev 2000·a ≤ 283 → a ≤ 0.141
		const dir = vnorm([0.13, 0, -1]);
		expect(rayBox({ origin: [0, 50, 0], dir }, b0)).toBeNull();
		const b45 = { ...b0, yaw: 45 * DEG };
		expect(rayBox({ origin: [0, 50, 0], dir }, b45)).not.toBeNull();
	});

	it('toppflate: normal +y, face=top', () => {
		const b = box('a', [-200, 0, -1200], [400, 400, 400]);
		const origin: V3 = [0, 2000, 0];
		const target: V3 = [0, 400, -1000];
		const hit = rayBox({ origin, dir: vnorm([target[0] - origin[0], target[1] - origin[1], target[2] - origin[2]]) }, b);
		expect(hit).not.toBeNull();
		expect(hit!.face).toBe('top');
		expect(hit!.normal[1]).toBeCloseTo(1, 9);
		expect(hit!.point[1]).toBeCloseTo(400, 6);
	});

	it('stråle med opphav inne i boksen → null (berre inngangstreff)', () => {
		const b = box('a', [-200, 0, -200], [400, 400, 400]);
		expect(rayBox({ origin: [0, 200, 0], dir: [0, 0, -1] }, b)).toBeNull();
	});
});

describe('raycast + stabling (§9.6)', () => {
	const boxes: Box[] = [
		box('lo', [-500, 0, -3000], [1000, 600, 1000]),
		box('hi', [-250, 600, -2750], [500, 500, 500])
	];

	it('raycast gjev næraste boks', () => {
		const hit = raycast(boxes, { origin: [0, 300, 0], dir: [0, 0, -1] });
		expect(hit!.box.id).toBe('lo');
		expect(hit!.t).toBeCloseTo(2000, 6);
	});

	it('stackBaseY: fyrste treff på toppflate gjev basisplanet', () => {
		// ned på toppen av 'hi' (y=1100)
		const origin: V3 = [0, 3000, 0];
		const t1: V3 = [0, 1100, -2500];
		const y1 = stackBaseY(boxes, {
			origin,
			dir: vnorm([t1[0] - origin[0], t1[1] - origin[1], t1[2] - origin[2]])
		});
		expect(y1).toBeCloseTo(1100, 6);
	});

	it('stackBaseY: sidetreff tel ikkje; golv gjev 0', () => {
		// vassrett stråle i sideflatehøgd
		const ySide = stackBaseY(boxes, { origin: [0, 300, 0], dir: [0, 0, -1] });
		expect(ySide).toBe(0);
		const yFloor = stackBaseY(boxes, { origin: [5000, 1000, 5000], dir: vnorm([0, -1, -0.2]) });
		expect(yFloor).toBe(0);
	});
});

describe('boks-ops', () => {
	it('makeBoxFromFootprint normaliserer hjørne og løfter til basisplan', () => {
		const b = makeBoxFromFootprint('x', [500, -1000], [-300, -1400], 600, 250);
		expect(b.min).toEqual([-300, 600, -1400]);
		expect(b.size).toEqual([800, 250, 400]);
	});

	it('centroid og hjørne med yaw: 8 hjørne, riktig radius', () => {
		const b = box('x', [-200, 0, -200], [400, 400, 400], 30 * DEG);
		const c = centroid(b);
		expect(c).toEqual([0, 200, 0]);
		const pts = boxCorners(b);
		expect(pts.length).toBe(8);
		for (const p of pts) {
			// vassrett avstand frå sentroid er alltid 200√2 for kvadratisk fotavtrykk
			expect(Math.hypot(p[0] - c[0], p[2] - c[2])).toBeCloseTo(200 * Math.SQRT2, 9);
			expect([0, 400]).toContain(Math.round(p[1]));
		}
		expect(boxEdges(b).length).toBe(12);
	});

	it('figurboks: kjg-proporsjonar, vend mot kameraet', () => {
		expect(FIGURBOKS).toEqual({ w: 500, h: 1750, d: 300 });
		const b = figureBoxAt('f', 0, -3000, 0, [0, 1780, 0]);
		expect(b.size).toEqual([500, 1750, 300]);
		expect(b.min[1]).toBe(0);
		// front (+z lokalt) skal peike mot kameraet: yaw=0 her
		expect(b.yaw).toBeCloseTo(0, 9);
		const b2 = figureBoxAt('f2', -3000, 0, 0, [0, 1780, 0]);
		// kameraet ligg mot +x frå boksen → yaw = atan2(3000, 0) = π/2
		expect(b2.yaw).toBeCloseTo(Math.PI / 2, 9);
	});

	it('snapping: 50 mm og 15°', () => {
		expect(snapMm(1234)).toBe(1250);
		expect(snapMm(-76)).toBe(-100);
		expect(snapYaw(14 * DEG)).toBeCloseTo(15 * DEG, 12);
		expect(snapYaw(7 * DEG)).toBeCloseTo(0, 12);
	});

	it('formatM: mm internt, meter i grensesnittet', () => {
		expect(formatM(1780)).toBe('1.78');
		expect(formatM(300)).toBe('0.3');
		expect(formatM(10000)).toBe('10');
		expect(formatM(50)).toBe('0.05');
		expect(formatM(12345)).toBe('12.3');
		expect(formatM(0)).toBe('0');
	});
});

describe('kamera-ops', () => {
	it('clamp: augehøgd 300–10000, fov-tak per projeksjon', () => {
		const c = defaultCamera();
		c.pos[1] = 50;
		c.fov = 350 * DEG;
		clampCamera(c);
		expect(c.pos[1]).toBe(300);
		expect(c.fov).toBeLessThanOrEqual(300 * DEG + 1e-12);
		c.proj = 'linear';
		clampCamera(c);
		expect(c.fov).toBeLessThan(Math.PI);
	});

	it('orbit held radius og ser mot målet', () => {
		const c = defaultCamera();
		const target: V3 = [0, 800, -2000];
		lookAt(c, target);
		const r0 = Math.hypot(
			c.pos[0] - target[0],
			c.pos[1] - target[1],
			c.pos[2] - target[2]
		);
		for (let i = 0; i < 24; i++) {
			orbit(c, target, 0.13, i % 2 ? 0.07 : -0.05);
			const r = Math.hypot(
				c.pos[0] - target[0],
				c.pos[1] - target[1],
				c.pos[2] - target[2]
			);
			expect(r).toBeCloseTo(r0, 6);
			const f = makeFrame(c, { w: 1200, h: 800 });
			const to = vnorm([
				target[0] - c.pos[0],
				target[1] - c.pos[1],
				target[2] - c.pos[2]
			]);
			expect(vdot(f.fwd, to)).toBeGreaterThan(1 - 1e-9);
		}
	});
});

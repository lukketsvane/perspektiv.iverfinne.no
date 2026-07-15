import { describe, expect, it } from 'vitest';
import {
	makeFrame,
	project,
	projectDir,
	unproject,
	vcross,
	vdot,
	vnorm,
	type CameraState,
	type Frame,
	type V3
} from '../src/lib/perspective/projection';

const DEG = Math.PI / 180;

// deterministisk rng (mulberry32) — ingen flakes
function rng(seed: number) {
	let a = seed >>> 0;
	return () => {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function cam(partial: Partial<CameraState> = {}): CameraState {
	return { pos: [0, 1780, 0], yaw: 0, pitch: 0, fov: 220 * DEG, proj: 'stereo', ...partial };
}

const VIEW = { w: 1200, h: 800 };
const R = 0.485 * 800;
const CX = 600;
const CY = 400;

function angleBetween(a: V3, b: V3): number {
	const d = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
	return 2 * Math.asin(Math.min(1, d / 2));
}

function randomDirWithin(f: Frame, r: () => number, maxFrac: number): V3 {
	// uniform på sfæra, avvis utanfor maxFrac·θmax
	for (;;) {
		const u = 2 * r() - 1;
		const phi = 2 * Math.PI * r();
		const s = Math.sqrt(1 - u * u);
		const d: V3 = [s * Math.cos(phi), s * Math.sin(phi), u];
		const cosT = vdot(d, f.fwd);
		const theta = Math.atan2(Math.sqrt(Math.max(0, 1 - cosT * cosT)), cosT);
		if (theta <= maxFrac * f.thetaMax) return d;
	}
}

describe('kamerabasis (§2)', () => {
	it('ψ=0, τ=0: fwd=−z, right=+x, up=+y', () => {
		const f = makeFrame(cam(), VIEW);
		expect(f.fwd[0]).toBeCloseTo(0, 12);
		expect(f.fwd[1]).toBeCloseTo(0, 12);
		expect(f.fwd[2]).toBeCloseTo(-1, 12);
		expect(f.right[0]).toBeCloseTo(1, 12);
		expect(f.up[1]).toBeCloseTo(1, 12);
	});

	it('basis er ortonormal for vilkårlege ψ, τ', () => {
		const r = rng(7);
		for (let i = 0; i < 50; i++) {
			const f = makeFrame(
				cam({ yaw: (r() - 0.5) * 8, pitch: (r() - 0.5) * Math.PI * 0.98 }),
				VIEW
			);
			expect(Math.abs(vdot(f.fwd, f.right))).toBeLessThan(1e-12);
			expect(Math.abs(vdot(f.fwd, f.up))).toBeLessThan(1e-12);
			expect(Math.abs(vdot(f.right, f.up))).toBeLessThan(1e-12);
			const c = vcross(f.right, f.fwd);
			expect(angleBetween(vnorm(c), f.up)).toBeLessThan(1e-9);
		}
	});
});

describe('round-trip (§9.1): 1000 tilfeldige retningar per projeksjon', () => {
	const cases: Array<[string, number]> = [
		['stereo', 220 * DEG],
		['equi', 300 * DEG],
		['linear', 120 * DEG]
	];
	for (const [proj, fov] of cases) {
		it(`${proj}: dir → skjerm → dir, feil < 1e−9 rad`, () => {
			const f = makeFrame(
				cam({ proj: proj as CameraState['proj'], fov, yaw: 0.7, pitch: 0.3 }),
				VIEW
			);
			const r = rng(42);
			for (let i = 0; i < 1000; i++) {
				const d = randomDirWithin(f, r, 0.98);
				const s = projectDir(f, d);
				expect(s.visible).toBe(true);
				const back = unproject(f, s.x, s.y);
				expect(angleBetween(d, back)).toBeLessThan(1e-9);
			}
		});
	}

	it('project(P) og unproject er samstemte for verdspunkt', () => {
		const f = makeFrame(cam({ yaw: -0.4, pitch: 0.2 }), VIEW);
		const r = rng(9);
		for (let i = 0; i < 300; i++) {
			const d = randomDirWithin(f, r, 0.95);
			const t = 100 + r() * 20000;
			const P: V3 = [f.pos[0] + d[0] * t, f.pos[1] + d[1] * t, f.pos[2] + d[2] * t];
			const s = project(f, P);
			expect(s.visible).toBe(true);
			const back = unproject(f, s.x, s.y);
			expect(angleBetween(d, back)).toBeLessThan(1e-9);
		}
	});
});

describe('vp-invariantar (§9.2)', () => {
	const AXES: V3[] = [
		[1, 0, 0],
		[-1, 0, 0],
		[0, 1, 0],
		[0, -1, 0],
		[0, 0, 1],
		[0, 0, -1]
	];

	it('fov 180, τ=0: nøyaktig 5 synlege; sentrum + 4 på randa', () => {
		const f = makeFrame(cam({ fov: 180 * DEG }), VIEW);
		const proj = AXES.map((a) => projectDir(f, a));
		expect(proj.filter((p) => p.visible).length).toBe(5);
		// −z i sentrum
		expect(proj[5].x).toBeCloseTo(CX, 6);
		expect(proj[5].y).toBeCloseTo(CY, 6);
		// +z usynleg
		expect(proj[4].visible).toBe(false);
		// ±x på randa, horisontalt
		expect(proj[0].x).toBeCloseTo(CX + R, 6);
		expect(proj[0].y).toBeCloseTo(CY, 6);
		expect(proj[1].x).toBeCloseTo(CX - R, 6);
		// ±y på randa, vertikalt (+y opp → skjerm-y mindre)
		expect(proj[2].y).toBeCloseTo(CY - R, 6);
		expect(proj[2].x).toBeCloseTo(CX, 6);
		expect(proj[3].y).toBeCloseTo(CY + R, 6);
	});

	for (const fov of [220, 300]) {
		it(`fov ${fov} stereo: 5 synlege, side-vp strengt innanfor randa`, () => {
			const f = makeFrame(cam({ fov: fov * DEG }), VIEW);
			const proj = AXES.map((a) => projectDir(f, a));
			expect(proj.filter((p) => p.visible).length).toBe(5);
			const expected = (R * Math.tan(Math.PI / 4)) / Math.tan((fov * DEG) / 4);
			for (const i of [0, 1, 2, 3]) {
				const dist = Math.hypot(proj[i].x - CX, proj[i].y - CY);
				expect(dist).toBeCloseTo(expected, 6);
				expect(dist).toBeLessThan(R);
			}
		});
	}
});

describe('kolinearitet gjennom sentrum (§9.3a)', () => {
	const cases: Array<[CameraState['proj'], number]> = [
		['stereo', 260 * DEG],
		['equi', 300 * DEG],
		['linear', 120 * DEG]
	];
	for (const [proj, fov] of cases) {
		it(`${proj}: storsirkel gjennom synsretninga → kolineære punkt`, () => {
			const r = rng(13);
			for (let k = 0; k < 10; k++) {
				const f = makeFrame(cam({ proj, fov, yaw: r() * 6, pitch: (r() - 0.5) * 2 }), VIEW);
				// tilfeldig einingsvektor ⊥ fwd
				const seed: V3 = [r() - 0.5, r() - 0.5, r() - 0.5];
				const v = vnorm(vcross(f.fwd, vnorm(seed)));
				const pts: Array<{ x: number; y: number }> = [];
				for (let i = 0; i <= 14; i++) {
					const t = (i / 14 - 0.5) * 1.8 * f.thetaMax;
					const d: V3 = [
						Math.cos(t) * f.fwd[0] + Math.sin(t) * v[0],
						Math.cos(t) * f.fwd[1] + Math.sin(t) * v[1],
						Math.cos(t) * f.fwd[2] + Math.sin(t) * v[2]
					];
					const s = projectDir(f, d);
					expect(s.visible).toBe(true);
					pts.push(s);
				}
				const a = pts[0];
				const b = pts[pts.length - 1];
				const len = Math.hypot(b.x - a.x, b.y - a.y);
				for (const p of pts) {
					const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
					expect(Math.abs(cross / len)).toBeLessThan(1e-6);
				}
			}
		});
	}
});

describe('sirkelfit-diskriminanten (§9.3b)', () => {
	function greatCirclePoints(f: Frame): Array<{ x: number; y: number }> {
		// storsirkel som IKKJE går gjennom synsretninga
		const n = vnorm([0, 0.8, -1]);
		const u = vnorm(vcross(n, [1, 0, 0]));
		const v = vnorm(vcross(n, u));
		const pts: Array<{ x: number; y: number }> = [];
		for (let i = 0; i < 48; i++) {
			const t = (i / 48) * 2 * Math.PI;
			const d: V3 = [
				Math.cos(t) * u[0] + Math.sin(t) * v[0],
				Math.cos(t) * u[1] + Math.sin(t) * v[1],
				Math.cos(t) * u[2] + Math.sin(t) * v[2]
			];
			const s = projectDir(f, d);
			if (s.visible) pts.push({ x: s.x, y: s.y });
		}
		return pts;
	}

	function circumResidual(pts: Array<{ x: number; y: number }>): number {
		const a = pts[0];
		const b = pts[Math.floor(pts.length / 3)];
		const c = pts[Math.floor((2 * pts.length) / 3)];
		const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
		const ux =
			((a.x * a.x + a.y * a.y) * (b.y - c.y) +
				(b.x * b.x + b.y * b.y) * (c.y - a.y) +
				(c.x * c.x + c.y * c.y) * (a.y - b.y)) /
			d;
		const uy =
			((a.x * a.x + a.y * a.y) * (c.x - b.x) +
				(b.x * b.x + b.y * b.y) * (a.x - c.x) +
				(c.x * c.x + c.y * c.y) * (b.x - a.x)) /
			d;
		const r0 = Math.hypot(a.x - ux, a.y - uy);
		let worst = 0;
		for (const p of pts) worst = Math.max(worst, Math.abs(Math.hypot(p.x - ux, p.y - uy) - r0));
		return worst;
	}

	it('stereo: tre punkt på storsirkel definerer sirkelen alle ligg på', () => {
		const f = makeFrame(cam({ proj: 'stereo', fov: 300 * DEG }), VIEW);
		const pts = greatCirclePoints(f);
		expect(pts.length).toBeGreaterThan(8);
		expect(circumResidual(pts)).toBeLessThan(1e-6 * R);
	});

	it('equi: same storsirkel ligg IKKJE på ein sirkel', () => {
		const f = makeFrame(cam({ proj: 'equi', fov: 300 * DEG }), VIEW);
		const pts = greatCirclePoints(f);
		expect(pts.length).toBeGreaterThan(8);
		expect(circumResidual(pts)).toBeGreaterThan(1);
	});
});

describe('horisont = augehøgd (§9.4)', () => {
	it('punkt i augehøgd → skjerm-y = cy ved τ=0, uavhengig av ψ', () => {
		const r = rng(21);
		for (let k = 0; k < 8; k++) {
			const eye = 300 + r() * 5000;
			const f = makeFrame(cam({ pos: [r() * 900, eye, r() * 900], yaw: r() * 6.28 }), VIEW);
			for (let i = 0; i < 60; i++) {
				const P: V3 = [(r() - 0.5) * 30000, eye, (r() - 0.5) * 30000];
				const s = project(f, P);
				if (!s.visible) continue;
				expect(Math.abs(s.y - CY)).toBeLessThan(1e-7);
			}
		}
	});
});

describe('panorama (M7): same kontrakt, stripe i staden for sirkel', () => {
	function panoDirWithin(f: Frame, r: () => number, elevFrac: number, elevMax: number): V3 {
		// tilfeldig asimut, elevasjon innanfor synleg band (relativt til pitch)
		const az = (r() * 2 - 1) * Math.PI * 0.98;
		const el = f.pitch + (r() * 2 - 1) * elevFrac * elevMax;
		const ce = Math.cos(el);
		// verdsretning frå yaw-basisen (yaw=0 i desse testane: fwd=−z, right=+x)
		return vnorm([Math.sin(az) * ce, Math.sin(el), -Math.cos(az) * ce]);
	}

	it('round-trip pano-equi < 1e−9 rad', () => {
		const f = makeFrame(
			cam({ proj: 'pano-equi', fov: 180 * DEG, pitch: 0.2 }),
			VIEW
		);
		const r = rng(77);
		const elevMax = Math.min(Math.PI / 2, (VIEW.h / 2) / f.kv);
		for (let i = 0; i < 1000; i++) {
			const d = panoDirWithin(f, r, 0.93, elevMax);
			const s = projectDir(f, d);
			if (!s.visible) continue;
			expect(angleBetween(d, unproject(f, s.x, s.y))).toBeLessThan(1e-9);
		}
	});

	it('round-trip pano-cyl < 1e−9 rad', () => {
		const f = makeFrame(cam({ proj: 'pano-cyl', fov: 150 * DEG, pitch: -0.1 }), VIEW);
		const r = rng(78);
		const elevMax = Math.atan(Math.min(1.4, (VIEW.h / 2) / f.kv));
		for (let i = 0; i < 1000; i++) {
			const d = panoDirWithin(f, r, 0.9, elevMax);
			const s = projectDir(f, d);
			if (!s.visible) continue;
			expect(angleBetween(d, unproject(f, s.x, s.y))).toBeLessThan(1e-9);
		}
	});

	it('horisonten er beinstrekt på cy ved τ=0; vertikalar har konstant x', () => {
		for (const proj of ['pano-equi', 'pano-cyl'] as const) {
			const f = makeFrame(cam({ proj, fov: 150 * DEG }), VIEW);
			for (let i = 0; i < 36; i++) {
				const a = (i / 36) * 2 * Math.PI;
				const s = projectDir(f, [Math.cos(a), 0, Math.sin(a)]);
				expect(s.visible).toBe(true);
				expect(Math.abs(s.y - CY)).toBeLessThan(1e-9);
			}
			// vertikal verdsline: same skjerm-x for alle høgder
			const xs: number[] = [];
			for (const y of [200, 900, 1600, 2400]) {
				const s = project(f, [1500, y, -2500]);
				if (s.visible) xs.push(s.x);
			}
			expect(xs.length).toBeGreaterThan(2);
			for (const x of xs) expect(Math.abs(x - xs[0])).toBeLessThan(1e-9);
		}
	});

	it('stripa er periodisk: x + w gjev same retning (gjentekne vp)', () => {
		const f = makeFrame(cam({ proj: 'pano-equi', fov: 160 * DEG }), VIEW);
		const r = rng(80);
		for (let i = 0; i < 100; i++) {
			const x = r() * VIEW.w;
			const y = CY + (r() - 0.5) * 300;
			const d0 = unproject(f, x, y);
			const d1 = unproject(f, x + VIEW.w, y);
			expect(angleBetween(d0, d1)).toBeLessThan(1e-9);
		}
	});
});

describe('makeFrame-geometri', () => {
	it('innskriven sirkel: R = 0.485·min(w,h), sentrum i midten', () => {
		const f = makeFrame(cam(), VIEW);
		expect(f.R).toBeCloseTo(R, 12);
		expect(f.cx).toBeCloseTo(CX, 12);
		expect(f.cy).toBeCloseTo(CY, 12);
	});
	it('cover: sirkelen omskriv lerretet', () => {
		const f = makeFrame(cam(), { ...VIEW, fit: 'cover' });
		expect(f.R).toBeCloseTo(0.5 * Math.hypot(1200, 800), 12);
	});
});

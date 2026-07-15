import { describe, expect, it } from 'vitest';
import {
	buildMannequin,
	MANNEQUIN_POSES,
	mannequinGrp,
	nextMannequinPose,
	parseMannequinGrp
} from '../src/lib/perspective/mannequin';
import { boxCorners, pointInBox, rayBox } from '../src/lib/perspective/scene';

function span(boxes: ReturnType<typeof buildMannequin>): { lo: number; hi: number } {
	let lo = Infinity;
	let hi = -Infinity;
	for (const b of boxes) {
		for (const c of boxCorners(b)) {
			if (c[1] < lo) lo = c[1];
			if (c[1] > hi) hi = c[1];
		}
	}
	return { lo, hi };
}

describe('mannekeng', () => {
	it('16 delar, felles gruppe, bekkenet fyrst', () => {
		const m = buildMannequin({ x: 0, z: 0, yaw: 0 });
		expect(m.length).toBe(16);
		const grp = m[0].grp;
		expect(grp?.startsWith('mq:staande:1750:')).toBe(true);
		for (const b of m) expect(b.grp).toBe(grp);
		// bekkenet er breiaste delen med botn kring hoftehøgd
		expect(m[0].size[0]).toBeGreaterThan(300);
		expect(m[0].min[1]).toBeGreaterThan(700);
	});

	it('bakkenormalisering: lågaste hjørne treffer baseY i ALLE positurar', () => {
		for (const pose of MANNEQUIN_POSES) {
			const m = buildMannequin({ x: 500, z: -2000, yaw: 1.1, pose });
			const { lo } = span(m);
			expect(Math.abs(lo), pose).toBeLessThan(0.001);
			const m2 = buildMannequin({ x: 0, z: 0, yaw: 0, pose, baseY: 620 });
			expect(Math.abs(span(m2).lo - 620), `${pose} på kasse`).toBeLessThan(0.001);
		}
	});

	it('ståande er nær full høgd; sitjande hamnar i stolhøgd; hukande er låg', () => {
		const st = span(buildMannequin({ x: 0, z: 0, yaw: 0, pose: 'staande', height: 1800 }));
		expect(st.hi - st.lo).toBeGreaterThan(1620);
		expect(st.hi - st.lo).toBeLessThan(1900);
		const sitj = buildMannequin({ x: 0, z: 0, yaw: 0, pose: 'sitjande', height: 1800 });
		const pelvisBottom = sitj[0].min[1];
		expect(pelvisBottom).toBeGreaterThan(280); // stol-/krakkhøgd, ikkje ståande hofte
		expect(pelvisBottom).toBeLessThan(650);
		const huk = span(buildMannequin({ x: 0, z: 0, yaw: 0, pose: 'hukande', height: 1800 }));
		expect(huk.hi - huk.lo).toBeLessThan(1400);
	});

	it('deterministisk utan jitter (utanom id/grp-uid); jitter varierer med rng', () => {
		const strip = (m: ReturnType<typeof buildMannequin>) =>
			JSON.stringify(m.map((b) => ({ min: b.min, size: b.size, yaw: b.yaw, pitch: b.pitch ?? 0 })));
		const a = buildMannequin({ x: 10, z: 20, yaw: 0.4, pose: 'gaande' });
		const b = buildMannequin({ x: 10, z: 20, yaw: 0.4, pose: 'gaande' });
		expect(strip(a)).toBe(strip(b));
		let k = 0;
		const rngA = () => (k = (k * 16807 + 7) % 2147483647) / 2147483647;
		const c = buildMannequin({ x: 10, z: 20, yaw: 0.4, pose: 'gaande', jitter: rngA });
		expect(strip(c)).not.toBe(strip(a));
	});

	it('gaande-positur: eitt kne framfor og eitt bak bekkenet (pitcha lår)', () => {
		const m = buildMannequin({ x: 0, z: 0, yaw: 0, pose: 'gaande' });
		const thighs = m.filter((b) => (b.pitch ?? 0) !== 0 && b.size[1] > 350 && b.size[1] < 500);
		expect(thighs.length).toBeGreaterThanOrEqual(2);
		// framover-sving: minst eitt lår har sentroid framfor bekkenet (+z lokalt = -z her? yaw 0 → fram er +z)
		const pelvisZ = m[0].min[2] + m[0].size[2] / 2;
		const zs = thighs.map((t) => t.min[2] + t.size[2] / 2 - pelvisZ);
		expect(Math.max(...zs)).toBeGreaterThan(40);
		expect(Math.min(...zs)).toBeLessThan(-40);
	});

	it('pitcha delboksar: rayBox og pointInBox verkar (plukking av lår)', () => {
		const m = buildMannequin({ x: 0, z: 0, yaw: 0, pose: 'gaande' });
		const thigh = m.find((b) => (b.pitch ?? 0) !== 0 && b.size[1] > 350 && b.size[1] < 500)!;
		const c = boxCorners(thigh);
		const mid: [number, number, number] = [
			c.reduce((s, p) => s + p[0], 0) / 8,
			c.reduce((s, p) => s + p[1], 0) / 8,
			c.reduce((s, p) => s + p[2], 0) / 8
		];
		expect(pointInBox(mid, thigh)).toBe(true);
		const hit = rayBox({ origin: [mid[0], mid[1], mid[2] + 3000], dir: [0, 0, -1] }, thigh);
		expect(hit).not.toBeNull();
		expect(hit!.t).toBeGreaterThan(2500);
	});

	it('pitch-geometri: 90° legg høgdeaksen i planet (hjørnesjekk)', () => {
		const b = { id: 't', min: [-50, 950, -200] as [number, number, number], size: [100, 400, 100] as [number, number, number], yaw: 0, pitch: Math.PI / 2 };
		const cs = boxCorners(b);
		let hiZ = -Infinity;
		let loZ = Infinity;
		let hiY = -Infinity;
		let loY = Infinity;
		for (const c of cs) {
			hiZ = Math.max(hiZ, c[2]);
			loZ = Math.min(loZ, c[2]);
			hiY = Math.max(hiY, c[1]);
			loY = Math.min(loY, c[1]);
		}
		// rotX(90°): lokal +y → +z, lokal +z → −y
		expect(hiZ - loZ).toBeCloseTo(400, 6);
		expect(hiY - loY).toBeCloseTo(100, 6);
	});

	it('grp-koding: mannequinGrp ↔ parseMannequinGrp, positur-syklus', () => {
		const g = mannequinGrp('hukande', 1680, 'abc123');
		expect(parseMannequinGrp(g)).toEqual({ pose: 'hukande', height: 1680, uid: 'abc123' });
		expect(parseMannequinGrp('mq:tull:1680:x')).toBeNull();
		expect(parseMannequinGrp('ikkje-mq')).toBeNull();
		expect(nextMannequinPose('staande')).toBe('gaande');
		expect(nextMannequinPose('berande')).toBe('staande'); // syklisk
	});
});

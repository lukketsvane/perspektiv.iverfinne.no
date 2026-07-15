import { describe, expect, it } from 'vitest';
import { buildInk, inkWidth, jitterPolylines, INK_W_FAR, INK_W_NEAR } from '../src/lib/perspective/ink';
import { makeFrame, type CameraState } from '../src/lib/perspective/projection';
import { defaultDoc, type Box } from '../src/lib/perspective/scene';

const DEG = Math.PI / 180;

function cam(): CameraState {
	return { pos: [0, 1780, 4000], yaw: 0, pitch: 0, fov: 220 * DEG, proj: 'stereo' };
}

function box(id: string, z: number): Box {
	return { id, min: [-300, 0, z - 300], size: [600, 900, 600], yaw: 20 * DEG };
}

describe('blekk (M6)', () => {
	it('linjevekt fell med avstand og er bøtta på 0.1 px', () => {
		expect(inkWidth(100)).toBe(INK_W_NEAR);
		expect(inkWidth(100000)).toBe(INK_W_FAR);
		const mid = inkWidth(3000);
		expect(mid).toBeGreaterThan(INK_W_FAR);
		expect(mid).toBeLessThan(INK_W_NEAR);
		expect(Math.round(mid * 10) / 10).toBe(mid);
	});

	it('nær boks får tjukkare strek enn fjern; sortering fjernast fyrst', () => {
		const doc = defaultDoc();
		doc.boxes.push(box('naer', 2500), box('fjern', -9000));
		const f = makeFrame(cam(), { w: 1200, h: 800 });
		const ink = buildInk(f, doc, { maskFaces: false, moduleTicks: false });
		expect(ink[0].id).toBe('fjern');
		expect(ink[1].id).toBe('naer');
		const wNaer = Math.max(...ink[1].strokes.map((s) => s.w));
		const wFjern = Math.max(...ink[0].strokes.map((s) => s.w));
		expect(wNaer).toBeGreaterThan(wFjern);
	});

	it('modul-merke: 7 tick per synleg vertikal kant, av som default', () => {
		const doc = defaultDoc();
		doc.boxes.push(box('a', 2000));
		const f = makeFrame(cam(), { w: 1200, h: 800 });
		const off = buildInk(f, doc, { maskFaces: false, moduleTicks: false });
		expect(off[0].ticks.length).toBe(0);
		const on = buildInk(f, doc, { maskFaces: false, moduleTicks: true });
		expect(on[0].ticks.length).toBe(4 * 7);
		for (const t of on[0].ticks) expect(t.length).toBe(4); // korte strekar
	});

	it('kvitmaska flater: berre kameravende (1–3 for konveks boks)', () => {
		const doc = defaultDoc();
		doc.boxes.push(box('a', 1500));
		const f = makeFrame(cam(), { w: 1200, h: 800 });
		const ink = buildInk(f, doc, { maskFaces: true, moduleTicks: false });
		expect(ink[0].fills.length).toBeGreaterThanOrEqual(1);
		expect(ink[0].fills.length).toBeLessThanOrEqual(3);
		const offInk = buildInk(f, doc, { maskFaces: false, moduleTicks: false });
		expect(offInk[0].fills.length).toBe(0);
	});

	it('jitter er deterministisk med seed; endepunkta står i ro', () => {
		const lines = [[0, 0, 10, 5, 20, 10, 30, 15], [5, 5, 15, 5, 25, 5]];
		const a = jitterPolylines(lines, 42);
		const b = jitterPolylines(lines, 42);
		expect(a).toEqual(b);
		const c = jitterPolylines(lines, 43);
		expect(c).not.toEqual(a);
		for (let i = 0; i < lines.length; i++) {
			const l = lines[i];
			expect(a[i][0]).toBe(l[0]);
			expect(a[i][1]).toBe(l[1]);
			expect(a[i][l.length - 2]).toBe(l[l.length - 2]);
			expect(a[i][l.length - 1]).toBe(l[l.length - 1]);
		}
		// indre punkt er faktisk flytta, men < 0.5 px
		expect(a[0][2]).not.toBe(lines[0][2]);
		expect(Math.abs(a[0][2] - lines[0][2])).toBeLessThan(0.5);
	});

	it('budsjettvakt (§8): 200 boksar med alt på samplar godt under ramma', () => {
		const doc = defaultDoc();
		for (let i = 0; i < 200; i++) {
			doc.boxes.push({
				id: `b${i}`,
				min: [((i % 20) - 10) * 1200, 0, -1500 - Math.floor(i / 20) * 1500],
				size: [600, 400 + (i % 5) * 350, 600],
				yaw: (i % 24) * 15 * DEG
			});
		}
		const f = makeFrame(cam(), { w: 1200, h: 800 });
		buildInk(f, doc, { maskFaces: true, moduleTicks: true }); // varm opp
		const t0 = performance.now();
		buildInk(f, doc, { maskFaces: true, moduleTicks: true });
		const dt = performance.now() - t0;
		// romsleg tak mot regresjonar (målt ~5–10 ms lokalt)
		expect(dt).toBeLessThan(250);
	});
});

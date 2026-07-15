import { describe, expect, it } from 'vitest';
import {
	buildGreatPreset,
	buildPreset,
	PRESET_NAMES,
	PRESET_SCORE_MIN,
	randomPresetName,
	scorePreset
} from '../src/lib/perspective/presets';
import { EYE_MAX, EYE_MIN } from '../src/lib/perspective/camera';
import { makeHistory, pushCmd, redo, undo } from '../src/lib/perspective/history';
import { boxCorners, cloneBox, defaultDoc } from '../src/lib/perspective/scene';

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

describe('presetar', () => {
	it('alle presetar gjev gyldige scener over fleire seed', () => {
		for (const name of PRESET_NAMES) {
			for (const seed of [1, 7, 42]) {
				const { boxes, camera } = buildPreset(name, rng(seed));
				expect(boxes.length).toBeGreaterThanOrEqual(5);
				expect(boxes.length).toBeLessThan(700); // mannekengar er 16 boksar kvar
				const ids = new Set(boxes.map((b) => b.id));
				expect(ids.size).toBe(boxes.length);
				for (const b of boxes) {
					for (const v of [...b.min, ...b.size]) expect(Number.isFinite(v)).toBe(true);
					expect(b.size[0]).toBeGreaterThan(0);
					expect(b.size[1]).toBeGreaterThan(0);
					expect(b.size[2]).toBeGreaterThan(0);
					// ingenting under golvet: for pitcha boksar er det HJØRNA som tel
					let lowest = Infinity;
					for (const c of boxCorners(b)) if (c[1] < lowest) lowest = c[1];
					expect(lowest).toBeGreaterThanOrEqual(-0.5);
					expect(Number.isFinite(b.yaw)).toBe(true);
				}
				expect(camera.pos[1]).toBeGreaterThanOrEqual(EYE_MIN);
				expect(camera.pos[1]).toBeLessThanOrEqual(EYE_MAX);
				expect(camera.fov).toBeGreaterThan(0);
			}
		}
	});

	it('same seed → same scene (utanom id-ane); ulik seed → variasjon', () => {
		for (const name of PRESET_NAMES) {
			const strip = (p: ReturnType<typeof buildPreset>) =>
				JSON.stringify({
					boxes: p.boxes.map((b) => ({ min: b.min, size: b.size, yaw: b.yaw, pitch: b.pitch ?? 0 })),
					camera: p.camera
				});
			expect(strip(buildPreset(name, rng(5)))).toBe(strip(buildPreset(name, rng(5))));
			expect(strip(buildPreset(name, rng(5)))).not.toBe(strip(buildPreset(name, rng(6))));
		}
	});

	it('naturlege høgder: ingen menneskeproporsjonert boks på golvet over 2.0 m', () => {
		// menneske-heuristikk: golvbasert, kroppsbreidd 0.38–0.72 m, djupn ≤ 0.95 m,
		// høgd ≥ 0.7 m (stolpar/hyller/tønner fell utanfor på breidd/djupn)
		for (const name of PRESET_NAMES) {
			for (const seed of [3, 11, 27]) {
				const { boxes } = buildPreset(name, rng(seed));
				for (const b of boxes) {
					const [w, h, d] = b.size;
					// kvadratsnitta søyler (kranbein o.l.): struktur, ikkje menneske
					const columnLike =
						Math.abs(w - d) / Math.max(w, d) < 0.15 && h / Math.max(w, d) > 5;
					const humanish =
						!columnLike &&
						b.min[1] === 0 &&
						w >= 380 &&
						w <= 720 &&
						d >= 240 &&
						d <= 950 &&
						h >= 700;
					if (humanish) {
						expect(h, `${name} seed ${seed}: boks ${w}×${h}×${d}`).toBeLessThanOrEqual(2000);
					}
					// personar over bakken (scener, salar, stolar): KROPPEN skal vere naturleg
					// (≤ 2.0 m); absolutt topp kan gjerne vere høg — det er poenget med å ri
					if (!columnLike && b.min[1] > 0 && w >= 380 && w <= 720 && d >= 240 && d <= 950 && h >= 700 && h <= 2600) {
						expect(h, `${name} seed ${seed}: kroppshøgd over bakken`).toBeLessThanOrEqual(2000);
					}
				}
			}
		}
	});

	it('menneskeskala: folkemengda er mannekengar i VARIERTE naturlege høgder', () => {
		const { boxes } = buildPreset('folkemengd', rng(3));
		const grps = new Set(
			boxes.filter((b) => b.grp?.startsWith('mq:')).map((b) => b.grp as string)
		);
		expect(grps.size).toBeGreaterThanOrEqual(6);
		const heights = new Set<number>();
		for (const g of grps) {
			const h = Number(g.split(':')[2]);
			expect(h).toBeGreaterThanOrEqual(900); // born i fylgje er minst ~0.9 m
			expect(h).toBeLessThanOrEqual(1900);
			heights.add(h);
		}
		expect(heights.size).toBeGreaterThanOrEqual(4); // «ulike variasjonar høgder osv»
	});

	it('figurrekkje: leddstilte mannekengar i naturleg skala, på golvet', () => {
		const { boxes } = buildPreset('figurrekkje', rng(3));
		const grps = new Set(
			boxes.filter((b) => b.grp?.startsWith('mq:')).map((b) => b.grp as string)
		);
		expect(grps.size).toBeGreaterThanOrEqual(4);
		for (const g of grps) {
			const parts = boxes.filter((b) => b.grp === g);
			expect(parts.length).toBe(16);
			let lo = Infinity;
			let hi = -Infinity;
			for (const p of parts) {
				for (const c of boxCorners(p)) {
					if (c[1] < lo) lo = c[1];
					if (c[1] > hi) hi = c[1];
				}
			}
			expect(lo).toBeGreaterThanOrEqual(-0.5); // bakkenormalisert
			expect(lo).toBeLessThanOrEqual(0.5);
			expect(hi - lo).toBeGreaterThanOrEqual(650); // sitgolv/hukande er låge
			expect(hi - lo).toBeLessThanOrEqual(2350); // vinkande hand over hovudet er naturleg
		}
	});

	it('randomPresetName dekkjer alle namna', () => {
		const r = rng(11);
		const seen = new Set<string>();
		for (let i = 0; i < 300; i++) seen.add(randomPresetName(r));
		expect(seen.size).toBe(PRESET_NAMES.length);
	});

	it('kvalitetsvakta: KVAR lasting av KVAR preset er eit sterkt startpunkt', () => {
		// dette er garantien bak t-tasten: alle presetar × 30 seed, alle over golvet
		for (const name of PRESET_NAMES) {
			for (let seed = 1; seed <= 30; seed++) {
				const p = buildGreatPreset(name, rng(seed * 7 + 1));
				const s = scorePreset(p);
				expect(s, `${name} seed ${seed} skåra ${s.toFixed(2)}`).toBeGreaterThanOrEqual(
					PRESET_SCORE_MIN
				);
			}
		}
	});

	it('skåren straffar det som gjer eit startpunkt dårleg', () => {
		// tom scene
		expect(
			scorePreset({ boxes: [], camera: { pos: [0, 1780, 0], yaw: 0, pitch: 0, fov: 3.8, proj: 'stereo' } })
		).toBe(0);
		// kamera inne i ein boks → hard null
		const p = buildPreset('folkemengd', rng(4));
		const inside = {
			...p,
			camera: {
				...p.camera,
				pos: [
					p.boxes[0].min[0] + p.boxes[0].size[0] / 2,
					p.boxes[0].min[1] + p.boxes[0].size[1] / 2,
					p.boxes[0].min[2] + p.boxes[0].size[2] / 2
				] as [number, number, number]
			}
		};
		expect(scorePreset(inside)).toBe(0);
		// kamera vendt BORT frå scena → langt under godkjent
		const away = { ...p, camera: { ...p.camera, pos: [0, 1780, 60000] as [number, number, number] } };
		expect(scorePreset(away)).toBeLessThan(PRESET_SCORE_MIN);
	});

	it('scene-kommandoen i historikken angrar preset-lasting som eitt steg', () => {
		// kanonisk form: nøkkelrekkjefylgja i json varierer mellom bygde og klona boksar
		const canon = (bs: ReturnType<typeof buildPreset>['boxes']) =>
			JSON.stringify(
				bs.map((b) => ({ id: b.id, min: b.min, size: b.size, yaw: b.yaw, pitch: b.pitch ?? 0, grp: b.grp ?? '' }))
			);
		const doc = defaultDoc();
		doc.boxes.push({ id: 'gammal', min: [0, 0, 0], size: [500, 500, 500], yaw: 0 });
		const before = canon(doc.boxes);
		const h = makeHistory();
		const preset = buildPreset('folkemengd', rng(2));
		pushCmd(h, {
			kind: 'scene',
			before: doc.boxes.map((b) => cloneBox(b, b.id)),
			after: preset.boxes.map((b) => cloneBox(b, b.id))
		});
		doc.boxes = preset.boxes;
		const after = canon(doc.boxes);
		expect(undo(h, doc)).toBe(true);
		expect(canon(doc.boxes)).toBe(before);
		expect(redo(h, doc)).toBe(true);
		expect(canon(doc.boxes)).toBe(after);
	});
});

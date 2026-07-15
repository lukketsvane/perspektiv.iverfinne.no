// hittest.ts — plukking i geometrien, aldri i skjermformer (§2).
// prioritet: boks > horisontband ±24 px > golv (§4).

import { projectDir, unproject, type Frame, type V3 } from '../perspective/projection';
import { raycast, rayFloor, type Box, type Doc, type Face } from '../perspective/scene';

export const HORIZON_BAND_PX = 24;

export type UiHit =
	| { kind: 'box'; id: string; box: Box; face: Face; point: V3; t: number }
	| { kind: 'horizon' }
	| { kind: 'floor'; point: V3 }
	| { kind: 'void' };

export function pointerRayDir(f: Frame, x: number, y: number): V3 {
	return unproject(f, x, y);
}

export function hitTest(doc: Doc, f: Frame, x: number, y: number): UiHit {
	// utanfor den innskrivne sirkelen er det ikkje papir
	if (doc.settings.fit !== 'cover' && f.proj !== 'pano-equi' && f.proj !== 'pano-cyl') {
		if (Math.hypot(x - f.cx, y - f.cy) > f.R) return { kind: 'void' };
	}
	const dir = unproject(f, x, y);
	const ray = { origin: f.pos, dir };
	const bh = raycast(doc.boxes, ray);
	if (bh) return { kind: 'box', id: bh.box.id, box: bh.box, face: bh.face, point: bh.point, t: bh.t };
	if (horizonDistPx(f, x, y) <= HORIZON_BAND_PX) return { kind: 'horizon' };
	const fp = rayFloor(ray);
	if (fp) return { kind: 'floor', point: fp };
	return { kind: 'void' };
}

// minste skjermavstand til horisontkurva (grovsampla; god nok for eit ±24 px-band)
export function horizonDistPx(f: Frame, x: number, y: number): number {
	let best = Infinity;
	let px = 0;
	let py = 0;
	let has = false;
	const N = 96;
	for (let i = 0; i <= N; i++) {
		const a = (i / N) * 2 * Math.PI;
		const s = projectDir(f, [Math.cos(a), 0, Math.sin(a)]);
		if (!s.visible) {
			has = false;
			continue;
		}
		if (has) {
			best = Math.min(best, distSeg(x, y, px, py, s.x, s.y));
		}
		px = s.x;
		py = s.y;
		has = true;
	}
	return best;
}

function distSeg(x: number, y: number, ax: number, ay: number, bx: number, by: number): number {
	const dx = bx - ax;
	const dy = by - ay;
	const l2 = dx * dx + dy * dy;
	const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2));
	return Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
}

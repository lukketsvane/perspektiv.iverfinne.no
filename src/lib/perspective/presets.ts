// presets.ts — randomiserbare scene-presetar; superstartpunkt i menneskeskala.
// inspirert av kjg-arka: folkemengder, klasserom, verkstadgolv, hestar,
// boksa hovudstudie og figurrekkjer. alle mål i mm; generatorane brukar
// berre den injiserte rng-en (testbar determinisme).

import type { CameraState, V3 } from './projection';
import { FIGURBOKS, newId, type Box } from './scene';

export type Rng = () => number;

export type PresetName =
	| 'folkemengd'
	| 'klasserom'
	| 'verkstad'
	| 'stall'
	| 'hovudstudie'
	| 'figurrekkje';

export const PRESET_NAMES: PresetName[] = [
	'folkemengd',
	'klasserom',
	'verkstad',
	'stall',
	'hovudstudie',
	'figurrekkje'
];

export type Preset = { boxes: Box[]; camera: CameraState };

const DEG = Math.PI / 180;

function r(rng: Rng, a: number, b: number): number {
	return a + rng() * (b - a);
}

function ri(rng: Rng, a: number, b: number): number {
	return Math.round(r(rng, a, b));
}

// boks sentrert på (x,z), botn i y
function bx(x: number, y: number, z: number, w: number, h: number, d: number, yaw = 0): Box {
	return { id: newId(), min: [x - w / 2, y, z - d / 2], size: [w, h, d], yaw };
}

function figure(rng: Rng, x: number, z: number, yaw: number, h = 0): Box {
	const hh = h || r(rng, 1600, 1900);
	return bx(x, 0, z, FIGURBOKS.w, hh, FIGURBOKS.d, yaw);
}

// enkel avvisingsutplassering: nye punkt minst `minDist` frå dei gamle
function scatter(
	rng: Rng,
	n: number,
	halfX: number,
	halfZ: number,
	minDist: number
): Array<[number, number]> {
	const pts: Array<[number, number]> = [];
	let guard = 0;
	while (pts.length < n && guard < n * 60) {
		guard++;
		const p: [number, number] = [r(rng, -halfX, halfX), r(rng, -halfZ, halfZ)];
		if (pts.every((q) => Math.hypot(p[0] - q[0], p[1] - q[1]) >= minDist)) pts.push(p);
	}
	return pts;
}

function cam(pos: V3, fov: number, yaw = 0, pitch = 0): CameraState {
	return { pos, yaw, pitch, fov: fov * DEG, proj: 'stereo' };
}

// --- folkemengd: ståande figurar i lause klynger, eit par hundar ---
function folkemengd(rng: Rng): Preset {
	const boxes: Box[] = [];
	const base = r(rng, 0, Math.PI * 2);
	const pts = scatter(rng, ri(rng, 9, 14), 4000, 3000, 750);
	for (const [x, z] of pts) {
		const outlier = rng() < 0.15;
		const yaw = outlier ? r(rng, 0, Math.PI * 2) : base + r(rng, -0.6, 0.6);
		if (rng() < 0.15) {
			// barn
			boxes.push(bx(x, 0, z, 380, r(rng, 1050, 1300), 240, yaw));
		} else {
			boxes.push(figure(rng, x, z, yaw));
		}
	}
	for (let i = 0; i < ri(rng, 1, 2); i++) {
		const [x, z] = [r(rng, -3500, 3500), r(rng, -2500, 2500)];
		boxes.push(bx(x, 0, z, 260, r(rng, 420, 560), r(rng, 600, 800), r(rng, 0, Math.PI * 2)));
	}
	return { boxes, camera: cam([0, 1680, 3400], 215) };
}

// --- klasserom: pultrekkjer, stolar, sitjande og ståande elevar ---
function klasserom(rng: Rng): Preset {
	const boxes: Box[] = [];
	const cols = ri(rng, 3, 4);
	const rows = ri(rng, 3, 4);
	const sx = 1500;
	const sz = 1750;
	const x0 = (-(cols - 1) / 2) * sx;
	const z0 = (-(rows - 1) / 2) * sz;
	for (let cI = 0; cI < cols; cI++) {
		for (let rowI = 0; rowI < rows; rowI++) {
			const x = x0 + cI * sx + r(rng, -70, 70);
			const z = z0 + rowI * sz + r(rng, -70, 70);
			const yaw = r(rng, -0.06, 0.06);
			boxes.push(bx(x, 0, z, 650, 740, 450, yaw)); // pult
			if (rng() < 0.75) {
				boxes.push(bx(x, 0, z + 500, 400, 430, 400, yaw)); // stol
				if (rng() < 0.6) {
					boxes.push(bx(x, 0, z + 480, 430, 1250, 550, yaw)); // sitjande elev
				}
			}
			if (rng() < 0.18) {
				boxes.push(
					bx(x + r(rng, 500, 700), 0, z + r(rng, -200, 200), 400, r(rng, 1250, 1450), 250, r(rng, 0, Math.PI * 2))
				); // ståande elev
			}
		}
	}
	// kateter + lærar fremst
	const tz = z0 - 1900;
	boxes.push(bx(r(rng, -800, 800), 0, tz, 1400, 760, 700, r(rng, -0.1, 0.1)));
	boxes.push(figure(rng, r(rng, -1600, 1600), tz + r(rng, -300, 300), r(rng, 2.6, 3.7)));
	return { boxes, camera: cam([900, 1550, 3900], 205) };
}

// --- verkstad: benker, hyller, vogner, maskiner, gaffeltruck, arbeidarar ---
function verkstad(rng: Rng): Preset {
	const boxes: Box[] = [];
	const pts = scatter(rng, ri(rng, 10, 14), 5500, 4500, 1500);
	for (const [x, z] of pts) {
		const yaw = (ri(rng, 0, 3) * Math.PI) / 2 + r(rng, -0.12, 0.12);
		const kind = ri(rng, 0, 5);
		if (kind === 0) boxes.push(bx(x, 0, z, 1800, 900, 760, yaw)); // benk
		else if (kind === 1) boxes.push(bx(x, 0, z, 1000, r(rng, 1700, 2100), 450, yaw)); // hylle
		else if (kind === 2) boxes.push(bx(x, 0, z, 1150, 880, 650, yaw)); // vogn
		else if (kind === 3) {
			boxes.push(bx(x, 0, z, 700, 500, 700, yaw)); // kassestabel
			if (rng() < 0.6) boxes.push(bx(x, 500, z, 660, 460, 660, yaw + r(rng, -0.2, 0.2)));
		} else if (kind === 4) boxes.push(bx(x, 0, z, 460, 720, 460, yaw)); // tønne
		else boxes.push(bx(x, 0, z, 1300, 1600, 900, yaw)); // maskin
		if (rng() < 0.3) {
			boxes.push(figure(rng, x + r(rng, 700, 1100), z + r(rng, -400, 400), r(rng, 0, Math.PI * 2)));
		}
	}
	// gaffeltruck
	const fx = r(rng, -2500, 2500);
	const fz = r(rng, -1500, 2500);
	const fy = r(rng, 0, Math.PI * 2);
	boxes.push(bx(fx, 0, fz, 1350, 1150, 2100, fy)); // kropp
	const dir: [number, number] = [Math.sin(fy), Math.cos(fy)];
	boxes.push(bx(fx + dir[0] * 1200, 0, fz + dir[1] * 1200, 260, 2700, 220, fy)); // mast
	boxes.push(bx(fx, 1850, fz, 1050, 130, 950, fy)); // vernetak
	return { boxes, camera: cam([-1400, 3600, 5200], 235, -0.24, -0.38) };
}

// --- stall: hestar av boksar (kropp, hovud, fire bein) + handterar ---
function stall(rng: Rng): Preset {
	const boxes: Box[] = [];
	const pts = scatter(rng, ri(rng, 2, 4), 3200, 2400, 2300);
	for (const [x, z] of pts) {
		const yaw = r(rng, 0, Math.PI * 2);
		const dir: [number, number] = [Math.sin(yaw), Math.cos(yaw)];
		const side: [number, number] = [Math.cos(yaw), -Math.sin(yaw)];
		boxes.push(bx(x, 780, z, 500, 650, 1600, yaw)); // kropp
		boxes.push(
			bx(x + dir[0] * 950, 1250, z + dir[1] * 950, 260, 560, 340, yaw + r(rng, -0.35, 0.35))
		); // hals/hovud
		for (const [sx, sz] of [
			[1, 1],
			[1, -1],
			[-1, 1],
			[-1, -1]
		] as Array<[number, number]>) {
			boxes.push(
				bx(
					x + side[0] * 150 * sx + dir[0] * 600 * sz,
					0,
					z + side[1] * 150 * sx + dir[1] * 600 * sz,
					120,
					780,
					120,
					yaw
				)
			); // bein
		}
	}
	for (let i = 0; i < ri(rng, 1, 2); i++) {
		boxes.push(figure(rng, r(rng, -3000, 3000), r(rng, -2200, 2200), r(rng, 0, Math.PI * 2)));
	}
	return { boxes, camera: cam([500, 1620, 3800], 210) };
}

// --- hovudstudie: hovudboksar på sokkel, fritt roterte (grøne-boks-arket) ---
function hovudstudie(rng: Rng): Preset {
	const boxes: Box[] = [];
	const n = ri(rng, 6, 9);
	const cols = 3;
	for (let i = 0; i < n; i++) {
		const x = ((i % cols) - 1) * 1250 + r(rng, -260, 260);
		const z = (Math.floor(i / cols) - 1) * 1250 + r(rng, -260, 260);
		const ph = r(rng, 1150, 1500);
		boxes.push(bx(x, 0, z, 170, ph, 170, 0)); // sokkel
		boxes.push(bx(x, ph, z, 230, 290, 250, r(rng, 0, Math.PI * 2))); // hovud
	}
	boxes.push(figure(rng, r(rng, -2400, 2400), r(rng, 1800, 2600), r(rng, 2.4, 3.9)));
	return { boxes, camera: cam([0, 1600, 2700], 195) };
}

// --- figurrekkje: oppstilte figurar i varierte yaw + referansekubar ---
function figurrekkje(rng: Rng): Preset {
	const boxes: Box[] = [];
	const n = ri(rng, 5, 8);
	const x0 = (-(n - 1) / 2) * 900;
	for (let i = 0; i < n; i++) {
		boxes.push(
			figure(rng, x0 + i * 900 + r(rng, -120, 120), r(rng, -300, 300), r(rng, 0, Math.PI * 2))
		);
	}
	for (let i = 0; i < ri(rng, 2, 4); i++) {
		boxes.push(bx(r(rng, -3000, 3000), 0, r(rng, 1200, 2600), 500, 500, 500, r(rng, 0, Math.PI * 2)));
	}
	const sx = r(rng, -2500, 2500);
	boxes.push(bx(sx, 0, 2000, 500, 500, 500, r(rng, 0, 0.4)));
	boxes.push(bx(sx, 500, 2000, 450, 450, 450, r(rng, 0.2, 0.7)));
	return { boxes, camera: cam([0, 1780, 3200], 220) };
}

const GENERATORS: Record<PresetName, (rng: Rng) => Preset> = {
	folkemengd,
	klasserom,
	verkstad,
	stall,
	hovudstudie,
	figurrekkje
};

export function buildPreset(name: PresetName, rng: Rng): Preset {
	return GENERATORS[name](rng);
}

export function randomPresetName(rng: Rng): PresetName {
	return PRESET_NAMES[Math.floor(rng() * PRESET_NAMES.length) % PRESET_NAMES.length];
}

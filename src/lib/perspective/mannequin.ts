// mannequin.ts — leddstilt teiknemannekeng av boksar, slik kjg konstruerer figuren:
// hovud, ribbekasse, bekken og lemmer som eigne boksar med yaw+pitch, tett kring kroppen.
// rein modul: berre scene-typar; ingen tilstand. pakke-evaluering (juli 2026) fann berre
// three.js-baserte bibliotek (mannequin.js) og lukka appar — difor eigen parametrisk byggjar.
//
// modell: ledda i figur-lokal ramme (+z fram, +y opp), sagittale svingvinklar pluss
// sidespreiing for armar/bein; kvart segment vert ein boks med yaw (kompass) og pitch
// (helling frå loddlina). etterpå vert HEILE figuren skuvd vertikalt så lågaste hjørne
// treffer baseY — bakkenormaliseringa gjer at positurgeometrien sjølv bestemmer
// bekkenhøgda (sitjande hamnar i stolhøgd, hukande nede, utan eigne høgdetal).

import { boxCorners, newId, type Box } from './scene';
import type { V3 } from './projection';

export type MannequinPoseName =
	| 'staande'
	| 'gaande'
	| 'springande'
	| 'sitjande'
	| 'sitgolv'
	| 'hukande'
	| 'boygd'
	| 'lener'
	| 'vinkande'
	| 'berande';

export const MANNEQUIN_POSES: MannequinPoseName[] = [
	'staande',
	'gaande',
	'springande',
	'sitjande',
	'sitgolv',
	'hukande',
	'boygd',
	'lener',
	'vinkande',
	'berande'
];

export const MANNEQUIN_GRP_PREFIX = 'mq:';

// per-side: [venstre, høgre]; vinklar i grader (sagittal sving; + er framover)
type PoseSpec = {
	lean: number; // overkropp framover
	nod: number; // hovud framover
	turn: number; // hovud-yaw
	hip: [number, number];
	knee: [number, number]; // fleksjon (legg bakover relativt lår)
	legSpread: [number, number]; // bein ut til sida
	sh: [number, number]; // arm-sving framover
	el: [number, number]; // olboge-fleksjon (hand framover)
	armSpread: [number, number]; // arm ut til sida
};

const POSES: Record<MannequinPoseName, PoseSpec> = {
	staande: { lean: 2, nod: 0, turn: 0, hip: [-2, 3], knee: [3, 5], legSpread: [3, 3], sh: [-5, 6], el: [9, 12], armSpread: [6, 6] },
	gaande: { lean: 5, nod: 2, turn: 0, hip: [27, -19], knee: [9, 44], legSpread: [2, 2], sh: [-23, 27], el: [13, 36], armSpread: [4, 4] },
	springande: { lean: 16, nod: 4, turn: 0, hip: [54, -33], knee: [26, 98], legSpread: [3, 3], sh: [-40, 46], el: [74, 70], armSpread: [6, 6] },
	sitjande: { lean: -3, nod: 3, turn: 0, hip: [88, 85], knee: [86, 83], legSpread: [7, 7], sh: [13, 15], el: [58, 63], armSpread: [6, 6] },
	sitgolv: { lean: 9, nod: 4, turn: 0, hip: [82, 78], knee: [152, 148], legSpread: [16, 16], sh: [19, 17], el: [48, 44], armSpread: [9, 9] },
	hukande: { lean: 24, nod: 6, turn: 0, hip: [114, 108], knee: [130, 126], legSpread: [9, 9], sh: [30, 32], el: [72, 68], armSpread: [8, 8] },
	boygd: { lean: 58, nod: 10, turn: 0, hip: [24, 18], knee: [11, 15], legSpread: [5, 5], sh: [7, 11], el: [12, 16], armSpread: [7, 7] },
	lener: { lean: -11, nod: 5, turn: 8, hip: [4, -15], knee: [6, 30], legSpread: [4, 6], sh: [17, 15], el: [98, 102], armSpread: [4, 4] },
	vinkande: { lean: 1, nod: -4, turn: 12, hip: [-2, 4], knee: [3, 5], legSpread: [4, 4], sh: [-5, 12], el: [9, 116], armSpread: [6, 148] },
	berande: { lean: -6, nod: 2, turn: 0, hip: [15, -11], knee: [9, 32], legSpread: [4, 4], sh: [35, 37], el: [79, 83], armSpread: [3, 3] }
};

// proporsjonar som del av ståhøgd H (7,5-hovuds kanon)
const PR = {
	hipY: 0.53,
	waistY: 0.6,
	shoulderY: 0.815,
	neckY: 0.855,
	hipHalf: 0.085,
	shoulderHalf: 0.115,
	pelvis: { w: 0.19, h: 0.13, d: 0.115 },
	torso: { w: 0.21, h: 0.235, d: 0.12 },
	neck: { w: 0.05, h: 0.06, d: 0.05 },
	head: { w: 0.09, h: 0.135, d: 0.105 },
	upperArm: { len: 0.16, w: 0.05 },
	foreArm: { len: 0.145, w: 0.042 },
	hand: { len: 0.075, w: 0.042, d: 0.022 },
	thigh: { len: 0.245, w: 0.075 },
	shin: { len: 0.245, w: 0.054 },
	foot: { h: 0.04, w: 0.05, len: 0.135 }
} as const;

const D2R = Math.PI / 180;

function rx(v: V3, a: number): V3 {
	const c = Math.cos(a);
	const s = Math.sin(a);
	return [v[0], v[1] * c - v[2] * s, v[1] * s + v[2] * c];
}

function rz(v: V3, a: number): V3 {
	const c = Math.cos(a);
	const s = Math.sin(a);
	return [v[0] * c - v[1] * s, v[0] * s + v[1] * c, v[2]];
}

// figur-lokal → verd (same konvensjon som boxCorners' rotY)
function toWorld(p: V3, yaw: number, ax: number, az: number): V3 {
	const c = Math.cos(yaw);
	const s = Math.sin(yaw);
	return [ax + p[0] * c + p[2] * s, p[1], az - p[0] * s + p[2] * c];
}

export type MannequinOpts = {
	x: number;
	z: number;
	yaw: number;
	height?: number; // ståhøgd i mm (standard 1750)
	pose?: MannequinPoseName;
	baseY?: number; // golv-/basisplan figuren skal stå på
	grpUid?: string; // gjenbruk ved positur-byte så gruppa held identiteten
	jitter?: (() => number) | null; // valfri rng: ±3° naturleg variasjon
};

export function mannequinGrp(pose: MannequinPoseName, height: number, uid: string): string {
	return `${MANNEQUIN_GRP_PREFIX}${pose}:${Math.round(height)}:${uid}`;
}

export function parseMannequinGrp(
	grp: string
): { pose: MannequinPoseName; height: number; uid: string } | null {
	if (!grp.startsWith(MANNEQUIN_GRP_PREFIX)) return null;
	const parts = grp.split(':');
	if (parts.length !== 4) return null;
	const pose = parts[1] as MannequinPoseName;
	const height = Number(parts[2]);
	if (!MANNEQUIN_POSES.includes(pose) || !Number.isFinite(height) || height <= 0) return null;
	return { pose, height, uid: parts[3] };
}

export function nextMannequinPose(pose: MannequinPoseName): MannequinPoseName {
	return MANNEQUIN_POSES[(MANNEQUIN_POSES.indexOf(pose) + 1) % MANNEQUIN_POSES.length];
}

// segment frå ledd langs retninga: boks med høgdeaksen langs dir
function segment(
	grp: string,
	joint: V3,
	dir: V3,
	len: number,
	w: number,
	d: number,
	figYaw: number
): Box {
	const cx = joint[0] + (dir[0] * len) / 2;
	const cy = joint[1] + (dir[1] * len) / 2;
	const cz = joint[2] + (dir[2] * len) / 2;
	// aksen (oppover-enden) bestemmer yaw+pitch: +y-lokal → (sinφ sinψ, cosφ, sinφ cosψ)
	const ax = -dir[0];
	const ay = -dir[1];
	const az = -dir[2];
	const horiz = Math.hypot(ax, az);
	const pitch = Math.atan2(horiz, ay);
	const yaw = horiz > 1e-9 ? Math.atan2(ax, az) : figYaw;
	const b: Box = {
		id: newId(),
		min: [cx - w / 2, cy - len / 2, cz - d / 2],
		size: [w, len, d],
		yaw,
		grp
	};
	if (Math.abs(pitch) > 1e-9) b.pitch = pitch;
	return b;
}

// boks sentrert i c med gjeven orientering
function block(
	grp: string,
	c: V3,
	w: number,
	h: number,
	d: number,
	yaw: number,
	pitch = 0
): Box {
	const b: Box = { id: newId(), min: [c[0] - w / 2, c[1] - h / 2, c[2] - d / 2], size: [w, h, d], yaw, grp };
	if (Math.abs(pitch) > 1e-9) b.pitch = pitch;
	return b;
}

// bygg mannekengen; boksrekkjefylgja er stabil med BEKKENET FYRST (anker for gruppa)
export function buildMannequin(opts: MannequinOpts): Box[] {
	const H = opts.height ?? 1750;
	const pose = opts.pose ?? 'staande';
	const baseY = opts.baseY ?? 0;
	const figYaw = opts.yaw;
	const grp = mannequinGrp(pose, H, opts.grpUid ?? newId());
	const spec = POSES[pose];
	const jig = opts.jitter ? () => (opts.jitter!() - 0.5) * 6 * D2R : () => 0;

	// figur-lokale ledd (mm)
	const boxesLocal: Array<{
		c: V3;
		w: number;
		h: number;
		d: number;
		yawOff: number;
		pitch: number;
	}> = [];
	const segs: Array<{ joint: V3; dir: V3; len: number; w: number; d: number }> = [];

	const lean = spec.lean * D2R + jig();
	const waist: V3 = [0, PR.waistY * H, 0];

	// bekken (fyrst: gruppe-anker)
	const pelvisC: V3 = [0, (PR.hipY - 0.02) * H, 0];
	boxesLocal.push({ c: pelvisC, w: PR.pelvis.w * H, h: PR.pelvis.h * H, d: PR.pelvis.d * H, yawOff: 0, pitch: 0 });

	// overkropp: frå midja opp, lent framover
	const up = rx([0, 1, 0], lean);
	const torsoLen = PR.torso.h * H;
	const torsoC: V3 = [
		waist[0] + (up[0] * torsoLen) / 2,
		waist[1] + (up[1] * torsoLen) / 2,
		waist[2] + (up[2] * torsoLen) / 2
	];
	boxesLocal.push({ c: torsoC, w: PR.torso.w * H, h: torsoLen, d: PR.torso.d * H, yawOff: 0, pitch: lean });

	// hals og hovud
	const neckBase: V3 = [
		waist[0] + up[0] * (PR.neckY - PR.waistY) * H,
		waist[1] + up[1] * (PR.neckY - PR.waistY) * H,
		waist[2] + up[2] * (PR.neckY - PR.waistY) * H
	];
	const nod = spec.nod * D2R + lean;
	const headUp = rx([0, 1, 0], nod);
	const neckLen = PR.neck.h * H;
	boxesLocal.push({
		c: [neckBase[0] + (headUp[0] * neckLen) / 2, neckBase[1] + (headUp[1] * neckLen) / 2, neckBase[2] + (headUp[2] * neckLen) / 2],
		w: PR.neck.w * H,
		h: neckLen,
		d: PR.neck.d * H,
		yawOff: 0,
		pitch: nod
	});
	const headLen = PR.head.h * H;
	boxesLocal.push({
		c: [
			neckBase[0] + headUp[0] * (neckLen * 0.7 + headLen / 2),
			neckBase[1] + headUp[1] * (neckLen * 0.7 + headLen / 2),
			neckBase[2] + headUp[2] * (neckLen * 0.7 + headLen / 2)
		],
		w: PR.head.w * H,
		h: headLen,
		d: PR.head.d * H,
		yawOff: spec.turn * D2R,
		pitch: nod
	});

	// bein
	for (const side of [0, 1] as const) {
		const sgn = side === 0 ? -1 : 1;
		const hip: V3 = [sgn * PR.hipHalf * H, PR.hipY * H, 0];
		const hipA = spec.hip[side] * D2R + jig();
		const spread = spec.legSpread[side] * D2R;
		// framover-sving β på nedover-lem: dir = rx((0,−1,0), −β) = (0, −cosβ, +sinβ)
		let dir = rx([0, -1, 0], -hipA);
		dir = rz(dir, sgn * spread);
		segs.push({ joint: hip, dir, len: PR.thigh.len * H, w: PR.thigh.w * H, d: PR.thigh.w * H });
		const knee: V3 = [
			hip[0] + dir[0] * PR.thigh.len * H,
			hip[1] + dir[1] * PR.thigh.len * H,
			hip[2] + dir[2] * PR.thigh.len * H
		];
		const shinA = hipA - spec.knee[side] * D2R;
		let sdir = rx([0, -1, 0], -shinA);
		sdir = rz(sdir, sgn * spread);
		segs.push({ joint: knee, dir: sdir, len: PR.shin.len * H, w: PR.shin.w * H, d: PR.shin.w * H });
		const ankle: V3 = [
			knee[0] + sdir[0] * PR.shin.len * H,
			knee[1] + sdir[1] * PR.shin.len * H,
			knee[2] + sdir[2] * PR.shin.len * H
		];
		// fot: flat boks framover frå ankelen
		boxesLocal.push({
			c: [ankle[0], ankle[1] - (PR.foot.h * H) / 2 + 4, ankle[2] + PR.foot.len * H * 0.28],
			w: PR.foot.w * H,
			h: PR.foot.h * H,
			d: PR.foot.len * H,
			yawOff: sgn * 0.09,
			pitch: 0
		});
	}

	// armar (heng frå skuldrene, følgjer overkroppslenet)
	for (const side of [0, 1] as const) {
		const sgn = side === 0 ? -1 : 1;
		const shoulder: V3 = [
			waist[0] + up[0] * (PR.shoulderY - PR.waistY) * H + sgn * PR.shoulderHalf * H,
			waist[1] + up[1] * (PR.shoulderY - PR.waistY) * H,
			waist[2] + up[2] * (PR.shoulderY - PR.waistY) * H
		];
		const swing = spec.sh[side] * D2R + jig();
		const spread = spec.armSpread[side] * D2R;
		// armvinklar er verds-sagittale (relative til loddlina, ikkje overkroppen)
		let dir = rx([0, -1, 0], -swing);
		dir = rz(dir, sgn * spread);
		segs.push({ joint: shoulder, dir, len: PR.upperArm.len * H, w: PR.upperArm.w * H, d: PR.upperArm.w * H });
		const elbow: V3 = [
			shoulder[0] + dir[0] * PR.upperArm.len * H,
			shoulder[1] + dir[1] * PR.upperArm.len * H,
			shoulder[2] + dir[2] * PR.upperArm.len * H
		];
		let fdir = rx([0, -1, 0], -(swing + spec.el[side] * D2R));
		fdir = rz(fdir, sgn * spread);
		segs.push({ joint: elbow, dir: fdir, len: PR.foreArm.len * H, w: PR.foreArm.w * H, d: PR.foreArm.w * H });
		const wrist: V3 = [
			elbow[0] + fdir[0] * PR.foreArm.len * H,
			elbow[1] + fdir[1] * PR.foreArm.len * H,
			elbow[2] + fdir[2] * PR.foreArm.len * H
		];
		segs.push({ joint: wrist, dir: fdir, len: PR.hand.len * H, w: PR.hand.w * H, d: PR.hand.d * H });
	}

	// til verdsrommet
	const out: Box[] = [];
	for (const bl of boxesLocal) {
		const c = toWorld(bl.c, figYaw, opts.x, opts.z);
		out.push(block(grp, c, bl.w, bl.h, bl.d, figYaw + bl.yawOff, bl.pitch));
	}
	for (const s of segs) {
		const j = toWorld(s.joint, figYaw, opts.x, opts.z);
		const dw = toWorld(s.dir, figYaw, 0, 0);
		out.push(segment(grp, j, dw, s.len, s.w, s.d, figYaw));
	}

	// bakkenormalisering: lågaste verds-hjørne skal treffe baseY nøyaktig
	let minY = Infinity;
	for (const b of out) for (const c of boxCorners(b)) if (c[1] < minY) minY = c[1];
	const dy = baseY - minY;
	for (const b of out) b.min[1] += dy;

	return out;
}

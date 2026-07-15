// presets.ts — randomiserbare scene-presetar; superstartpunkt i menneskeskala.
// inspirert av kjg-arka: folkemengder, klasserom, verkstadgolv, hestar,
// boksa hovudstudie, figurrekkjer, gateplunge, teiknekveld og badet.
// alle mål i mm; generatorane brukar berre den injiserte rng-en (testbar
// determinisme). kvar scene har fleire DESIGNA synspunkt (augehøgd, fov,
// retning forankra i boksane); randomiseringa vel eitt.

import { makeFrame, project, type CameraState, type V3 } from './projection';
import { centroid, FIGURBOKS, newId, pointInBox, type Box } from './scene';

export type Rng = () => number;

export type PresetName =
	| 'folkemengd'
	| 'klasserom'
	| 'verkstad'
	| 'stall'
	| 'hovudstudie'
	| 'figurrekkje'
	| 'gate'
	| 'teiknekveld'
	| 'interiør'
	| 'marknad'
	| 'containerhamn'
	| 'byggeplass'
	| 'bibliotek';

export const PRESET_NAMES: PresetName[] = [
	'folkemengd',
	'klasserom',
	'verkstad',
	'stall',
	'hovudstudie',
	'figurrekkje',
	'gate',
	'teiknekveld',
	'interiør',
	'marknad',
	'containerhamn',
	'byggeplass',
	'bibliotek'
];

export type Preset = { boxes: Box[]; camera: CameraState };

const DEG = Math.PI / 180;

function r(rng: Rng, a: number, b: number): number {
	return a + rng() * (b - a);
}

function ri(rng: Rng, a: number, b: number): number {
	return Math.round(r(rng, a, b));
}

function pick<T>(rng: Rng, arr: T[]): T {
	return arr[Math.min(arr.length - 1, Math.floor(rng() * arr.length))];
}

// boks sentrert på (x,z), botn i y
function bx(x: number, y: number, z: number, w: number, h: number, d: number, yaw = 0): Box {
	return { id: newId(), min: [x - w / 2, y, z - d / 2], size: [w, h, d], yaw };
}

function figure(rng: Rng, x: number, z: number, yaw: number, h = 0): Box {
	const hh = h || r(rng, 1600, 1900);
	return bx(x, 0, z, FIGURBOKS.w, hh, FIGURBOKS.d, yaw);
}

// pose-drivne bounding boxes, slik kjg teiknar dei: boksen er TETT kring posituren,
// så proporsjonane varierer sterkt — gåande er djupe (steget), hukande er låge og
// breie, lenande mellomting. front = lokal +z.
export type Pose = 'staande' | 'gaande' | 'lener' | 'hukande' | 'sitjande' | 'sitgolv' | 'boygd';

const POSE_DIMS: Record<Pose, [[number, number], [number, number], [number, number]]> = {
	staande: [
		[460, 560],
		[1620, 1900],
		[260, 340]
	],
	gaande: [
		[480, 580],
		[1580, 1800],
		[560, 780]
	],
	lener: [
		[500, 620],
		[1320, 1550],
		[480, 680]
	],
	hukande: [
		[580, 700],
		[880, 1120],
		[540, 720]
	],
	sitjande: [
		[480, 560],
		[1130, 1330],
		[580, 720]
	],
	sitgolv: [
		[560, 690],
		[850, 1000],
		[640, 820]
	],
	boygd: [
		[540, 660],
		[980, 1260],
		[680, 900]
	]
};

function weightedPose(rng: Rng, weights: Array<[Pose, number]>): Pose {
	let sum = 0;
	for (const [, w] of weights) sum += w;
	let v = rng() * sum;
	for (const [p, w] of weights) {
		v -= w;
		if (v <= 0) return p;
	}
	return weights[weights.length - 1][0];
}

function person(rng: Rng, x: number, z: number, yaw: number, pose: Pose, scale = 1): Box {
	const [[w0, w1], [h0, h1], [d0, d1]] = POSE_DIMS[pose];
	return bx(x, 0, z, r(rng, w0, w1) * scale, r(rng, h0, h1) * scale, r(rng, d0, d1) * scale, yaw);
}

// hund: kropp + hovud (to boksar), som hestane
function dog(rng: Rng, x: number, z: number, yaw: number): Box[] {
	const dir: [number, number] = [Math.sin(yaw), Math.cos(yaw)];
	const bodyH = r(rng, 380, 520);
	return [
		bx(x, 0, z, 240, bodyH, r(rng, 620, 820), yaw),
		bx(x + dir[0] * 430, bodyH - 120, z + dir[1] * 430, 170, r(rng, 240, 320), 280, yaw + r(rng, -0.2, 0.2))
	];
}

// synspunkt: stå på `pos`, sikt mot `target` (yaw+pitch utrekna), gjeven fov
function lookFrom(pos: V3, target: V3, fovDeg: number): CameraState {
	const dx = target[0] - pos[0];
	const dy = target[1] - pos[1];
	const dz = target[2] - pos[2];
	const len = Math.max(1, Math.hypot(dx, dy, dz));
	return {
		pos: [pos[0], pos[1], pos[2]],
		yaw: Math.atan2(-dx, -dz),
		pitch: Math.asin(Math.max(-1, Math.min(1, dy / len))),
		fov: fovDeg * DEG,
		proj: 'stereo'
	};
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

// --- folkemengd: straumar av gåande/ståande, hukande og bøygde innslag,
// samtalepar, folk på kassar, hundar — pose-drivne bounding boxes (kjg-arket) ---
function folkemengd(rng: Rng): Preset {
	const boxes: Box[] = [];

	// 1–2 straumar: køar med felles retning, tett spasering, djupe gå-boksar
	const nStreams = ri(rng, 1, 2);
	let anchor: { pos: [number, number]; dir: [number, number] } = {
		pos: [0, 0],
		dir: [0, 1]
	};
	for (let sI = 0; sI < nStreams; sI++) {
		const theta = r(rng, 0, Math.PI * 2);
		const dir: [number, number] = [Math.cos(theta), Math.sin(theta)];
		const perp: [number, number] = [-dir[1], dir[0]];
		const ox = r(rng, -1800, 1800) + sI * 1500;
		const oz = r(rng, -1500, 1500) - sI * 1200;
		const count = nStreams === 1 ? ri(rng, 7, 10) : ri(rng, 5, 8);
		const walkYaw = Math.atan2(dir[0], dir[1]); // front (+z lokalt) i gangretninga
		if (sI === 0) anchor = { pos: [ox, oz], dir };
		let along = 0;
		for (let i = 0; i < count; i++) {
			along += r(rng, 700, 1050);
			const lat = r(rng, -300, 300);
			const x = ox + dir[0] * along + perp[0] * lat;
			const z = oz + dir[1] * along + perp[1] * lat;
			const pose = weightedPose(rng, [
				['gaande', 5],
				['staande', 3],
				['lener', 1],
				['boygd', 1]
			]);
			const scale = rng() < 0.12 ? r(rng, 0.6, 0.72) : 1; // born i fylgje
			boxes.push(person(rng, x, z, walkYaw + r(rng, -0.22, 0.22), pose, scale));
			// følgjesven side om side (arket har par i køen)
			if (rng() < 0.3) {
				const side = rng() < 0.5 ? 1 : -1;
				boxes.push(
					person(
						rng,
						x + perp[0] * 520 * side,
						z + perp[1] * 520 * side,
						walkYaw + r(rng, -0.18, 0.18),
						weightedPose(rng, [
							['gaande', 3],
							['staande', 1]
						]),
						rng() < 0.2 ? r(rng, 0.6, 0.72) : 1
					)
				);
			}
			if (rng() < 0.18) boxes.push(...dog(rng, x + perp[0] * 620, z + perp[1] * 620, walkYaw + r(rng, -0.3, 0.3)));
		}
	}

	// alt laust vert plassert i straumen si ramme, på BEGGE sider av køen
	const a = anchor.pos;
	const d = anchor.dir;
	const perp0: [number, number] = [-d[1], d[0]];
	const flank = (alongMm: number, sideMm: number): [number, number] => [
		a[0] + d[0] * alongMm + perp0[0] * sideMm,
		a[1] + d[1] * alongMm + perp0[1] * sideMm
	];

	// samtalepar: to ståande/lenande vende mot kvarandre, på eine sida
	{
		const [px, pz] = flank(r(rng, 800, 3800), (rng() < 0.5 ? 1 : -1) * r(rng, 1500, 2600));
		const pairA = r(rng, 0, Math.PI * 2);
		boxes.push(person(rng, px, pz, pairA, 'staande'));
		boxes.push(
			person(rng, px + Math.sin(pairA) * 750, pz + Math.cos(pairA) * 750, pairA + Math.PI, rng() < 0.5 ? 'staande' : 'lener')
		);
	}

	// lausfolk: sitjande på kasse, hukande, bøygd — vekselvis side
	for (let i = 0; i < ri(rng, 2, 3); i++) {
		const side = (i % 2 === 0 ? 1 : -1) * r(rng, 1300, 3000);
		const [x, z] = flank(r(rng, 300, 4600), side);
		const yaw = r(rng, 0, Math.PI * 2);
		const pose = weightedPose(rng, [
			['sitjande', 2],
			['hukande', 2],
			['boygd', 1]
		]);
		if (pose === 'sitjande') {
			boxes.push(bx(x, 0, z, 520, 440, 520, yaw)); // kassa
			const b = person(rng, x, z, yaw, 'sitjande');
			b.min[1] = 440; // opp på kassa
			b.size[1] -= 440;
			boxes.push(b);
		} else {
			boxes.push(person(rng, x, z, yaw, pose));
		}
	}

	// synspunkt: INNE i mengda, på skrå av køen — nærmaste boks skal ruve i ramma
	const camera = pick(rng, [
		// midt i køen, eit steg til sida: fyrste person tett på, resten diagonalt innover
		lookFrom(
			flank3(flank(r(rng, 300, 900), r(rng, 850, 1150) * (rng() < 0.5 ? 1 : -1)), 1680),
			flank3(flank(3200, 0), 1350),
			225
		),
		// barneauge inne i mengda: folk tårnar over deg
		lookFrom(flank3(flank(1200, -750), 1020), flank3(flank(3600, 250), 1550), 235),
		// lett drone skrått over hovuda, køen diagonalt under
		lookFrom(flank3(flank(-1100, 2100), 3800), flank3(flank(2800, -300), 500), 235),
		// froskeblikk: liggande i gata, folk tårnar mot +y
		lookFrom(flank3(flank(500, -550), 470), flank3(flank(3300, 250), 2100), 242)
	]);
	return { boxes, camera };
}

function flank3(p: [number, number], y: number): V3 {
	return [p[0], y, p[1]];
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
	let deskPos: [number, number] = [x0, z0];
	for (let cI = 0; cI < cols; cI++) {
		for (let rowI = 0; rowI < rows; rowI++) {
			const x = x0 + cI * sx + r(rng, -70, 70);
			const z = z0 + rowI * sz + r(rng, -70, 70);
			const yaw = r(rng, -0.06, 0.06);
			boxes.push(bx(x, 0, z, 650, 740, 450, yaw)); // pult
			if (cI === cols - 1 && rowI === rows - 1) deskPos = [x, z];
			if (rng() < 0.75) {
				boxes.push(bx(x, 0, z + 500, 400, 430, 400, yaw)); // stol
				if (rng() < 0.6) boxes.push(bx(x, 0, z + 480, 430, 1250, 550, yaw)); // sitjande elev
			}
			if (rng() < 0.18) {
				boxes.push(
					bx(x + r(rng, 500, 700), 0, z + r(rng, -200, 200), 400, r(rng, 1250, 1450), 250, r(rng, 0, Math.PI * 2))
				);
			}
		}
	}
	const tz = z0 - 1900;
	const teacherX = r(rng, -1600, 1600);
	boxes.push(bx(r(rng, -800, 800), 0, tz, 1400, 760, 700, r(rng, -0.1, 0.1))); // kateter
	boxes.push(figure(rng, teacherX, tz + r(rng, -300, 300), r(rng, 2.6, 3.7))); // lærar

	const camera = pick(rng, [
		// sitjande elev bakarst: pulthøgd-perspektivet
		lookFrom([deskPos[0], 1150, deskPos[1] + 1400], [0, 900, tz], 210),
		// læraren ser utover klassen
		lookFrom([teacherX, 1650, tz - 300], [0, 900, z0 + rows * sz * 0.4], 205),
		// hjørnehøgt (vaktmeisterstigen)
		lookFrom([x0 - 2200, 2900, z0 + rows * sz + 1500], [0, 700, 0], 220)
	]);
	return { boxes, camera };
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
			boxes.push(
				person(
					rng,
					x + r(rng, 700, 1100),
					z + r(rng, -400, 400),
					r(rng, 0, Math.PI * 2),
					weightedPose(rng, [
						['staande', 2],
						['boygd', 2],
						['lener', 1],
						['hukande', 1]
					])
				)
			);
		}
	}
	// gaffeltruck
	const fx = r(rng, -2500, 2500);
	const fz = r(rng, -1500, 2500);
	const fy = r(rng, 0, Math.PI * 2);
	boxes.push(bx(fx, 0, fz, 1350, 1150, 2100, fy));
	const dir: [number, number] = [Math.sin(fy), Math.cos(fy)];
	boxes.push(bx(fx + dir[0] * 1200, 0, fz + dir[1] * 1200, 260, 2700, 220, fy));
	boxes.push(bx(fx, 1850, fz, 1050, 130, 950, fy));

	const camera = pick(rng, [
		// det høge fabrikkblikket (som i arket)
		lookFrom([-1400, 3600, 5200], [500, 0, -500], 235),
		// arbeidar i gangen
		lookFrom([pts[0][0] + 1300, 1620, pts[0][1] + 1800], [fx, 900, fz], 225),
		// like bak gaffeltrucken, i køyreretninga
		lookFrom([fx - dir[0] * 3200, 1900, fz - dir[1] * 3200], [fx + dir[0] * 2000, 800, fz + dir[1] * 2000], 230)
	]);
	return { boxes, camera };
}

// --- stall: hestar av boksar (kropp, hovud, fire bein) + handterar ---
function stall(rng: Rng): Preset {
	const boxes: Box[] = [];
	const pts = scatter(rng, ri(rng, 2, 4), 3200, 2400, 2300);
	let head: V3 = [0, 1500, 0];
	for (const [x, z] of pts) {
		const yaw = r(rng, 0, Math.PI * 2);
		const dir: [number, number] = [Math.sin(yaw), Math.cos(yaw)];
		const side: [number, number] = [Math.cos(yaw), -Math.sin(yaw)];
		boxes.push(bx(x, 780, z, 500, 650, 1600, yaw)); // kropp
		head = [x + dir[0] * 950, 1500, z + dir[1] * 950];
		boxes.push(bx(head[0], 1250, head[2], 260, 560, 340, yaw + r(rng, -0.35, 0.35))); // hovud
		for (const [sxs, szs] of [
			[1, 1],
			[1, -1],
			[-1, 1],
			[-1, -1]
		] as Array<[number, number]>) {
			boxes.push(
				bx(x + side[0] * 150 * sxs + dir[0] * 600 * szs, 0, z + side[1] * 150 * sxs + dir[1] * 600 * szs, 120, 780, 120, yaw)
			);
		}
	}
	for (let i = 0; i < ri(rng, 1, 2); i++) {
		boxes.push(
			person(
				rng,
				r(rng, -3000, 3000),
				r(rng, -2200, 2200),
				r(rng, 0, Math.PI * 2),
				weightedPose(rng, [
					['staande', 2],
					['lener', 1],
					['boygd', 1]
				])
			)
		);
	}
	const first = pts[0] ?? [0, 0];
	const camera = pick(rng, [
		// ståande blant hestane
		lookFrom([first[0] + 2400, 1620, first[1] + 2600], [first[0], 1100, first[1]], 210),
		// froskeblikk mellom beina
		lookFrom([first[0] + 1100, 500, first[1] - 900], [head[0], 1300, head[2]], 245),
		// auge i auge med hesten
		lookFrom([head[0] + 900, 1450, head[2] + 900], [head[0], 1350, head[2]], 200)
	]);
	return { boxes, camera };
}

// --- hovudstudie: hovudboksar på sokkel, fritt roterte ---
function hovudstudie(rng: Rng): Preset {
	const boxes: Box[] = [];
	const n = ri(rng, 6, 9);
	const cols = 3;
	let topHead: V3 = [0, 1400, 0];
	for (let i = 0; i < n; i++) {
		const x = ((i % cols) - 1) * 1250 + r(rng, -260, 260);
		const z = (Math.floor(i / cols) - 1) * 1250 + r(rng, -260, 260);
		const ph = r(rng, 1150, 1500);
		boxes.push(bx(x, 0, z, 170, ph, 170, 0)); // sokkel
		boxes.push(bx(x, ph, z, 230, 290, 250, r(rng, 0, Math.PI * 2))); // hovud
		if (i === 0) topHead = [x, ph + 145, z];
	}
	boxes.push(person(rng, r(rng, -2400, 2400), r(rng, 1800, 2600), r(rng, 2.4, 3.9), 'staande'));
	const camera = pick(rng, [
		// teiknaren sin plass: i hovudhøgd, tett på
		lookFrom([topHead[0] + 1400, topHead[1] + 100, topHead[2] + 1600], topHead, 195),
		// sokkelhøgd: hovuda mot himmelen
		lookFrom([0, 1000, 2600], [0, 1500, -400], 215),
		// rolegare oversyn
		lookFrom([-2200, 2100, 2800], [0, 1200, 0], 200)
	]);
	return { boxes, camera };
}

// --- figurrekkje: oppstilte figurar i varierte yaw + referansekubar ---
function figurrekkje(rng: Rng): Preset {
	const boxes: Box[] = [];
	const n = ri(rng, 5, 8);
	const x0 = (-(n - 1) / 2) * 900;
	for (let i = 0; i < n; i++) {
		boxes.push(figure(rng, x0 + i * 900 + r(rng, -120, 120), r(rng, -300, 300), r(rng, 0, Math.PI * 2)));
	}
	for (let i = 0; i < ri(rng, 2, 4); i++) {
		boxes.push(bx(r(rng, -3000, 3000), 0, r(rng, 1200, 2600), 500, 500, 500, r(rng, 0, Math.PI * 2)));
	}
	const sxp = r(rng, -2500, 2500);
	boxes.push(bx(sxp, 0, 2000, 500, 500, 500, r(rng, 0, 0.4)));
	boxes.push(bx(sxp, 500, 2000, 450, 450, 450, r(rng, 0.2, 0.7)));
	const camera = pick(rng, [
		// klassisk: ståande rett framfor rekkja
		lookFrom([0, 1780, 3200], [0, 1300, 0], 220),
		// froskeblikk langs rekkja: figurane tårnar
		lookFrom([x0 - 1200, 420, 600], [x0 + n * 450, 1500, -200], 245),
		// skrått ovanfrå (studieblikket)
		lookFrom([2600, 4600, 3400], [0, 600, 0], 230)
	]);
	return { boxes, camera };
}

// --- gate: husrekkjer, buss, bilar, skuter — og kanskje eit beist ---
function gate(rng: Rng): Preset {
	const boxes: Box[] = [];
	const halfStreet = 4200;
	// husrekkjer på begge sider
	for (const sideSign of [-1, 1]) {
		let z = -r(rng, 9000, 12000);
		while (z < 10000) {
			const w = r(rng, 3800, 7000);
			const h = r(rng, 5500, 14000);
			const d = r(rng, 4000, 7500);
			boxes.push(bx(sideSign * (halfStreet + w / 2), 0, z + d / 2, w, h, d, r(rng, -0.03, 0.03)));
			z += d + r(rng, 300, 1400);
		}
	}
	// buss i gata
	const busZ = r(rng, -2500, 1500);
	const busX = -1300;
	boxes.push(bx(busX, 0, busZ, 2500, 3150, 11000, r(rng, -0.04, 0.04)));
	// bilar
	for (let i = 0; i < ri(rng, 1, 3); i++) {
		boxes.push(
			bx(r(rng, 600, 2600), 0, busZ + r(rng, -6000, 7000), 1800, 1450, 4500, r(rng, -0.1, 0.1))
		);
	}
	// skuter med førar
	const scX = r(rng, 800, 2400);
	const scZ = busZ + r(rng, 7000, 9500);
	boxes.push(bx(scX, 0, scZ, 700, 1100, 1900, r(rng, -0.2, 0.2)));
	boxes.push(bx(scX, 700, scZ + 250, 500, 800, 380, r(rng, -0.2, 0.2))); // førar: hovud ~1.5 m
	// nokre fotgjengarar på fortaua, dei fleste gåande
	for (let i = 0; i < ri(rng, 1, 3); i++) {
		const walkYaw = pick(rng, [0, Math.PI]) + r(rng, -0.2, 0.2);
		boxes.push(
			person(
				rng,
				pick(rng, [-1, 1]) * r(rng, 3200, 3900),
				busZ + r(rng, -7000, 8000),
				walkYaw,
				weightedPose(rng, [
					['gaande', 3],
					['staande', 1]
				])
			)
		);
	}
	// beistet i enden av gata (kjg-nikk)
	if (rng() < 0.5) {
		boxes.push(bx(r(rng, -1500, 1500), 0, busZ - r(rng, 9000, 12000), 2300, 5200, 6500, r(rng, -0.4, 0.4)));
	}
	const camera = pick(rng, [
		// stupet: frå takhøgd ned i gata (arket med bussen)
		lookFrom([halfStreet + 1500, r(rng, 8200, 9800), busZ + 6500], [-700, 0, busZ - 2500], 248),
		// skuterføraren sitt blikk mot bussen
		lookFrom([scX, 1450, scZ + 2300], [busX, 1800, busZ + 3500], 225),
		// fotgjengar på fortauet
		lookFrom([-halfStreet + 700, 1680, busZ + 6500], [busX + 800, 1600, busZ - 2000], 220)
	]);
	return { boxes, camera };
}

// --- teiknekveld: golvlerret med kunstnarar og publikum i ring ---
function teiknekveld(rng: Rng): Preset {
	const boxes: Box[] = [];
	// lerretet på golvet
	boxes.push(bx(0, 0, 0, r(rng, 2200, 2800), 30, r(rng, 3200, 3900), r(rng, -0.1, 0.1)));
	// spann og flasker
	for (let i = 0; i < ri(rng, 3, 5); i++) {
		const a = r(rng, 0, Math.PI * 2);
		const rad = r(rng, 1500, 2100);
		boxes.push(bx(Math.cos(a) * rad, 0, Math.sin(a) * rad, 280, 330, 280, r(rng, 0, 1)));
	}
	// hukande kunstnarar ved lerretkanten, vende mot midten
	for (let i = 0; i < ri(rng, 2, 4); i++) {
		const a = r(rng, 0, Math.PI * 2);
		const rad = r(rng, 1400, 1900);
		const x = Math.cos(a) * rad;
		const z = Math.sin(a) * rad;
		boxes.push(bx(x, 0, z, 650, 950, 550, Math.atan2(-x, -z)));
	}
	// publikum: indre ring sit, ytre står; ope gap for blikket
	const gapA = r(rng, 0, Math.PI * 2);
	for (const [rad, sit, count] of [
		[2900, true, ri(rng, 8, 11)],
		[3700, false, ri(rng, 9, 13)]
	] as Array<[number, boolean, number]>) {
		for (let i = 0; i < count; i++) {
			const a = gapA + 0.5 + (i / count) * (Math.PI * 2 - 1.0) + r(rng, -0.06, 0.06);
			const x = Math.cos(a) * (rad + r(rng, -180, 180));
			const z = Math.sin(a) * (rad + r(rng, -180, 180));
			boxes.push(
				sit
					? person(rng, x, z, Math.atan2(-x, -z), 'sitgolv')
					: person(rng, x, z, Math.atan2(-x, -z) + r(rng, -0.2, 0.2), 'staande')
			);
		}
	}
	const gx = Math.cos(gapA) * 3300;
	const gz = Math.sin(gapA) * 3300;
	const camera = pick(rng, [
		// frå gapet i ringen, ståande, mot lerretet
		lookFrom([gx, 1650, gz], [0, 150, 0], 210),
		// sitjande på golvet i indre ring
		lookFrom([Math.cos(gapA + 0.7) * 2800, 920, Math.sin(gapA + 0.7) * 2800], [0, 100, 0], 222),
		// målarblikket: heilt nede ved lerretkanten
		lookFrom([Math.cos(gapA + 2.1) * 1900, 860, Math.sin(gapA + 2.1) * 1900], [0, 250, 0], 228),
		// over skuldrene: høgt innandørs blikk
		lookFrom([gx * 0.8, 3400, gz * 0.8], [0, 0, 0], 230)
	]);
	return { boxes, camera };
}

// --- interiør: badet — rom med veggar, fast innreiing og figurar ---
function interiør(rng: Rng): Preset {
	const boxes: Box[] = [];
	const W = r(rng, 3400, 4200); // x-utstrekning
	const D = r(rng, 2800, 3600); // z-utstrekning
	const H = 2600;
	const T = 120;
	// fire veggar (kamera står inni; fiskeauget ser det meste)
	boxes.push(bx(0, 0, -D / 2 - T / 2, W + 2 * T, H, T)); // bak
	boxes.push(bx(0, 0, D / 2 + T / 2, W + 2 * T, H, T)); // front
	boxes.push(bx(-W / 2 - T / 2, 0, 0, T, H, D)); // venstre
	boxes.push(bx(W / 2 + T / 2, 0, 0, T, H, D)); // høgre
	// innreiing langs veggene
	const sinkX = r(rng, -W / 4, W / 4);
	boxes.push(bx(sinkX, 0, -D / 2 + 290, 1300, 850, 560, 0)); // servantbenk
	boxes.push(bx(sinkX - 350, 850, -D / 2 + 180, 90, 230, 90, 0)); // flaske
	boxes.push(bx(sinkX + 300, 850, -D / 2 + 200, 80, 200, 80, 0)); // flaske
	boxes.push(bx(W / 2 - 420, 0, r(rng, -300, 500), 430, 780, 690, -Math.PI / 2)); // klosett mot høgre vegg
	boxes.push(bx(-W / 2 + 400, 0, r(rng, -200, 300), 760, 560, 1700, 0)); // badekar langs venstre
	boxes.push(bx(W / 2 - 220, 0, D / 2 - 500, 320, r(rng, 1300, 1800), 320, 0)); // hylle i hjørnet
	// figurar: ståande ved servanten, hukande på golvet, sitjande mot veggen
	boxes.push(bx(sinkX, 0, -D / 2 + 850, 500, r(rng, 1650, 1800), 300, Math.PI)); // vend mot servanten
	boxes.push(bx(r(rng, -500, 300), 0, r(rng, 100, 700), 620, 900, 520, r(rng, 0, Math.PI * 2))); // hukande
	if (rng() < 0.6) boxes.push(person(rng, -W / 2 + 700, D / 2 - 750, Math.PI / 2, 'sitgolv')); // sit på golvet

	const camera = pick(rng, [
		// frå fremre hjørne, i ståhøgd, mot servanten (romblikket i arket)
		lookFrom([W / 2 - 900, 1450, D / 2 - 550], [sinkX, 850, -D / 2 + 400], 235),
		// lågt golvblikk mot klosettet (kjg-drama)
		lookFrom([-W / 2 + 800, 520, D / 2 - 800], [W / 2 - 500, 600, 0], 250),
		// døropninga: heile rommet i eitt sveip
		lookFrom([0, 1650, D / 2 - 250], [sinkX * 0.5, 900, -D / 2], 240)
	]);
	return { boxes, camera };
}

// --- marknad: bodar med stolpar og tak, seljarar bak borda, kundar i midtgangen ---
function marknad(rng: Rng): Preset {
	const boxes: Box[] = [];
	const aisleHalf = 1900;
	const nPerSide = ri(rng, 3, 4);
	const pitch = 2900;
	const z0 = (-(nPerSide - 1) / 2) * pitch;
	for (const side of [-1, 1]) {
		for (let i = 0; i < nPerSide; i++) {
			if (rng() < 0.15) continue; // hol i rekkja
			const x = side * (aisleHalf + 750) + r(rng, -120, 120);
			const z = z0 + i * pitch + r(rng, -160, 160);
			const yaw = (side < 0 ? Math.PI / 2 : -Math.PI / 2) + r(rng, -0.06, 0.06);
			boxes.push(bx(x, 0, z, 1800, 900, 800, yaw)); // bord
			// fire hjørnestolpar + tak
			const dir: [number, number] = [Math.sin(yaw), Math.cos(yaw)];
			const perp: [number, number] = [Math.cos(yaw), -Math.sin(yaw)];
			for (const [a, bSign] of [
				[1, 1],
				[1, -1],
				[-1, 1],
				[-1, -1]
			] as Array<[number, number]>) {
				boxes.push(
					bx(x + perp[0] * 950 * a + dir[0] * 550 * bSign, 0, z + perp[1] * 950 * a + dir[1] * 550 * bSign, 80, 2150, 80, yaw)
				);
			}
			boxes.push(bx(x, 2150, z, 2100, 90, 1350, yaw)); // tak-slab
			// varer og kassar
			if (rng() < 0.7) boxes.push(bx(x + perp[0] * r(rng, -500, 500), 900, z + perp[1] * r(rng, -500, 500), 450, 260, 350, yaw + r(rng, -0.3, 0.3)));
			if (rng() < 0.5) boxes.push(bx(x + dir[0] * 900, 0, z + dir[1] * 900, 500, 420, 400, yaw + r(rng, -0.4, 0.4)));
			// seljar bak bordet
			boxes.push(
				person(rng, x - dir[0] * 900, z - dir[1] * 900, Math.atan2(dir[0], dir[1]) + r(rng, -0.2, 0.2), weightedPose(rng, [
					['staande', 2],
					['lener', 2],
					['boygd', 1]
				]))
			);
		}
	}
	// kundar i midtgangen
	const walkDir = rng() < 0.5 ? 0 : Math.PI;
	for (let i = 0; i < ri(rng, 3, 5); i++) {
		const z = z0 + r(rng, -800, (nPerSide - 1) * pitch + 800);
		boxes.push(
			person(rng, r(rng, -1100, 1100), z, walkDir + r(rng, -0.5, 0.5), weightedPose(rng, [
				['gaande', 3],
				['staande', 2],
				['lener', 1]
			]), rng() < 0.15 ? r(rng, 0.62, 0.74) : 1)
		);
	}
	if (rng() < 0.4) boxes.push(...dog(rng, r(rng, -900, 900), z0 + r(rng, 0, nPerSide * pitch * 0.6), r(rng, 0, Math.PI * 2)));
	const camera = pick(rng, [
		// kunde midt i gangen, ser nedover marknaden
		lookFrom([r(rng, -500, 500), 1650, z0 - 2400], [0, 1200, z0 + nPerSide * pitch * 0.6], 222),
		// barneauge mellom bodane
		lookFrom([r(rng, -700, 700), 1010, z0 + pitch], [300, 1500, z0 + nPerSide * pitch], 232),
		// bak ein bod, over seljarskuldra mot gangen
		lookFrom([aisleHalf + 2300, 1600, z0 + pitch * 1.2], [-500, 1000, z0 + pitch * 2.2], 228)
	]);
	return { boxes, camera };
}

// --- containerhamn: stabla containerar i rekkjer, smale gater, kranbein ---
function containerhamn(rng: Rng): Preset {
	const boxes: Box[] = [];
	const C: [number, number, number] = [2440, 2600, 6060];
	const rows = ri(rng, 2, 3);
	const perRow = ri(rng, 3, 4);
	const gate = r(rng, 3200, 4200); // gategap mellom rekkjene
	const x0 = (-(rows - 1) / 2) * (C[0] + gate);
	const z0 = (-(perRow - 1) / 2) * (C[2] + 900);
	for (let rI = 0; rI < rows; rI++) {
		for (let i = 0; i < perRow; i++) {
			if (rng() < 0.12) continue;
			const x = x0 + rI * (C[0] + gate) + r(rng, -80, 80);
			const z = z0 + i * (C[2] + 900) + r(rng, -220, 220);
			const yaw = r(rng, -0.025, 0.025);
			const stackH = ri(rng, 1, 3);
			for (let sI = 0; sI < stackH; sI++) {
				boxes.push(bx(x + r(rng, -60, 60), sI * C[1], z + r(rng, -60, 60), C[0], C[1], C[2], yaw + r(rng, -0.015, 0.015)));
			}
		}
	}
	// kran over midtgata: to bein + tverrbjelke
	if (rng() < 0.7) {
		const kz = z0 + r(rng, 0, (perRow - 1) * (C[2] + 900));
		const legX = x0 + (C[0] + gate) / 2;
		const span = C[0] + gate + 2400;
		boxes.push(bx(legX - span / 2, 0, kz, 650, 8600, 650));
		boxes.push(bx(legX + span / 2, 0, kz, 650, 8600, 650));
		boxes.push(bx(legX, 8600, kz, span + 650, 700, 900));
	}
	// hamnearbeidarar i gata
	for (let i = 0; i < ri(rng, 1, 3); i++) {
		boxes.push(
			person(rng, x0 + (C[0] + gate) / 2 + r(rng, -900, 900), z0 + r(rng, 0, (perRow - 1) * (C[2] + 900)), r(rng, 0, Math.PI * 2), weightedPose(rng, [
				['gaande', 2],
				['staande', 2],
				['boygd', 1]
			]))
		);
	}
	const gapX = x0 + (C[0] + gate) / 2;
	const camera = pick(rng, [
		// i containergata: stålveggane sveipar i fiskeauget
		lookFrom([gapX + r(rng, -600, 600), 1650, z0 - 3400], [gapX, 2200, z0 + perRow * (C[2] + 900) * 0.7], 230),
		// oppå ein stabel, ser ned gata
		lookFrom([gapX - (C[0] + gate) / 2 - 600, 5600, z0 - 1500], [gapX, 1200, z0 + perRow * (C[2] + 900) * 0.55], 238),
		// arbeidarauge tett på eit hjørne
		lookFrom([gapX - 1500, 1450, z0 + 2400], [gapX + 2600, 2600, z0 + 8200], 226)
	]);
	return { boxes, camera };
}

// --- byggeplass: stillasgrid av stolpar og bjelkar, pallar, arbeidarar ---
function byggeplass(rng: Rng): Preset {
	const boxes: Box[] = [];
	const cols = ri(rng, 3, 4);
	const rowsN = 2;
	const gx = 2100;
	const gz = 2300;
	const x0 = (-(cols - 1) / 2) * gx;
	const z0 = (-(rowsN - 1) / 2) * gz;
	const lvls = ri(rng, 2, 3);
	// stolpar
	for (let cI = 0; cI < cols; cI++) {
		for (let rI = 0; rI < rowsN; rI++) {
			boxes.push(bx(x0 + cI * gx, 0, z0 + rI * gz, 110, lvls * 2000 + 400, 110));
		}
	}
	// bjelkar i x-retning per nivå + plattingar
	for (let lvl = 1; lvl <= lvls; lvl++) {
		const y = lvl * 2000;
		for (let rI = 0; rI < rowsN; rI++) {
			boxes.push(bx(0, y, z0 + rI * gz, (cols - 1) * gx + 300, 110, 110));
		}
		if (rng() < 0.8) {
			const cI = ri(rng, 0, cols - 2);
			boxes.push(bx(x0 + cI * gx + gx / 2, y + 60, 0, gx, 70, gz + 400)); // platting
			if (rng() < 0.6) {
				// arbeidar oppå plattinga
				const worker = person(
					rng,
					x0 + cI * gx + gx / 2 + r(rng, -500, 500),
					r(rng, -600, 600),
					r(rng, 0, Math.PI * 2),
					weightedPose(rng, [
						['boygd', 2],
						['hukande', 2],
						['staande', 1]
					])
				);
				worker.min[1] = y + 130;
				boxes.push(worker);
			}
		}
	}
	// pallar og materialstablar på bakken
	for (let i = 0; i < ri(rng, 3, 5); i++) {
		const x = r(rng, x0 - 2600, x0 + cols * gx + 800);
		const z = r(rng, -3400, 3400);
		const yaw = r(rng, 0, Math.PI * 2);
		boxes.push(bx(x, 0, z, 1200, 150, 1000, yaw));
		if (rng() < 0.75) boxes.push(bx(x, 150, z, r(rng, 800, 1100), r(rng, 500, 900), r(rng, 700, 950), yaw + r(rng, -0.1, 0.1)));
	}
	// arbeidarar på bakken
	for (let i = 0; i < ri(rng, 2, 3); i++) {
		boxes.push(
			person(rng, r(rng, x0 - 1800, x0 + cols * gx + 600), r(rng, -3000, 3000), r(rng, 0, Math.PI * 2), weightedPose(rng, [
				['boygd', 2],
				['hukande', 1],
				['gaande', 2],
				['staande', 1]
			]))
		);
	}
	const camera = pick(rng, [
		// inne i stillaset: gridet rammar alt
		lookFrom([x0 + gx * 0.6, 1620, z0 + gz + 2900], [x0 + (cols - 1) * gx * 0.5, 2400, z0], 232),
		// oppå plattinga, ser ned og bort
		lookFrom([x0 + gx, lvls * 2000 + 1500, 1200], [x0 + (cols - 1) * gx, 800, -2600], 236),
		// froskeblikk tett innunder stillaset: stolpane tårnar
		lookFrom([x0 - 900, 540, 1700], [x0 + (cols - 1) * gx * 0.55, 2600, z0 - 600], 244)
	]);
	return { boxes, camera };
}

// --- bibliotek: hyllerekkjer som smale gater, lesebord, sitjande lesarar ---
function bibliotek(rng: Rng): Preset {
	const boxes: Box[] = [];
	const rowsN = ri(rng, 3, 5);
	const segs = ri(rng, 2, 4);
	const pitch = r(rng, 1700, 2100); // gate mellom hyllene
	const x0 = (-(rowsN - 1) / 2) * pitch;
	const segL = 2200;
	const z0 = (-(segs * segL) / 2) * 0.5;
	for (let rI = 0; rI < rowsN; rI++) {
		for (let sI = 0; sI < segs; sI++) {
			if (rng() < 0.07) continue;
			boxes.push(bx(x0 + rI * pitch, 0, z0 + sI * (segL + 250), 320, r(rng, 2050, 2300), segL, r(rng, -0.02, 0.02)));
		}
	}
	// browsarar i gangane
	for (let i = 0; i < ri(rng, 2, 4); i++) {
		const lane = ri(rng, 0, rowsN - 2);
		boxes.push(
			person(rng, x0 + lane * pitch + pitch / 2 + r(rng, -220, 220), z0 + r(rng, 0, segs * segL), rng() < 0.5 ? Math.PI / 2 : -Math.PI / 2, weightedPose(rng, [
				['staande', 3],
				['lener', 2],
				['hukande', 1]
			]))
		);
	}
	// lesekrok framfor hyllene
	const tz = z0 + segs * (segL + 250) + 2100;
	for (let i = 0; i < ri(rng, 2, 3); i++) {
		const tx = r(rng, x0, x0 + (rowsN - 1) * pitch);
		const yaw = r(rng, -0.2, 0.2);
		boxes.push(bx(tx, 0, tz, 1600, 750, 900, yaw));
		boxes.push(bx(tx - 500, 0, tz + 800, 420, 450, 420, yaw));
		const reader = person(rng, tx - 500, tz + 780, yaw + Math.PI, 'sitjande');
		boxes.push(reader);
		if (rng() < 0.6) boxes.push(bx(tx + r(rng, -300, 300), 750, tz + r(rng, -200, 200), 350, 60, 250, r(rng, 0, 0.5))); // open bok
	}
	const camera = pick(rng, [
		// i hyllegata: kunnskapskløfta
		lookFrom([x0 + pitch / 2, 1620, z0 - 2600], [x0 + pitch / 2 + r(rng, -200, 200), 1500, z0 + segs * segL], 228),
		// sitjande lesar ser opp mot hyllene
		lookFrom([x0 + pitch, 1130, tz - 300], [x0 + pitch * 0.5, 1700, z0 + segL], 224),
		// hjørnehøgt oversyn
		lookFrom([x0 - 2400, 2900, tz + 1400], [x0 + (rowsN - 1) * pitch * 0.6, 900, z0 + segL], 226)
	]);
	return { boxes, camera };
}

const GENERATORS: Record<PresetName, (rng: Rng) => Preset> = {
	folkemengd,
	klasserom,
	verkstad,
	stall,
	hovudstudie,
	figurrekkje,
	gate,
	teiknekveld,
	interiør,
	marknad,
	containerhamn,
	byggeplass,
	bibliotek
};

export function buildPreset(name: PresetName, rng: Rng): Preset {
	return GENERATORS[name](rng);
}

export function randomPresetName(rng: Rng): PresetName {
	return PRESET_NAMES[Math.floor(rng() * PRESET_NAMES.length) % PRESET_NAMES.length];
}

// ---- kvalitetsvakt: KVAR lasting skal vere eit sterkt startpunkt ----
// komposisjonen vert skåra (0..1) i skjermrommet til det valde kameraet:
// - hard null: kamera inne i ein boks, eller < 3 synlege boksar
// - visFrac: del av boksane som faktisk er i biletet
// - spreiing: kor mykje av ramma dei synlege boksane spenner
// - nærfelt: næraste boks bør ruve (0.35–5.2 m frå auget)
// - tal: minst ~6 boksar i biletet gjev full utteljing

export const PRESET_SCORE_MIN = 0.55;

export function scorePreset(p: Preset, view = { w: 1200, h: 800 }): number {
	if (p.boxes.length === 0) return 0;
	const f = makeFrame(p.camera, { w: view.w, h: view.h, fit: 'cover' });
	let vis = 0;
	let minX = Infinity;
	let maxX = -Infinity;
	let minY = Infinity;
	let maxY = -Infinity;
	let dNear = Infinity;
	for (const b of p.boxes) {
		if (pointInBox(f.pos, b)) return 0;
		const c = centroid(b);
		const s = project(f, c);
		if (!s.visible) continue;
		if (s.x < -60 || s.x > view.w + 60 || s.y < -60 || s.y > view.h + 60) continue;
		vis++;
		if (s.x < minX) minX = s.x;
		if (s.x > maxX) maxX = s.x;
		if (s.y < minY) minY = s.y;
		if (s.y > maxY) maxY = s.y;
		const d = Math.hypot(c[0] - f.pos[0], c[1] - f.pos[1], c[2] - f.pos[2]);
		if (d < dNear) dNear = d;
	}
	if (vis < 3) return 0;
	const visFrac = vis / p.boxes.length;
	const spread = ((maxX - minX) * (maxY - minY)) / (view.w * view.h);
	const near =
		dNear < 350 ? dNear / 350 : dNear <= 3800 ? 1 : Math.max(0, 1 - (dNear - 3800) / 4800);
	const count = Math.min(1, vis / 6);
	return 0.3 * visFrac + 0.25 * Math.min(1, spread / 0.32) + 0.25 * near + 0.2 * count;
}

// trekk om att til komposisjonen står seg; behald beste forsøket som fallback
export function buildGreatPreset(name: PresetName, rng: Rng, tries = 10): Preset {
	let best: Preset | null = null;
	let bestScore = -1;
	for (let i = 0; i < tries; i++) {
		const p = buildPreset(name, rng);
		const s = scorePreset(p);
		if (s > bestScore) {
			best = p;
			bestScore = s;
		}
		if (s >= PRESET_SCORE_MIN) return p;
	}
	return best as Preset;
}

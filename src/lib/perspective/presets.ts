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
	| 'bibliotek'
	| 'karavane'
	| 'konsert'
	| 'perrong'
	| 'kjøkken'
	| 'kontor'
	| 'croquis'
	| 'matbar';

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
	'bibliotek',
	'karavane',
	'konsert',
	'perrong',
	'kjøkken',
	'kontor',
	'croquis',
	'matbar'
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
			if (rng() < 0.65) boxes.push(bx(x + r(rng, -160, 160), 740, z + r(rng, -80, 80), 250, r(rng, 60, 140), 190, yaw + r(rng, -0.4, 0.4))); // bok/bunke
			if (rng() < 0.35) boxes.push(bx(x + r(rng, 380, 480), 0, z + r(rng, 150, 350), 300, 420, 200, r(rng, 0, Math.PI * 2))); // skulesekk
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
		if (kind === 0) {
			boxes.push(bx(x, 0, z, 1800, 900, 760, yaw)); // benk
			// papirbunke og benkelampe (fabrikk-arket)
			if (rng() < 0.6) boxes.push(bx(x + r(rng, -500, 500), 900, z + r(rng, -180, 180), 330, r(rng, 25, 90), 430, yaw + r(rng, -0.3, 0.3)));
			if (rng() < 0.45) {
				const lx = x + r(rng, 550, 780) * (rng() < 0.5 ? 1 : -1);
				boxes.push(bx(lx, 900, z + r(rng, -220, 220), 60, 460, 60, yaw));
				boxes.push(bx(lx + r(rng, -140, 140), 1360, z + r(rng, -220, 220), 190, 120, 270, yaw + r(rng, -0.5, 0.5)));
			}
			// verktøy og emne på benkeplata
			for (let tI = 0; tI < ri(rng, 1, 3); tI++) {
				const off = r(rng, -650, 650);
				const dirB: [number, number] = [Math.sin(yaw), Math.cos(yaw)];
				const perpB: [number, number] = [Math.cos(yaw), -Math.sin(yaw)];
				const tb = bx(
					x + perpB[0] * off + dirB[0] * r(rng, -180, 180),
					900,
					z + perpB[1] * off + dirB[1] * r(rng, -180, 180),
					r(rng, 180, 420),
					r(rng, 90, 320),
					r(rng, 150, 350),
					yaw + r(rng, -0.5, 0.5)
				);
				boxes.push(tb);
			}
		}
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
			if (rng() < 0.5) boxes.push(bx(sideSign * (halfStreet - 500), 2600, z + d / 2 + r(rng, -800, 800), r(rng, 1600, 2800), 160, 1050)); // markise
			if (rng() < 0.4) boxes.push(bx(sideSign * (halfStreet - 260), r(rng, 3200, 4600), z + d / 2 + r(rng, -900, 900), 160, r(rng, 500, 900), 520)); // skilt
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

// --- karavane: ryttarar på kamel, hest og struts — dyra bygde av boksar (kjg-demoarket) ---
function kamel(rng: Rng, x: number, z: number, yaw: number): { boxes: Box[]; topY: number } {
	const out: Box[] = [];
	const dir: [number, number] = [Math.sin(yaw), Math.cos(yaw)];
	const side: [number, number] = [Math.cos(yaw), -Math.sin(yaw)];
	out.push(bx(x, 1100, z, 700, 900, 2200, yaw)); // kropp høgt på beina
	for (const [a, b] of [
		[1, 1],
		[1, -1],
		[-1, 1],
		[-1, -1]
	] as Array<[number, number]>) {
		out.push(bx(x + side[0] * 240 * a + dir[0] * 850 * b, 0, z + side[1] * 240 * a + dir[1] * 850 * b, 140, 1100, 140, yaw));
	}
	out.push(bx(x + dir[0] * 1250, 1450, z + dir[1] * 1250, 240, 900, 240, yaw)); // hals opp
	out.push(bx(x + dir[0] * 1500, 2280, z + dir[1] * 1500, 300, 260, 460, yaw + r(rng, -0.25, 0.25))); // hovud
	return { boxes: out, topY: 2000 };
}

function struts(rng: Rng, x: number, z: number, yaw: number): { boxes: Box[]; topY: number } {
	const out: Box[] = [];
	const dir: [number, number] = [Math.sin(yaw), Math.cos(yaw)];
	const side: [number, number] = [Math.cos(yaw), -Math.sin(yaw)];
	out.push(bx(x, 900, z, 520, 700, 950, yaw)); // fjørkropp
	for (const a of [1, -1]) {
		out.push(bx(x + side[0] * 130 * a, 0, z + side[1] * 130 * a, 110, 900, 110, yaw));
	}
	out.push(bx(x + dir[0] * 520, 1550, z + dir[1] * 520, 170, 1050, 170, yaw)); // hals
	out.push(bx(x + dir[0] * 690, 2540, z + dir[1] * 690, 220, 190, 340, yaw + r(rng, -0.3, 0.3))); // hovud
	return { boxes: out, topY: 1600 };
}

function hestMount(rng: Rng, x: number, z: number, yaw: number): { boxes: Box[]; topY: number } {
	const out: Box[] = [];
	const dir: [number, number] = [Math.sin(yaw), Math.cos(yaw)];
	const side: [number, number] = [Math.cos(yaw), -Math.sin(yaw)];
	out.push(bx(x, 780, z, 500, 650, 1600, yaw));
	out.push(bx(x + dir[0] * 950, 1250, z + dir[1] * 950, 260, 560, 340, yaw + r(rng, -0.3, 0.3)));
	for (const [a, b] of [
		[1, 1],
		[1, -1],
		[-1, 1],
		[-1, -1]
	] as Array<[number, number]>) {
		out.push(bx(x + side[0] * 150 * a + dir[0] * 600 * b, 0, z + side[1] * 150 * a + dir[1] * 600 * b, 120, 780, 120, yaw));
	}
	return { boxes: out, topY: 1430 };
}

function karavane(rng: Rng): Preset {
	const boxes: Box[] = [];
	const theta = r(rng, 0, Math.PI * 2);
	const dir: [number, number] = [Math.cos(theta), Math.sin(theta)];
	const perp: [number, number] = [-dir[1], dir[0]];
	const walkYaw = Math.atan2(dir[0], dir[1]);
	const ox = r(rng, -1200, 1200);
	const oz = r(rng, -1000, 1000);
	const n = ri(rng, 3, 5);
	let along = 0;
	for (let i = 0; i < n; i++) {
		along += r(rng, 2600, 3400);
		const lat = r(rng, -450, 450);
		const x = ox + dir[0] * along + perp[0] * lat;
		const z = oz + dir[1] * along + perp[1] * lat;
		const kind = ri(rng, 0, 2);
		const mount = kind === 0 ? kamel(rng, x, z, walkYaw + r(rng, -0.15, 0.15)) : kind === 1 ? struts(rng, x, z, walkYaw + r(rng, -0.15, 0.15)) : hestMount(rng, x, z, walkYaw + r(rng, -0.15, 0.15));
		boxes.push(...mount.boxes);
		// ryttar: sit nedi dyret (sitgolv-proporsjonar over setet)
		const rider = person(rng, x, z, walkYaw + r(rng, -0.2, 0.2), 'sitgolv');
		rider.min[1] = mount.topY - 120;
		boxes.push(rider);
	}
	// gjetarar til fots + geiteflokk
	for (let i = 0; i < ri(rng, 1, 2); i++) {
		boxes.push(person(rng, ox + dir[0] * r(rng, 800, along) + perp[0] * r(rng, 900, 1600) * (rng() < 0.5 ? 1 : -1), oz + dir[1] * r(rng, 800, along) + perp[1] * r(rng, 900, 1600) * (rng() < 0.5 ? 1 : -1), walkYaw + r(rng, -0.3, 0.3), 'gaande'));
	}
	for (let i = 0; i < ri(rng, 2, 5); i++) {
		const gAlong = r(rng, 600, Math.max(1200, along));
		const gSide = (rng() < 0.5 ? 1 : -1) * r(rng, 700, 1500);
		const gx = ox + dir[0] * gAlong + perp[0] * gSide;
		const gz = oz + dir[1] * gAlong + perp[1] * gSide;
		const gy = walkYaw + r(rng, -0.4, 0.4);
		const gd: [number, number] = [Math.sin(gy), Math.cos(gy)];
		boxes.push(bx(gx, 0, gz, 280, r(rng, 480, 620), 780, gy));
		boxes.push(bx(gx + gd[0] * 450, r(rng, 480, 620) - 100, gz + gd[1] * 450, 180, 260, 300, gy));
	}
	const mid: [number, number] = [ox + dir[0] * along * 0.55, oz + dir[1] * along * 0.55];
	const camera = pick(rng, [
		// til fots attmed karavanen, ser skrått framover langs lina
		lookFrom([mid[0] + perp[0] * 1600, 1680, mid[1] + perp[1] * 1600], [mid[0] + dir[0] * 2600, 1500, mid[1] + dir[1] * 2600], 224),
		// froskeblikk under kamelhøgda, midt i fylgjet: dyr og ryttarar tårnar
		lookFrom([mid[0] - dir[0] * 2100 + perp[0] * 950, 520, mid[1] - dir[1] * 2100 + perp[1] * 950], [mid[0] + dir[0] * 1800, 1900, mid[1] + dir[1] * 1800], 240),
		// ryttarblikk: i salshøgd midt i fylgjet
		lookFrom([mid[0] - dir[0] * 1800 + perp[0] * 500, 2050, mid[1] - dir[1] * 1800 + perp[1] * 500], [mid[0] + dir[0] * 2400, 1700, mid[1] + dir[1] * 2400], 226)
	]);
	return { boxes, camera };
}

// --- konsert: scene med band, forsterkarar, lysrigg og tett publikum ---
function konsert(rng: Rng): Preset {
	const boxes: Box[] = [];
	const stageW = r(rng, 5200, 6600);
	boxes.push(bx(0, 0, -2600, stageW, 620, 3600)); // scenegolv
	// band på scena
	for (let i = 0; i < ri(rng, 3, 4); i++) {
		const m = person(rng, r(rng, -stageW / 2 + 700, stageW / 2 - 700), r(rng, -3600, -1900), Math.PI + r(rng, -0.4, 0.4), weightedPose(rng, [
			['staande', 3],
			['lener', 2],
			['boygd', 1]
		]));
		m.min[1] = 620;
		boxes.push(m);
	}
	// forsterkarar og monitorwedgar
	for (const sx of [-1, 1]) {
		boxes.push(bx(sx * (stageW / 2 - 500), 620, -3900, 620, 950, 520));
		if (rng() < 0.7) boxes.push(bx(sx * (stageW / 2 - 1300), 620, -1100, 520, 360, 420, r(rng, -0.4, 0.4)));
	}
	// trommesett-klynge
	const dx = r(rng, -800, 800);
	boxes.push(bx(dx, 620, -3700, 550, 480, 550));
	boxes.push(bx(dx - 450, 620, -3550, 300, 700, 300));
	boxes.push(bx(dx + 430, 620, -3600, 340, 340, 340));
	// lysrigg: to tårn + tverrbjelke + kastarar
	boxes.push(bx(-stageW / 2 - 500, 0, -2600, 300, 5000, 300));
	boxes.push(bx(stageW / 2 + 500, 0, -2600, 300, 5000, 300));
	boxes.push(bx(0, 4750, -2600, stageW + 1300, 260, 300));
	for (let i = 0; i < 4; i++) {
		boxes.push(bx(-stageW / 2 + 800 + i * ((stageW - 1600) / 3), 4380, -2600, 240, 370, 240, r(rng, -0.3, 0.3)));
	}
	// publikum i boge framfor scena
	const rows = ri(rng, 2, 3);
	for (let rI = 0; rI < rows; rI++) {
		const rad = 2400 + rI * 1150;
		const count = 6 + rI * 3;
		for (let i = 0; i < count; i++) {
			const a = -Math.PI / 2 + ((i + 0.5) / count - 0.5) * 1.9;
			const x = Math.cos(a) * rad;
			const z = -2600 + Math.sin(a) * rad * -1 + 2600 + Math.sin(a) * 0; // boge mot scena
			const px = x + r(rng, -180, 180);
			const pz = 700 + rI * 1150 + Math.abs(x) * 0.12 + r(rng, -250, 250);
			boxes.push(person(rng, px, pz, Math.PI + r(rng, -0.25, 0.25), rng() < 0.8 ? 'staande' : 'gaande'));
			// barn på skuldrene
			if (rI === rows - 1 && rng() < 0.12) {
				boxes.push(bx(px, 1780, pz, 360, 780, 240, Math.PI + r(rng, -0.3, 0.3)));
			}
		}
	}
	const camera = pick(rng, [
		// midt i publikum, mot scena
		lookFrom([r(rng, -900, 900), 1660, r(rng, 2600, 3600)], [0, 1500, -2800], 224),
		// fyrste rad, froskeblikk opp mot band og rigg
		lookFrom([r(rng, -700, 700), 640, 600], [dx, 2400, -3300], 242),
		// frå scena, bak bandet, ut over publikum (kim-blikket)
		lookFrom([r(rng, -1200, 1200), 1850, -4300], [0, 1300, 2800], 230)
	]);
	return { boxes, camera };
}

// --- perrong: tog som vegg, søylerekkje med tak, ventande folk og bagasje ---
function perrong(rng: Rng): Preset {
	const boxes: Box[] = [];
	const cars = ri(rng, 3, 4);
	const carL = 16000;
	const z0 = (-(cars * (carL + 400))) / 2;
	for (let i = 0; i < cars; i++) {
		boxes.push(bx(-3400, 0, z0 + i * (carL + 400) + carL / 2, 3100, 3750, carL, r(rng, -0.004, 0.004)));
	}
	// søyler + samanhengande takslab
	const span = cars * (carL + 400) * 0.5;
	for (let z = -span / 2; z <= span / 2; z += 4500) {
		boxes.push(bx(1500, 0, z + r(rng, -100, 100), 380, 3000, 380));
	}
	boxes.push(bx(1500, 3000, 0, 3400, 220, span + 2000)); // tak
	// benker med sitjande + ventande med bagasje
	for (let i = 0; i < ri(rng, 3, 4); i++) {
		const bz = r(rng, -span / 2 + 1200, span / 2 - 1200);
		boxes.push(bx(2600, 0, bz, 600, 450, 1750, 0));
		if (rng() < 0.8) {
			const sitter = person(rng, 2600, bz + r(rng, -450, 450), -Math.PI / 2, 'sitgolv');
			sitter.min[1] = 450;
			boxes.push(sitter);
		}
	}
	for (let i = 0; i < ri(rng, 5, 7); i++) {
		const pz = r(rng, -span / 2, span / 2);
		const px = r(rng, -1100, 1100);
		boxes.push(person(rng, px, pz, r(rng, 0, Math.PI * 2), weightedPose(rng, [
			['staande', 3],
			['gaande', 2],
			['lener', 1]
		])));
		if (rng() < 0.6) boxes.push(bx(px + r(rng, 350, 550), 0, pz + r(rng, -200, 200), 380, r(rng, 550, 750), 250, r(rng, 0, 0.6))); // koffert
	}
	if (rng() < 0.5) boxes.push(bx(r(rng, -500, 1000), 0, r(rng, -span / 2, span / 2), 650, 950, 1100, r(rng, -0.2, 0.2))); // tralle
	const camera = pick(rng, [
		// på perrongen: togveggen og søylene som kløft
		lookFrom([r(rng, -300, 600), 1660, span / 2 + 2200], [-1200, 1700, -span / 4], 228),
		// sitjande på benken
		lookFrom([2500, 1180, r(rng, -2000, 2000)], [-1800, 1500, r(rng, -9000, -3000)], 224),
		// froskeblikk på perrongkanten: togveggen, søylene og taket i eitt sveip
		lookFrom([-900, 540, -span / 2 - 1100], [-2600, 2300, span / 2.6], 242)
	]);
	return { boxes, camera };
}

// --- kjøkken: benkerekkjer, gryter, avtrekk, kokkar i arbeid ---
function kjøkken(rng: Rng): Preset {
	const boxes: Box[] = [];
	const runL = r(rng, 5200, 6800);
	const aisle = r(rng, 1500, 1900);
	for (const sx of [-1, 1]) {
		const x = sx * (aisle / 2 + 375);
		boxes.push(bx(x, 0, 0, 750, 900, runL, 0)); // benkerekkje
		// gryter, fat og stablar på plata
		for (let i = 0; i < ri(rng, 4, 7); i++) {
			boxes.push(bx(x + r(rng, -180, 180), 900, r(rng, -runL / 2 + 300, runL / 2 - 300), r(rng, 220, 400), r(rng, 140, 380), r(rng, 220, 400), r(rng, 0, Math.PI)));
		}
	}
	// avtrekkshetter over eine rekkja
	for (let i = 0; i < ri(rng, 2, 3); i++) {
		boxes.push(bx(aisle / 2 + 375, 2050, -runL / 2 + 900 + i * (runL / (3 + 0.0)), 1150, 420, 1500));
	}
	// hyllereol i enden + stablar på golvet
	boxes.push(bx(0, 0, -runL / 2 - 900, aisle + 1500, r(rng, 1800, 2100), 420));
	for (let i = 0; i < ri(rng, 1, 3); i++) {
		boxes.push(bx(r(rng, -aisle / 2, aisle / 2), 0, runL / 2 - r(rng, 300, 1200), 420, r(rng, 350, 650), 420, r(rng, 0, 1)));
	}
	// kokkar
	for (let i = 0; i < ri(rng, 2, 4); i++) {
		const sx = rng() < 0.5 ? -1 : 1;
		boxes.push(
			person(rng, sx * (aisle / 2 - 260), r(rng, -runL / 2 + 500, runL / 2 - 500), sx < 0 ? -Math.PI / 2 : Math.PI / 2, weightedPose(rng, [
				['boygd', 3],
				['staande', 2],
				['hukande', 1]
			]))
		);
	}
	const camera = pick(rng, [
		// i midtgangen: dampgata
		lookFrom([r(rng, -250, 250), 1640, runL / 2 + 1700], [0, 1100, -runL / 2], 228),
		// bøygd kokkeblikk over benken
		lookFrom([-(aisle / 2 + 900), 1380, r(rng, -1500, 1500)], [aisle / 2 + 400, 950, r(rng, -2500, 500)], 232),
		// froskeblikk frå golvet ved hyllereolen
		lookFrom([r(rng, -600, 600), 520, -runL / 2 + 600], [200, 1400, runL / 2], 242)
	]);
	return { boxes, camera };
}

// --- kontor: pultøyar med skjermar, skiljeveggar, møtebord, planter ---
function kontor(rng: Rng): Preset {
	const boxes: Box[] = [];
	const pods = ri(rng, 2, 3);
	for (let pI = 0; pI < pods; pI++) {
		const cx = (pI - (pods - 1) / 2) * r(rng, 4200, 4800);
		const cz = r(rng, -900, 900);
		const yaw = r(rng, -0.12, 0.12);
		const dir: [number, number] = [Math.sin(yaw), Math.cos(yaw)];
		const perp: [number, number] = [Math.cos(yaw), -Math.sin(yaw)];
		for (const [a, b] of [
			[1, 1],
			[1, -1],
			[-1, 1],
			[-1, -1]
		] as Array<[number, number]>) {
			const px = cx + perp[0] * 780 * a + dir[0] * 480 * b;
			const pz = cz + perp[1] * 780 * a + dir[1] * 480 * b;
			boxes.push(bx(px, 0, pz, 1400, 720, 700, yaw)); // pult
			boxes.push(bx(px + dir[0] * 60 * b, 720, pz + dir[1] * 60 * b, 540, 350, 70, yaw)); // skjerm
			if (rng() < 0.7) {
				boxes.push(bx(px - dir[0] * 750 * b, 0, pz - dir[1] * 750 * b, 420, 450, 420, yaw)); // stol
				const worker = person(rng, px - dir[0] * 720 * b, pz - dir[1] * 720 * b, b > 0 ? yaw : yaw + Math.PI, 'sitgolv');
				worker.min[1] = 430;
				boxes.push(worker);
			}
		}
		boxes.push(bx(cx, 0, cz, 60, 1350, 1900, yaw)); // skiljevegg midt i øya
	}
	// møtebord med folk
	const mz = r(rng, 3800, 4800);
	boxes.push(bx(0, 0, mz, 2400, 740, 1100, r(rng, -0.1, 0.1)));
	for (let i = 0; i < ri(rng, 2, 4); i++) {
		const sx = rng() < 0.5 ? -1 : 1;
		const sitter = person(rng, r(rng, -900, 900), mz + sx * 850, sx > 0 ? Math.PI : 0, 'sitgolv');
		sitter.min[1] = 430;
		boxes.push(bx(sitter.min[0] + sitter.size[0] / 2, 0, sitter.min[2] + sitter.size[2] / 2, 420, 450, 420));
		boxes.push(sitter);
	}
	// planter og tavle
	for (let i = 0; i < ri(rng, 1, 3); i++) {
		boxes.push(bx(r(rng, -5500, 5500), 0, r(rng, -2800, 2800), 340, r(rng, 950, 1500), 340, 0));
	}
	boxes.push(bx(r(rng, -3200, 3200), 0, -3300, 1500, 1750, 120, r(rng, -0.15, 0.15))); // tavle på fot
	const camera = pick(rng, [
		// ståande mellom øyane
		lookFrom([r(rng, -1400, 1400), 1660, 2500], [0, 1000, -1600], 224),
		// sitjande kollega-blikk over skjermane
		lookFrom([r(rng, -2200, 2200), 1180, r(rng, -400, 800)], [0, 900, -2400], 226),
		// hjørnehøgt, over skiljeveggane
		lookFrom([-5200, 2750, 3600], [800, 700, -1200], 230)
	]);
	return { boxes, camera };
}

// --- croquis: modell på podium, ring av staffeli med sitjande og ståande teiknarar ---
function croquis(rng: Rng): Preset {
	const boxes: Box[] = [];
	const W = r(rng, 9500, 11500);
	const D = r(rng, 8000, 9500);
	const H = 3200;
	const T = 140;
	// tre vegger (open front mot kameraet sin vanlege plass)
	boxes.push(bx(0, 0, -D / 2 - T / 2, W + 2 * T, H, T));
	boxes.push(bx(-W / 2 - T / 2, 0, 0, T, H, D));
	boxes.push(bx(W / 2 + T / 2, 0, 0, T, H, D));
	// podium med stol, modell og parasoll (arket!)
	const pz = -D / 2 + r(rng, 1800, 2600);
	const px = r(rng, -1500, 1500);
	boxes.push(bx(px, 0, pz, 2200, 420, 1700, r(rng, -0.08, 0.08)));
	boxes.push(bx(px + r(rng, -300, 300), 420, pz, 430, 480, 430, r(rng, -0.3, 0.3))); // stol
	const model = person(rng, px, pz + 100, Math.PI + r(rng, -0.25, 0.25), 'sitjande');
	model.min[1] = 420;
	boxes.push(model);
	if (rng() < 0.6) {
		boxes.push(bx(px + r(rng, -400, 400), 420, pz - 300, 70, 2100, 70)); // parasollstong
		boxes.push(bx(px + r(rng, -400, 400), 2450, pz - 300, 1500, 130, 1500, r(rng, 0, 0.8))); // duk
	}
	// to bogar av staffeli: fremre sit, bakre står
	for (const [rad, sitRow, count] of [
		[3100, true, ri(rng, 5, 7)],
		[4600, false, ri(rng, 6, 8)]
	] as Array<[number, boolean, number]>) {
		for (let i = 0; i < count; i++) {
			const a = Math.PI / 2 + ((i + 0.5) / count - 0.5) * 1.75 + r(rng, -0.05, 0.05);
			const ex = px + Math.cos(a) * rad * (W / 2 / 5200);
			const ez = pz + Math.sin(a) * rad;
			if (Math.abs(ex) > W / 2 - 700 || ez > D / 2 - 600) continue;
			const toward = Math.atan2(px - ex, pz - ez);
			// staffeli: skrå plate + støttestolpe bak
			boxes.push(bx(ex, sitRow ? 300 : 550, ez, 720, sitRow ? 1150 : 1350, 90, toward + r(rng, -0.12, 0.12)));
			boxes.push(bx(ex - Math.sin(toward) * 260, 0, ez - Math.cos(toward) * 260, 80, sitRow ? 1500 : 1900, 80, toward));
			// teiknaren bak staffeliet
			const axp = ex - Math.sin(toward) * 640;
			const azp = ez - Math.cos(toward) * 640;
			if (sitRow) {
				boxes.push(bx(axp, 0, azp, 360, 440, 360, toward)); // krakk
				boxes.push(person(rng, axp, azp - 60, toward, 'sitjande'));
			} else {
				boxes.push(person(rng, axp, azp, toward, weightedPose(rng, [
					['staande', 3],
					['lener', 1]
				])));
			}
			if (rng() < 0.3) boxes.push(bx(axp + r(rng, 350, 550), 0, azp + r(rng, -250, 250), 340, 430, 260, r(rng, 0, Math.PI * 2))); // sekk
		}
	}
	const camera = pick(rng, [
		// ståande i bakre ring, over staffelia mot modellen
		lookFrom([px + r(rng, -1200, 1200), 1660, pz + 5300], [px, 1250, pz], 226),
		// sitjande teiknar, tett bak eige staffeli
		lookFrom([px + r(rng, -2000, 2000), 1210, pz + 3600], [px, 1100, pz], 230),
		// MODELLENS blikk attende på heile klassen
		lookFrom([px, 1720, pz - 500], [px, 1100, pz + 4600], 234),
		// froskeblikk frå golvet ved podiumkanten
		lookFrom([px + 1900, 520, pz + 900], [px - 400, 1500, pz + 2600], 242)
	]);
	return { boxes, camera };
}

// --- matbar: trong osaka-gate med diskar, krakkar, gjester og hengjande skilt ---
function matbar(rng: Rng): Preset {
	const boxes: Box[] = [];
	const L = r(rng, 6500, 8500);
	const half = r(rng, 950, 1250); // halv korridorbreidd
	const T = 150;
	const H = 2500;
	for (const sx of [-1, 1]) {
		boxes.push(bx(sx * (half + 500 + T / 2), 0, 0, T, H, L)); // vegg
		boxes.push(bx(sx * (half + 250), 0, 0, 500, r(rng, 1000, 1100), L * 0.92)); // disk
		// flasker, fat og kanner på disken
		for (let i = 0; i < ri(rng, 5, 9); i++) {
			const iz = r(rng, -L / 2 + 400, L / 2 - 400);
			const kind = rng();
			if (kind < 0.4) boxes.push(bx(sx * (half + r(rng, 120, 360)), 1060, iz, 70, r(rng, 180, 260), 70));
			else if (kind < 0.7) boxes.push(bx(sx * (half + r(rng, 120, 340)), 1060, iz, 240, 45, 240, r(rng, 0, 1)));
			else boxes.push(bx(sx * (half + r(rng, 140, 330)), 1060, iz, 180, r(rng, 110, 170), 180, r(rng, 0, 1)));
		}
		// hyller på veggen over disken
		for (let i = 0; i < ri(rng, 1, 3); i++) {
			boxes.push(bx(sx * (half + 380), r(rng, 1500, 1950), r(rng, -L / 3, L / 3), 300, 60, r(rng, 900, 1600)));
		}
	}
	// hengjande skilt midt i gata (dei oransje banner-boksane)
	for (let i = 0; i < ri(rng, 2, 4); i++) {
		boxes.push(bx(r(rng, -half + 250, half - 250), r(rng, 1800, 2050), r(rng, -L / 2 + 600, L / 2 - 600), r(rng, 320, 520), r(rng, 380, 560), 60, r(rng, -0.15, 0.15)));
	}
	// gjester: lenande over disken og sitjande på krakkar; alltid folk på begge sider
	for (let i = 0; i < ri(rng, 4, 6); i++) {
		const sx = i % 2 === 0 ? -1 : 1;
		const gz = r(rng, -L / 2 + 700, L / 2 - 700);
		const facing = sx < 0 ? -Math.PI / 2 : Math.PI / 2;
		if (rng() < 0.55) {
			boxes.push(person(rng, sx * (half - 290), gz, facing, 'lener')); // heilt inntil disken
		} else {
			boxes.push(bx(sx * (half - 300), 0, gz, 320, 460, 320)); // krakk
			boxes.push(person(rng, sx * (half - 330), gz - 40, facing, 'sitjande'));
		}
		if (rng() < 0.3) boxes.push(bx(sx * (half - 420), 0, gz + r(rng, 350, 550), 340, 430, 270, r(rng, 0, Math.PI * 2))); // sekk på golvet
	}
	boxes.push(person(rng, (rng() < 0.5 ? -1 : 1) * (half + 250), r(rng, -L / 3, L / 3), rng() < 0.5 ? Math.PI / 2 : -Math.PI / 2, 'boygd')); // kokk bak disken
	// éin gåande i gata
	boxes.push(person(rng, r(rng, -250, 250), r(rng, -L / 4, L / 4), (rng() < 0.5 ? 0 : Math.PI) + r(rng, -0.2, 0.2), 'gaande'));
	const camera = pick(rng, [
		// ståande i den tronge gata (arkets blikk)
		lookFrom([r(rng, -200, 200), 1580, L / 2 + 900], [r(rng, -300, 300), 1150, -L / 2], 232),
		// sitjande ved disken, ser skrått nedover gata
		lookFrom([-(half - 500), 1230, r(rng, 500, 1500)], [half - 200, 1050, -L / 2 + 800], 234),
		// kokkens blikk over disken mot gjestene
		lookFrom([half + 700, 1500, r(rng, -1000, 1000)], [-half + 300, 1200, r(rng, -2400, 2400)], 236)
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
	bibliotek,
	karavane,
	konsert,
	perrong,
	kjøkken,
	kontor,
	croquis,
	matbar
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

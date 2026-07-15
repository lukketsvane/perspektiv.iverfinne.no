// ops.ts — omset semantiske gest-handlingar til endringar i doc/kamera.
// M3: kamera. M4: boksar. Historikk/eksport (M5) kjem i sin milepæl.

import { cycleProj, look, orbit, setEye, setFov, walk } from '../perspective/camera';
import {
	centroid,
	cloneBox,
	figureBoxAt,
	makeBoxFromFootprint,
	newId,
	rayPlaneY,
	snapMm,
	snapYaw,
	stackBaseY,
	type Box,
	type Doc,
	type Ray,
	type Settings
} from '../perspective/scene';
import { unproject, type Frame, type V3 } from '../perspective/projection';
import type { Action, NumericCtx } from './gestures';

// aktiv boks-gest med før-tilstand for avbrot
type Gest =
	| { kind: 'draw'; a: [number, number]; baseY: number }
	| { kind: 'move'; id: string; backup: Box; offX: number; offZ: number; added: boolean }
	| { kind: 'push'; id: string; backup: Box; hGrab: number }
	| { kind: 'vmove'; id: string; backup: Box; yGrab: number }
	| { kind: 'rotate'; id: string; backup: Box; acc: number }
	| null;

export type Ui = {
	doc: Doc;
	selection: string | null;
	frame: Frame | null;
	ghost: Box | null;
	footprint: [[number, number], [number, number], number] | null;
	pressRing: { x: number; y: number; t: number } | null;
	hudText: string;
	hudUntil: number;
	sheet: { open: boolean; x: number; y: number };
	gridPreset: number;
	gest: Gest;
	dirty: boolean;
	now: () => number;
};

export function makeUi(doc: Doc, now: () => number): Ui {
	return {
		doc,
		selection: null,
		frame: null,
		ghost: null,
		footprint: null,
		pressRing: null,
		hudText: '',
		hudUntil: -1,
		sheet: { open: false, x: 0, y: 0 },
		gridPreset: 0,
		gest: null,
		dirty: true,
		now
	};
}

export const HUD_LINGER_MS = 800;

function hud(ui: Ui, text: string) {
	ui.hudText = text;
	ui.hudUntil = ui.now() + HUD_LINGER_MS;
}

function hudEye(ui: Ui) {
	hud(ui, `augehøgd ${Math.round(ui.doc.camera.pos[1])} mm`);
}

function hudFov(ui: Ui) {
	const deg = Math.round((ui.doc.camera.fov * 180) / Math.PI);
	hud(ui, `fov ${deg}° · ${ui.doc.camera.proj}`);
}

export function ctxLabel(ctx: NumericCtx | null): string {
	switch (ctx) {
		case 'eye':
			return 'augehøgd (mm)';
		case 'fov':
			return 'fov (°)';
		case 'height':
			return 'høgd (mm)';
		case 'rot':
			return 'rotasjon (°)';
		case 'vmove':
			return 'vertikal (mm)';
		default:
			return '';
	}
}

export function selectedBox(ui: Ui): Box | null {
	return ui.doc.boxes.find((b) => b.id === ui.selection) ?? null;
}

function boxById(ui: Ui, id: string): Box | null {
	return ui.doc.boxes.find((b) => b.id === id) ?? null;
}

// ---- geometri-hjelparar (all plukking via unproject, §2) ----

function pointerRay(ui: Ui, x: number, y: number): Ray | null {
	if (!ui.frame) return null;
	return { origin: ui.frame.pos, dir: unproject(ui.frame, x, y) };
}

function planePointAt(ui: Ui, x: number, y: number, planeY: number): V3 | null {
	const r = pointerRay(ui, x, y);
	return r ? rayPlaneY(r, planeY) : null;
}

// verds-y der peikarstrålen kryssar det kameravende vertikalplanet gjennom (cx, cz);
// grunnlaget for høgd-gestane (ekstruder, push/pull, vertikal flytt)
function heightAt(ui: Ui, x: number, y: number, cx: number, cz: number): number | null {
	const r = pointerRay(ui, x, y);
	if (!r || !ui.frame) return null;
	let nx = cx - ui.frame.pos[0];
	let nz = cz - ui.frame.pos[2];
	const l = Math.hypot(nx, nz);
	if (l < 1e-6) return null;
	nx /= l;
	nz /= l;
	const denom = r.dir[0] * nx + r.dir[2] * nz;
	if (Math.abs(denom) < 1e-9) return null;
	const t = ((cx - r.origin[0]) * nx + (cz - r.origin[2]) * nz) / denom;
	if (t <= 0) return null;
	return r.origin[1] + r.dir[1] * t;
}

function restoreBackup(ui: Ui, id: string, backup: Box): void {
	const b = boxById(ui, id);
	if (!b) return;
	b.min = [...backup.min];
	b.size = [...backup.size];
	b.yaw = backup.yaw;
}

function hudBoxPos(ui: Ui, b: Box) {
	hud(ui, `x ${Math.round(b.min[0])} · z ${Math.round(b.min[2])} mm`);
}

const GRID_PRESETS: Array<[string, Partial<Settings>]> = [
	['grid: alt', { gridX: true, gridY: true, gridZ: true, floor: true, horizon: true, vps: true }],
	['grid: vertikalar', { gridX: false, gridY: true, gridZ: false, floor: false, horizon: true, vps: true }],
	['grid: horisontalar', { gridX: true, gridY: false, gridZ: true, floor: false, horizon: true, vps: true }],
	['grid: golv', { gridX: false, gridY: false, gridZ: false, floor: true, horizon: true, vps: true }],
	['grid: horisont', { gridX: false, gridY: false, gridZ: false, floor: false, horizon: true, vps: true }],
	['grid: av', { gridX: false, gridY: false, gridZ: false, floor: false, horizon: false, vps: false }]
];

export function applyAction(ui: Ui, a: Action): void {
	const cam = ui.doc.camera;
	const s = ui.doc.settings;
	const f = ui.frame;
	// kjensle: skalert med fov og skjermstorleik
	const kLook = cam.fov / (2.6 * Math.max(200, f?.R ?? 400));

	switch (a.t) {
		// ---- kamera ----
		case 'look':
			look(cam, -a.dx * kLook, -a.dy * kLook);
			break;
		case 'orbit': {
			const b = selectedBox(ui);
			if (b) orbit(cam, centroid(b), a.dx * kLook, -a.dy * kLook);
			else look(cam, -a.dx * kLook, -a.dy * kLook);
			break;
		}
		case 'walk':
			// tre-finger: innhaldet følgjer fingrane
			walk(cam, -a.dy * 10, -a.dx * 10);
			break;
		case 'eye-drag':
			setEye(cam, cam.pos[1] * Math.exp(-a.dy * 0.004));
			hudEye(ui);
			break;
		case 'eye-wheel':
			setEye(cam, cam.pos[1] * Math.exp(-a.delta * 0.0012));
			hudEye(ui);
			break;
		case 'eye-set':
			setEye(cam, a.mm);
			hudEye(ui);
			break;
		case 'fov-wheel':
			setFov(cam, cam.fov + a.delta * 0.002);
			hudFov(ui);
			break;
		case 'fov-pinch':
			if (a.factor > 0) setFov(cam, cam.fov / a.factor);
			hudFov(ui);
			break;
		case 'fov-set':
			setFov(cam, (a.deg * Math.PI) / 180);
			hudFov(ui);
			break;
		case 'proj-cycle':
			cycleProj(cam);
			hudFov(ui);
			break;

		// ---- innstillingar ----
		case 'grid-cycle': {
			ui.gridPreset = (ui.gridPreset + 1) % GRID_PRESETS.length;
			const [label, patch] = GRID_PRESETS[ui.gridPreset];
			Object.assign(s, patch);
			hud(ui, label);
			break;
		}
		case 'fit-toggle':
			s.fit = s.fit === 'cover' ? 'inscribe' : 'cover';
			hud(ui, s.fit === 'cover' ? 'sirkel: cover' : 'sirkel: innskriven');
			break;
		case 'jitter-toggle':
			s.jitter = !s.jitter;
			hud(ui, s.jitter ? 'jitter: på' : 'jitter: av');
			break;
		case 'module-toggle':
			s.moduleTicks = !s.moduleTicks;
			hud(ui, s.moduleTicks ? 'modul-merke: på' : 'modul-merke: av');
			break;
		case 'faces-toggle':
			s.maskFaces = !s.maskFaces;
			hud(ui, s.maskFaces ? 'flater: maska' : 'flater: opne');
			break;

		// ---- seleksjon og flyktige element ----
		case 'select':
			ui.selection = a.id;
			break;
		case 'press-ring':
			ui.pressRing = a.p < 0 ? null : { x: a.x, y: a.y, t: a.p };
			break;

		// ---- teikn fotavtrykk → ekstruder (M4) ----
		case 'draw-start': {
			const p = planePointAt(ui, a.x, a.y, 0);
			if (!p) return;
			const start: [number, number] = [snapMm(p[0]), snapMm(p[2])];
			ui.gest = { kind: 'draw', a: start, baseY: 0 };
			ui.footprint = [start, start, 0];
			break;
		}
		case 'draw-update': {
			if (ui.gest?.kind !== 'draw') return;
			const p = planePointAt(ui, a.x, a.y, ui.gest.baseY);
			if (!p) return;
			const b: [number, number] = [snapMm(p[0]), snapMm(p[2])];
			ui.footprint = [ui.gest.a, b, ui.gest.baseY];
			hud(ui, `${Math.abs(b[0] - ui.gest.a[0])} × ${Math.abs(b[1] - ui.gest.a[1])} mm`);
			break;
		}
		case 'extrude-start': {
			if (ui.gest?.kind !== 'draw' || !ui.footprint) return;
			const [fa, fb, baseY] = ui.footprint;
			const box = makeBoxFromFootprint(newId(), fa, fb, baseY, 50);
			box.size[0] = Math.max(50, box.size[0]);
			box.size[2] = Math.max(50, box.size[2]);
			ui.ghost = box;
			ui.footprint = null;
			hud(ui, `h ${box.size[1]} mm`);
			break;
		}
		case 'extrude-update': {
			if (!ui.ghost) return;
			const c = centroid(ui.ghost);
			const hAt = heightAt(ui, a.x, a.y, c[0], c[2]);
			if (hAt === null) return;
			const h = Math.min(50000, Math.max(50, snapMm(hAt - ui.ghost.min[1])));
			ui.ghost.size[1] = h;
			hud(ui, `h ${h} mm`);
			break;
		}
		case 'height-set': {
			const h = Math.min(50000, Math.max(50, snapMm(a.mm)));
			if (ui.ghost) {
				ui.ghost.size[1] = h;
				hud(ui, `h ${h} mm`);
			} else if (ui.gest?.kind === 'push') {
				const b = boxById(ui, ui.gest.id);
				if (b) {
					b.size[1] = h;
					hud(ui, `h ${h} mm`);
				}
			}
			break;
		}
		case 'extrude-commit': {
			if (!ui.ghost) return;
			ui.doc.boxes.push(ui.ghost);
			ui.selection = ui.ghost.id;
			ui.ghost = null;
			ui.gest = null;
			break;
		}

		// ---- flytt / push-pull / vertikal / rotasjon (M4) ----
		case 'move-start': {
			const src = boxById(ui, a.id);
			if (!src) return;
			let target = src;
			let added = false;
			if (a.duplicate) {
				target = cloneBox(src);
				ui.doc.boxes.push(target);
				added = true;
			}
			ui.selection = target.id;
			const anchor = planePointAt(ui, a.x, a.y, target.min[1]);
			if (!anchor) return;
			ui.gest = {
				kind: 'move',
				id: target.id,
				backup: cloneBox(target, target.id),
				offX: target.min[0] - anchor[0],
				offZ: target.min[2] - anchor[2],
				added
			};
			break;
		}
		case 'move-update': {
			if (ui.gest?.kind !== 'move') return;
			const b = boxById(ui, ui.gest.id);
			if (!b) return;
			const anchor = planePointAt(ui, a.x, a.y, b.min[1]);
			if (!anchor) return;
			b.min[0] = snapMm(anchor[0] + ui.gest.offX);
			b.min[2] = snapMm(anchor[2] + ui.gest.offZ);
			hudBoxPos(ui, b);
			break;
		}
		case 'move-commit':
		case 'pushpull-commit':
		case 'vmove-commit':
		case 'rotate-commit':
			ui.gest = null;
			break;

		case 'pushpull-start': {
			const b = boxById(ui, a.id);
			if (!b) return;
			ui.selection = b.id;
			const c = centroid(b);
			const hGrab = heightAt(ui, a.x, a.y, c[0], c[2]) ?? b.min[1] + b.size[1];
			ui.gest = { kind: 'push', id: b.id, backup: cloneBox(b, b.id), hGrab };
			break;
		}
		case 'pushpull-update': {
			if (ui.gest?.kind !== 'push') return;
			const b = boxById(ui, ui.gest.id);
			if (!b) return;
			const c = centroid(ui.gest.backup);
			const hNow = heightAt(ui, a.x, a.y, c[0], c[2]);
			if (hNow === null) return;
			const h = Math.min(
				50000,
				Math.max(50, snapMm(ui.gest.backup.size[1] + (hNow - ui.gest.hGrab)))
			);
			b.size[1] = h;
			hud(ui, `h ${h} mm`);
			break;
		}

		case 'vmove-start': {
			const b = boxById(ui, a.id);
			if (!b) return;
			ui.selection = b.id;
			const c = centroid(b);
			const yGrab = heightAt(ui, a.x, a.y, c[0], c[2]) ?? b.min[1];
			ui.gest = { kind: 'vmove', id: b.id, backup: cloneBox(b, b.id), yGrab };
			break;
		}
		case 'vmove-update': {
			if (ui.gest?.kind !== 'vmove') return;
			const b = boxById(ui, ui.gest.id);
			if (!b) return;
			const c = centroid(ui.gest.backup);
			const yNow = heightAt(ui, a.x, a.y, c[0], c[2]);
			if (yNow === null) return;
			let newY = Math.max(0, snapMm(ui.gest.backup.min[1] + (yNow - ui.gest.yGrab)));
			// stabling: snapp til golv og toppflater i nærleiken (§2)
			if (Math.abs(newY) < 60) newY = 0;
			for (const ob of ui.doc.boxes) {
				if (ob.id === b.id) continue;
				const top = ob.min[1] + ob.size[1];
				if (Math.abs(newY - top) < 60) newY = top;
			}
			b.min[1] = newY;
			hud(ui, `y ${newY} mm`);
			break;
		}
		case 'vmove-set': {
			const b = ui.gest?.kind === 'vmove' ? boxById(ui, ui.gest.id) : selectedBox(ui);
			if (!b) return;
			b.min[1] = Math.max(0, a.mm);
			hud(ui, `y ${b.min[1]} mm`);
			break;
		}

		case 'rotate-start': {
			const b = a.id ? boxById(ui, a.id) : selectedBox(ui);
			if (!b) return;
			ui.selection = b.id;
			ui.gest = { kind: 'rotate', id: b.id, backup: cloneBox(b, b.id), acc: 0 };
			hud(ui, `${Math.round((b.yaw * 180) / Math.PI)}°`);
			break;
		}
		case 'rotate-update': {
			if (ui.gest?.kind !== 'rotate') return;
			const b = boxById(ui, ui.gest.id);
			if (!b) return;
			ui.gest.acc += a.ddeg;
			const raw = ui.gest.backup.yaw + (ui.gest.acc * Math.PI) / 180;
			b.yaw = a.free ? raw : snapYaw(raw);
			hud(ui, `${Math.round((b.yaw * 180) / Math.PI)}°`);
			break;
		}
		case 'rotate-set': {
			const b = ui.gest?.kind === 'rotate' ? boxById(ui, ui.gest.id) : selectedBox(ui);
			if (!b) return;
			b.yaw = (a.deg * Math.PI) / 180;
			hud(ui, `${Math.round(a.deg)}°`);
			break;
		}

		// ---- stempel / slett / nudge (M4) ----
		case 'figure-stamp': {
			const p = planePointAt(ui, a.x, a.y, 0);
			if (!p) return;
			const fb = figureBoxAt(newId(), snapMm(p[0]), snapMm(p[2]), 0, cam.pos);
			ui.doc.boxes.push(fb);
			ui.selection = fb.id;
			hud(ui, 'figurboks 500 × 1750 × 300');
			break;
		}
		case 'delete-selected': {
			if (!ui.selection) return;
			ui.doc.boxes = ui.doc.boxes.filter((b) => b.id !== ui.selection);
			ui.selection = null;
			break;
		}
		case 'delete-box': {
			ui.doc.boxes = ui.doc.boxes.filter((b) => b.id !== a.id);
			if (ui.selection === a.id) ui.selection = null;
			break;
		}
		case 'nudge': {
			const b = selectedBox(ui);
			if (!b) return;
			const step = a.big ? 100 : 10;
			// skjermrelative verdsaksar: dominant komponent av right/fwd
			const rx = Math.cos(cam.yaw);
			const rz = -Math.sin(cam.yaw);
			const fx = -Math.sin(cam.yaw);
			const fz = -Math.cos(cam.yaw);
			const R: [number, number] = Math.abs(rx) >= Math.abs(rz) ? [Math.sign(rx), 0] : [0, Math.sign(rz)];
			const F: [number, number] = Math.abs(fx) >= Math.abs(fz) ? [Math.sign(fx), 0] : [0, Math.sign(fz)];
			b.min[0] += a.dxSteps * step * R[0] - a.dzSteps * step * F[0];
			b.min[2] += a.dxSteps * step * R[1] - a.dzSteps * step * F[1];
			hudBoxPos(ui, b);
			break;
		}

		case 'cancel': {
			if (ui.gest) {
				const g = ui.gest;
				if (g.kind === 'move' && g.added) {
					ui.doc.boxes = ui.doc.boxes.filter((b) => b.id !== g.id);
					if (ui.selection === g.id) ui.selection = null;
				} else if (g.kind !== 'draw') {
					restoreBackup(ui, g.id, g.backup);
				}
				ui.gest = null;
			}
			ui.ghost = null;
			ui.footprint = null;
			break;
		}

		default:
			// historikk/eksport/ark (M5)
			return;
	}
	ui.dirty = true;
}

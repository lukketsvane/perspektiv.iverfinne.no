// ops.ts — omset semantiske gest-handlingar til endringar i doc/kamera.
// M3: kamera. Boks-handlingane (M4) og historikk/eksport (M5) kjem i sine milepælar.

import { cycleProj, look, orbit, setEye, setFov, walk } from '../perspective/camera';
import { centroid, type Box, type Doc, type Settings } from '../perspective/scene';
import type { Frame } from '../perspective/projection';
import type { Action, NumericCtx } from './gestures';

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
		case 'cancel':
			ui.ghost = null;
			ui.footprint = null;
			break;
		case 'press-ring':
			ui.pressRing = a.p < 0 ? null : { x: a.x, y: a.y, t: a.p };
			break;

		default:
			// boks-ops (M4), historikk/eksport/ark (M5)
			return;
	}
	ui.dirty = true;
}

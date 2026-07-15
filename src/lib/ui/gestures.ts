// gestures.ts — peikar-fsm, attkjenning med hysterese, taltasting-buffer (§4).
// rein logikk: ingen dom-import; klokke og treff-testing vert injisert.
// motoren omset rå peikarhendingar til semantiske handlingar (Action);
// all geometri (unproject, snapping, mm) skjer hjå verten.

export type GFace = 'top' | 'bottom' | 'side';

export type GHit =
	| { kind: 'box'; id: string; face: GFace }
	| { kind: 'horizon' }
	| { kind: 'floor' }
	| { kind: 'void' };

export type Mods = { shift?: boolean; alt?: boolean; meta?: boolean; ctrl?: boolean };

export type GPointer = {
	id: number;
	x: number;
	y: number;
	type: 'mouse' | 'touch' | 'pen';
	button?: number;
} & Mods;

export type NumericCtx = 'eye' | 'fov' | 'height' | 'rot' | 'vmove';

export type Action =
	// kamera
	| { t: 'look'; dx: number; dy: number }
	| { t: 'orbit'; dx: number; dy: number }
	| { t: 'walk'; dx: number; dy: number }
	| { t: 'eye-drag'; dy: number }
	| { t: 'eye-wheel'; delta: number }
	| { t: 'eye-set'; m: number } // meter (grensesnittseining)
	| { t: 'fov-wheel'; delta: number }
	| { t: 'fov-pinch'; factor: number }
	| { t: 'fov-set'; deg: number }
	| { t: 'proj-cycle' }
	| { t: 'grid-cycle' }
	| { t: 'jitter-toggle' }
	| { t: 'fit-toggle' }
	| { t: 'module-toggle' }
	| { t: 'faces-toggle' }
	// boks (verten gjer geometrien; M4)
	| { t: 'select'; id: string | null }
	| { t: 'draw-start'; x: number; y: number }
	| { t: 'draw-update'; x: number; y: number }
	| { t: 'extrude-start' }
	| { t: 'extrude-update'; x: number; y: number }
	| { t: 'extrude-commit' }
	| { t: 'height-set'; m: number }
	| { t: 'move-start'; id: string; x: number; y: number; duplicate: boolean }
	| { t: 'move-update'; x: number; y: number }
	| { t: 'move-commit' }
	| { t: 'vmove-start'; id: string; x: number; y: number }
	| { t: 'vmove-update'; x: number; y: number; dy: number }
	| { t: 'vmove-commit' }
	| { t: 'vmove-set'; m: number }
	| { t: 'pushpull-start'; id: string; x: number; y: number }
	| { t: 'pushpull-update'; x: number; y: number }
	| { t: 'pushpull-commit' }
	| { t: 'rotate-start'; id: string }
	| { t: 'rotate-update'; ddeg: number; free: boolean }
	| { t: 'rotate-commit' }
	| { t: 'rotate-set'; deg: number }
	| { t: 'figure-stamp'; x: number; y: number }
	| { t: 'delete-selected' }
	| { t: 'delete-box'; id: string }
	| { t: 'nudge'; dxSteps: number; dzSteps: number; big: boolean }
	// system
	| { t: 'undo' }
	| { t: 'redo' }
	| { t: 'sheet-open'; x: number; y: number }
	| { t: 'cancel' }
	| { t: 'press-ring'; x: number; y: number; p: number } // 0..1; p<0 = fjern
	| { t: 'export-svg' }
	| { t: 'export-json' }
	// frå arket (Sheet); motoren emitterer ikkje desse sjølv
	| { t: 'settings-patch'; patch: Record<string, boolean | string> }
	| { t: 'proj-set'; proj: string }
	// preset-lasting: null = tilfeldig val (t-tasten)
	| { t: 'preset-load'; name: string | null };

export type Host = {
	now?: () => number;
	hit: (x: number, y: number) => GHit;
	emit: (a: Action) => void;
	isSelected: (id: string) => boolean;
	hasSelection: () => boolean;
};

// hysterese-tersklar (§4)
export const LOCK_PAN_PX = 8;
export const LOCK_ROT_RAD = (6 * Math.PI) / 180;
export const LOCK_SCALE = 0.06;
export const TAP_MS = 300;
export const TAP_PX = 8;
export const LONGPRESS_DELETE_MS = 450;
export const LONGPRESS_SHEET_MS = 500;
export const NUMERIC_ARM_MS = 1400;
export const DOUBLE_TAP_MS = 320;
export const DOUBLE_TAP_PX = 24;

type Mode =
	| 'idle'
	| 'look'
	| 'orbit'
	| 'eyeDrag'
	| 'drawFootprint'
	| 'extrude'
	| 'dragMove'
	| 'dragHeight'
	| 'dragVertical'
	| 'rotate'
	| 'boxPress' // touch: kandidat for tap-vel / long-press-slett / drag-flytt
	| 'twoUndef'
	| 'look2'
	| 'twist'
	| 'pinch'
	| 'walk3'
	| 'threeUndef'
	| 'consumed'; // gest ferdig handsama (t.d. sheet); vent til alle fingrar opp

type Touch = { id: number; x0: number; y0: number; x: number; y: number; t0: number };

export type Gestures = ReturnType<typeof createGestures>;

export function createGestures(host: Host) {
	const now = host.now ?? (() => Date.now());

	let mode: Mode = 'idle';
	let mousePrev: { x: number; y: number } | null = null;
	let startHit: GHit = { kind: 'void' };
	const touches = new Map<number, Touch>();

	// to/tre-finger-attkjenning
	let groupT0 = 0;
	let maxCount = 0;
	let cent0 = { x: 0, y: 0 };
	let dist0 = 0;
	let ang0 = 0;
	let distPrev = 0;
	let centPrev = { x: 0, y: 0 };
	let anyLock = false;

	// dobbelt-tap (touch, tomt golv → figurboks)
	let lastTap = { x: 0, y: 0, t: -1e9 };

	// long-press slett (touch på boks)
	let pressBoxId: string | null = null;

	// taltasting
	let buffer = '';
	let ctx: NumericCtx | null = null;
	let armedUntil = -1;

	// tastar nede (gange)
	const keys = new Set<string>();
	let shiftDown = false;

	function emit(a: Action) {
		host.emit(a);
	}

	function armCtx(c: NumericCtx) {
		ctx = c;
		armedUntil = now() + NUMERIC_ARM_MS;
	}

	function ctxActive(): boolean {
		return ctx !== null && (mode !== 'idle' || now() <= armedUntil);
	}

	function clearNumeric() {
		buffer = '';
		ctx = null;
		armedUntil = -1;
	}

	function applyNumeric(): boolean {
		if (!ctx || buffer === '') return false;
		const v = Number.parseFloat(buffer);
		if (!Number.isFinite(v)) return false;
		switch (ctx) {
			case 'eye':
				emit({ t: 'eye-set', m: v });
				break;
			case 'fov':
				emit({ t: 'fov-set', deg: v });
				break;
			case 'height':
				emit({ t: 'height-set', m: v });
				break;
			case 'rot':
				emit({ t: 'rotate-set', deg: v });
				break;
			case 'vmove':
				emit({ t: 'vmove-set', m: v });
				break;
		}
		buffer = '';
		return true;
	}

	function centroid(): { x: number; y: number } {
		let x = 0;
		let y = 0;
		for (const t of touches.values()) {
			x += t.x;
			y += t.y;
		}
		const n = Math.max(1, touches.size);
		return { x: x / n, y: y / n };
	}

	function pairMetrics(): { dist: number; ang: number } {
		const arr = [...touches.values()];
		if (arr.length < 2) return { dist: 0, ang: 0 };
		const dx = arr[1].x - arr[0].x;
		const dy = arr[1].y - arr[0].y;
		return { dist: Math.hypot(dx, dy), ang: Math.atan2(dy, dx) };
	}

	function endSingleGesture(commit: boolean) {
		switch (mode) {
			case 'dragMove':
				if (commit) emit({ t: 'move-commit' });
				else emit({ t: 'cancel' });
				break;
			case 'dragHeight':
				if (commit) emit({ t: 'pushpull-commit' });
				else emit({ t: 'cancel' });
				break;
			case 'dragVertical':
				if (commit) emit({ t: 'vmove-commit' });
				else emit({ t: 'cancel' });
				break;
			case 'drawFootprint':
				// slepp → over i ekstrudering (vert handsama i pointerUp)
				break;
			case 'rotate':
				if (commit) emit({ t: 'rotate-commit' });
				else emit({ t: 'cancel' });
				break;
			default:
				break;
		}
	}

	function resetToIdle() {
		mode = 'idle';
		mousePrev = null;
		pressBoxId = null;
		emit({ t: 'press-ring', x: 0, y: 0, p: -1 });
	}

	// ---------- mus ----------

	function mouseDown(p: GPointer) {
		const h = host.hit(p.x, p.y);
		startHit = h;
		mousePrev = { x: p.x, y: p.y };

		if (p.button === 2) {
			mode = h.kind === 'box' && host.isSelected(h.id) ? 'orbit' : 'look';
			return;
		}
		if (p.button !== 0) return;

		if (mode === 'extrude') {
			// klikk stadfestar høgda
			emit({ t: 'extrude-commit' });
			mode = 'idle';
			clearNumeric();
			swallowNextUp = true;
			return;
		}
		if (mode === 'rotate') {
			// klikk stadfestar rotasjonen
			emit({ t: 'rotate-commit' });
			mode = 'idle';
			clearNumeric();
			swallowNextUp = true;
			return;
		}

		if (h.kind === 'box') {
			if (p.shift) {
				mode = 'dragVertical';
				armCtx('vmove');
				emit({ t: 'vmove-start', id: h.id, x: p.x, y: p.y });
			} else if (h.face === 'top') {
				mode = 'dragHeight';
				armCtx('height');
				emit({ t: 'pushpull-start', id: h.id, x: p.x, y: p.y });
			} else {
				mode = 'dragMove';
				emit({ t: 'move-start', id: h.id, x: p.x, y: p.y, duplicate: !!p.alt });
			}
			return;
		}
		if (h.kind === 'horizon') {
			mode = 'eyeDrag';
			armCtx('eye');
			return;
		}
		if (h.kind === 'floor') {
			mode = 'drawFootprint';
			emit({ t: 'draw-start', x: p.x, y: p.y });
			return;
		}
		// void: ingenting; klikk-deseleksjon skjer i mouseUp
	}

	function mouseMove(p: GPointer) {
		if (!mousePrev) {
			if (mode === 'extrude') emit({ t: 'extrude-update', x: p.x, y: p.y });
			if (mode === 'rotate') {
				// r-modus utan knapp: horisontal rørsle roterer
				if (Number.isNaN(rotPrevX)) {
					rotPrevX = p.x;
					return;
				}
				emit({ t: 'rotate-update', ddeg: (p.x - rotPrevX) * 0.4, free: !!p.shift });
				rotPrevX = p.x;
			}
			return;
		}
		const dx = p.x - mousePrev.x;
		const dy = p.y - mousePrev.y;
		mousePrev = { x: p.x, y: p.y };
		switch (mode) {
			case 'look':
				emit({ t: 'look', dx, dy });
				break;
			case 'orbit':
				emit({ t: 'orbit', dx, dy });
				break;
			case 'eyeDrag':
				armCtx('eye');
				emit({ t: 'eye-drag', dy });
				break;
			case 'drawFootprint':
				emit({ t: 'draw-update', x: p.x, y: p.y });
				break;
			case 'dragMove':
				emit({ t: 'move-update', x: p.x, y: p.y });
				break;
			case 'dragHeight':
				armCtx('height');
				emit({ t: 'pushpull-update', x: p.x, y: p.y });
				break;
			case 'dragVertical':
				armCtx('vmove');
				emit({ t: 'vmove-update', x: p.x, y: p.y, dy });
				break;
			default:
				break;
		}
	}

	function mouseUp(p: GPointer) {
		if (swallowNextUp) {
			swallowNextUp = false;
			resetToIdle();
			return;
		}
		const wasDrag =
			mousePrev === null
				? false
				: Math.hypot(p.x - (startX ?? p.x), p.y - (startY ?? p.y)) > TAP_PX;
		switch (mode) {
			case 'look':
			case 'orbit':
				resetToIdle();
				break;
			case 'eyeDrag':
				armedUntil = now() + NUMERIC_ARM_MS;
				resetToIdle();
				break;
			case 'drawFootprint':
				if (wasDrag) {
					mode = 'extrude';
					armCtx('height');
					emit({ t: 'extrude-start' });
					mousePrev = null;
				} else {
					// berre eit klikk på golvet: deseleksjon
					emit({ t: 'cancel' });
					emit({ t: 'select', id: null });
					resetToIdle();
				}
				return;
			case 'dragMove':
				if (wasDrag) emit({ t: 'move-commit' });
				else {
					emit({ t: 'cancel' });
					if (startHit.kind === 'box') emit({ t: 'select', id: startHit.id });
				}
				resetToIdle();
				break;
			case 'dragHeight':
				if (wasDrag) emit({ t: 'pushpull-commit' });
				else {
					emit({ t: 'cancel' });
					if (startHit.kind === 'box') emit({ t: 'select', id: startHit.id });
				}
				armedUntil = now() + NUMERIC_ARM_MS;
				resetToIdle();
				break;
			case 'dragVertical':
				if (wasDrag) emit({ t: 'vmove-commit' });
				else emit({ t: 'cancel' });
				armedUntil = now() + NUMERIC_ARM_MS;
				resetToIdle();
				break;
			default:
				if (startHit.kind === 'void') emit({ t: 'select', id: null });
				resetToIdle();
				break;
		}
	}

	let startX: number | null = null;
	let startY: number | null = null;
	let rotPrevX = Number.NaN;
	let swallowNextUp = false;

	// ---------- touch ----------

	function touchDown(p: GPointer) {
		touches.set(p.id, { id: p.id, x0: p.x, y0: p.y, x: p.x, y: p.y, t0: now() });
		const n = touches.size;
		maxCount = Math.max(maxCount, n);

		if (n === 1) {
			groupT0 = now();
			anyLock = false;
			const h = host.hit(p.x, p.y);
			startHit = h;
			if (mode === 'extrude') return; // fingeren styrer høgda i move; tap stadfestar i up
			if (h.kind === 'horizon') {
				mode = 'eyeDrag';
				armCtx('eye');
			} else if (h.kind === 'box') {
				mode = 'boxPress';
				pressBoxId = h.id;
			} else if (h.kind === 'floor') {
				mode = 'drawFootprint';
				emit({ t: 'draw-start', x: p.x, y: p.y });
			} else {
				mode = 'idle';
			}
			return;
		}

		if (n === 2) {
			// andre fingeren: avbryt ein-finger-gest
			if (mode === 'drawFootprint' || mode === 'extrude') {
				emit({ t: 'cancel' }); // to-finger tap avbryt teikning
				mode = 'consumed';
				clearNumeric();
				return;
			}
			if (mode === 'dragMove' || mode === 'dragHeight' || mode === 'eyeDrag' || mode === 'boxPress') {
				endSingleGesture(false);
				emit({ t: 'press-ring', x: 0, y: 0, p: -1 });
				pressBoxId = null;
			}
			groupT0 = Math.min(groupT0 || now(), now());
			mode = 'twoUndef';
			cent0 = centroid();
			centPrev = cent0;
			const m = pairMetrics();
			dist0 = m.dist;
			distPrev = m.dist;
			ang0 = m.ang;
			startHit = host.hit(cent0.x, cent0.y);
			return;
		}

		if (n === 3) {
			if (mode !== 'consumed') mode = 'threeUndef';
			cent0 = centroid();
			centPrev = cent0;
			return;
		}
	}

	function touchMove(p: GPointer) {
		const t = touches.get(p.id);
		if (!t) return;
		t.x = p.x;
		t.y = p.y;

		if (mode === 'eyeDrag' && touches.size === 1) {
			const dy = p.y - (touchPrev.get(p.id)?.y ?? p.y);
			armCtx('eye');
			emit({ t: 'eye-drag', dy });
		} else if (mode === 'drawFootprint' && touches.size === 1) {
			emit({ t: 'draw-update', x: p.x, y: p.y });
		} else if (mode === 'extrude' && touches.size === 1) {
			emit({ t: 'extrude-update', x: p.x, y: p.y });
		} else if (mode === 'boxPress') {
			const moved = Math.hypot(t.x - t.x0, t.y - t.y0);
			if (moved > TAP_PX && pressBoxId) {
				// over i flytt (topp-flate: høgd)
				emit({ t: 'press-ring', x: 0, y: 0, p: -1 });
				if (startHit.kind === 'box' && startHit.face === 'top') {
					mode = 'dragHeight';
					armCtx('height');
					emit({ t: 'pushpull-start', id: pressBoxId, x: t.x0, y: t.y0 });
					emit({ t: 'pushpull-update', x: p.x, y: p.y });
				} else {
					mode = 'dragMove';
					emit({ t: 'move-start', id: pressBoxId, x: t.x0, y: t.y0, duplicate: false });
					emit({ t: 'move-update', x: p.x, y: p.y });
				}
				pressBoxId = null;
			}
		} else if (mode === 'dragMove' && touches.size === 1) {
			emit({ t: 'move-update', x: p.x, y: p.y });
		} else if (mode === 'dragHeight' && touches.size === 1) {
			armCtx('height');
			emit({ t: 'pushpull-update', x: p.x, y: p.y });
		} else if (mode === 'twoUndef') {
			const c = centroid();
			const m = pairMetrics();
			const pan = Math.hypot(c.x - cent0.x, c.y - cent0.y);
			let dAng = m.ang - ang0;
			while (dAng > Math.PI) dAng -= 2 * Math.PI;
			while (dAng < -Math.PI) dAng += 2 * Math.PI;
			const dScale = dist0 > 0 ? Math.abs(m.dist / dist0 - 1) : 0;

			if (pan > LOCK_PAN_PX && pan / LOCK_PAN_PX >= Math.abs(dAng) / LOCK_ROT_RAD && pan / LOCK_PAN_PX >= dScale / LOCK_SCALE) {
				anyLock = true;
				mode = startHit.kind === 'box' && host.isSelected(startHit.id) ? 'orbit' : 'look2';
				centPrev = c;
			} else if (Math.abs(dAng) > LOCK_ROT_RAD && Math.abs(dAng) / LOCK_ROT_RAD >= dScale / LOCK_SCALE) {
				anyLock = true;
				if (startHit.kind === 'box' && host.isSelected(startHit.id)) {
					mode = 'twist';
					angPrev = m.ang;
					armCtx('rot');
					emit({ t: 'rotate-start', id: startHit.id });
				} else {
					mode = 'look2';
					centPrev = c;
				}
			} else if (dScale > LOCK_SCALE) {
				anyLock = true;
				mode = 'pinch';
				distPrev = m.dist;
				armCtx('fov');
			}
		} else if (mode === 'look2' || (mode === 'orbit' && touches.size >= 2)) {
			const c = centroid();
			const dx = c.x - centPrev.x;
			const dy = c.y - centPrev.y;
			centPrev = c;
			emit({ t: mode === 'orbit' ? 'orbit' : 'look', dx, dy });
		} else if (mode === 'twist') {
			const m = pairMetrics();
			let d = m.ang - angPrev;
			while (d > Math.PI) d -= 2 * Math.PI;
			while (d < -Math.PI) d += 2 * Math.PI;
			angPrev = m.ang;
			armCtx('rot');
			emit({ t: 'rotate-update', ddeg: (-d * 180) / Math.PI, free: false });
		} else if (mode === 'pinch') {
			const m = pairMetrics();
			if (distPrev > 0 && m.dist > 0) {
				armCtx('fov');
				emit({ t: 'fov-pinch', factor: m.dist / distPrev });
			}
			distPrev = m.dist;
		} else if (mode === 'threeUndef') {
			const c = centroid();
			if (Math.hypot(c.x - cent0.x, c.y - cent0.y) > LOCK_PAN_PX) {
				mode = 'walk3';
				centPrev = c;
			}
		} else if (mode === 'walk3') {
			const c = centroid();
			emit({ t: 'walk', dx: c.x - centPrev.x, dy: c.y - centPrev.y });
			centPrev = c;
		}

		touchPrev.set(p.id, { x: p.x, y: p.y });
	}

	const touchPrev = new Map<number, { x: number; y: number }>();

	function allWithin(msLimit: number, pxLimit: number): boolean {
		const t1 = now();
		for (const t of touches.values()) {
			if (t1 - t.t0 > msLimit) return false;
			if (Math.hypot(t.x - t.x0, t.y - t.y0) > pxLimit) return false;
		}
		return true;
	}

	function touchUp(p: GPointer) {
		const t = touches.get(p.id);
		const nBefore = touches.size;

		if (nBefore === maxCount && !anyLock) {
			// kandidat for fleirfinger-tap (procreate): vurder ved fyrste opp-finger
			if (maxCount === 2 && (mode === 'twoUndef' || mode === 'consumed') && allWithin(TAP_MS, TAP_PX)) {
				if (mode === 'twoUndef') emit({ t: 'undo' });
				mode = 'consumed';
			} else if (maxCount === 3 && (mode === 'threeUndef' || mode === 'consumed') && allWithin(TAP_MS, TAP_PX)) {
				if (mode === 'threeUndef') emit({ t: 'redo' });
				mode = 'consumed';
			}
		}

		if (nBefore === 1 && t) {
			const dur = now() - t.t0;
			const moved = Math.hypot(t.x - t.x0, t.y - t.y0);
			const isTap = dur <= TAP_MS && moved <= TAP_PX;

			switch (mode) {
				case 'extrude':
					if (isTap) {
						emit({ t: 'extrude-commit' });
						mode = 'idle';
						clearNumeric();
					}
					break;
				case 'drawFootprint':
					if (moved > TAP_PX) {
						mode = 'extrude';
						armCtx('height');
						emit({ t: 'extrude-start' });
					} else {
						emit({ t: 'cancel' });
						// tap på golvet: dobbelt-tap → figurboks, elles deseleksjon
						if (isTap) {
							if (
								now() - lastTap.t <= DOUBLE_TAP_MS &&
								Math.hypot(t.x0 - lastTap.x, t.y0 - lastTap.y) <= DOUBLE_TAP_PX
							) {
								emit({ t: 'figure-stamp', x: t.x0, y: t.y0 });
								lastTap = { x: 0, y: 0, t: -1e9 };
							} else {
								emit({ t: 'select', id: null });
								lastTap = { x: t.x0, y: t.y0, t: now() };
							}
						}
						mode = 'idle';
					}
					break;
				case 'boxPress':
					emit({ t: 'press-ring', x: 0, y: 0, p: -1 });
					if (isTap && pressBoxId) emit({ t: 'select', id: pressBoxId });
					pressBoxId = null;
					mode = 'idle';
					break;
				case 'dragMove':
					emit({ t: 'move-commit' });
					mode = 'idle';
					break;
				case 'dragHeight':
					emit({ t: 'pushpull-commit' });
					armedUntil = now() + NUMERIC_ARM_MS;
					mode = 'idle';
					break;
				case 'eyeDrag':
					armedUntil = now() + NUMERIC_ARM_MS;
					mode = 'idle';
					break;
				case 'twist':
					emit({ t: 'rotate-commit' });
					armedUntil = now() + NUMERIC_ARM_MS;
					mode = 'idle';
					break;
				default:
					mode = 'idle';
					break;
			}
		}

		touches.delete(p.id);
		touchPrev.delete(p.id);

		if (touches.size === 0) {
			maxCount = 0;
			if (mode === 'twist') {
				emit({ t: 'rotate-commit' });
				armedUntil = now() + NUMERIC_ARM_MS;
			}
			if (mode === 'pinch') armedUntil = now() + NUMERIC_ARM_MS;
			if (mode !== 'extrude') mode = 'idle';
			pressBoxId = null;
		} else if (touches.size === 1 && (mode === 'look2' || mode === 'orbit' || mode === 'pinch' || mode === 'twist' || mode === 'twoUndef' || mode === 'walk3' || mode === 'threeUndef')) {
			if (mode === 'twist') emit({ t: 'rotate-commit' });
			mode = 'consumed'; // ikkje tolk att-verande finger som ny gest
		}
	}

	let angPrev = 0;

	// ---------- offentleg api ----------

	function pointerDown(p: GPointer) {
		startX = p.x;
		startY = p.y;
		if (p.type === 'mouse') mouseDown(p);
		else touchDown(p);
	}

	function pointerMove(p: GPointer) {
		if (p.type === 'mouse') mouseMove(p);
		else touchMove(p);
	}

	function pointerUp(p: GPointer) {
		if (p.type === 'mouse') mouseUp(p);
		else touchUp(p);
	}

	function pointerCancel(id: number) {
		touches.delete(id);
		touchPrev.delete(id);
		if (touches.size === 0) {
			if (mode !== 'idle' && mode !== 'extrude') emit({ t: 'cancel' });
			resetToIdle();
			maxCount = 0;
		}
	}

	function wheel(deltaY: number, mods: Mods) {
		if (mods.alt) {
			armCtx('fov');
			emit({ t: 'fov-wheel', delta: deltaY });
		} else {
			armCtx('eye');
			emit({ t: 'eye-wheel', delta: deltaY });
		}
	}

	function dblclick(x: number, y: number) {
		const h = host.hit(x, y);
		if (h.kind === 'floor') emit({ t: 'figure-stamp', x, y });
	}

	// returnerer true om tasten er konsumert
	function keyDown(key: string, mods: Mods): boolean {
		if (key === 'Shift') {
			shiftDown = true;
			return false;
		}

		// taltasting midt i gest (blender-style)
		if (ctxActive()) {
			if (/^[0-9]$/.test(key) || key === '.' || (key === '-' && buffer === '')) {
				buffer += key;
				armedUntil = now() + NUMERIC_ARM_MS;
				return true;
			}
			if (key === 'Backspace') {
				buffer = buffer.slice(0, -1);
				return true; // sluk alltid backspace i talkontekst (ikkje slett boks)
			}
			if (key === 'Enter' && buffer !== '') {
				const ok = applyNumeric();
				if (ok && mode === 'extrude') {
					emit({ t: 'extrude-commit' });
					mode = 'idle';
				}
				if (ok && mode === 'rotate') {
					emit({ t: 'rotate-commit' });
					mode = 'idle';
				}
				clearNumeric();
				return true;
			}
		}

		if ((mods.meta || mods.ctrl) && key.toLowerCase() === 'z') {
			emit(mods.shift ? { t: 'redo' } : { t: 'undo' });
			return true;
		}
		if (mods.meta || mods.ctrl) {
			const k = key.toLowerCase();
			if (k === 's') {
				emit({ t: 'export-svg' });
				return true;
			}
			if (k === 'e') {
				emit({ t: 'export-json' });
				return true;
			}
			return false;
		}

		if (key === 'Escape') {
			if (mode === 'extrude' || mode === 'drawFootprint' || mode === 'rotate') {
				emit({ t: 'cancel' });
				mode = 'idle';
				clearNumeric();
				return true;
			}
			clearNumeric();
			emit({ t: 'select', id: null });
			return true;
		}
		if (key === 'Enter' && mode === 'extrude') {
			emit({ t: 'extrude-commit' });
			mode = 'idle';
			clearNumeric();
			return true;
		}
		if (key === 'Enter' && mode === 'rotate') {
			emit({ t: 'rotate-commit' });
			mode = 'idle';
			return true;
		}

		const k = key.toLowerCase();
		if (['w', 'a', 's', 'd'].includes(k) && mode !== 'rotate') {
			keys.add(k);
			return true;
		}
		if (k === 'p') {
			emit({ t: 'proj-cycle' });
			return true;
		}
		if (k === 'g') {
			emit({ t: 'grid-cycle' });
			return true;
		}
		if (k === 'j') {
			emit({ t: 'jitter-toggle' });
			return true;
		}
		if (k === 'c') {
			emit({ t: 'fit-toggle' });
			return true;
		}
		if (k === 'm') {
			emit({ t: 'module-toggle' });
			return true;
		}
		if (k === 'o') {
			emit({ t: 'faces-toggle' });
			return true;
		}
		if (k === 't') {
			emit({ t: 'preset-load', name: null });
			return true;
		}
		if ((key === 'Delete' || key === 'Backspace' || k === 'x') && host.hasSelection()) {
			emit({ t: 'delete-selected' });
			return true;
		}
		if (k === 'r' && host.hasSelection() && mode === 'idle') {
			mode = 'rotate';
			rotPrevX = Number.NaN; // fyrste musrørsle set referansen
			armCtx('rot');
			emit({ t: 'rotate-start', id: '' }); // verten brukar vald boks
			return true;
		}
		if (key.startsWith('Arrow') && host.hasSelection()) {
			const big = !!mods.shift;
			const map: Record<string, [number, number]> = {
				ArrowLeft: [-1, 0],
				ArrowRight: [1, 0],
				ArrowUp: [0, -1],
				ArrowDown: [0, 1]
			};
			const [dx, dz] = map[key] ?? [0, 0];
			if (dx || dz) {
				emit({ t: 'nudge', dxSteps: dx, dzSteps: dz, big });
				return true;
			}
		}
		return false;
	}

	function keyUp(key: string) {
		if (key === 'Shift') shiftDown = false;
		keys.delete(key.toLowerCase());
	}

	// vert kalla frå raf: long-press-sjekkar
	function tick() {
		const t1 = now();
		if (mode === 'boxPress' && pressBoxId) {
			const t = [...touches.values()][0];
			if (t) {
				const held = t1 - t.t0;
				const p = Math.min(1, held / LONGPRESS_DELETE_MS);
				emit({ t: 'press-ring', x: t.x, y: t.y, p });
				if (held >= LONGPRESS_DELETE_MS) {
					emit({ t: 'delete-box', id: pressBoxId });
					emit({ t: 'press-ring', x: 0, y: 0, p: -1 });
					pressBoxId = null;
					mode = 'consumed';
				}
			}
		}
		if (mode === 'twoUndef' && t1 - groupT0 >= LONGPRESS_SHEET_MS && allWithin(1e9, TAP_PX)) {
			const c = centroid();
			emit({ t: 'sheet-open', x: c.x, y: c.y });
			mode = 'consumed';
		}
	}

	function walkState(): { f: number; s: number; sprint: boolean; active: boolean } {
		const f = (keys.has('w') ? 1 : 0) + (keys.has('s') ? -1 : 0);
		const s = (keys.has('d') ? 1 : 0) + (keys.has('a') ? -1 : 0);
		return { f, s, sprint: shiftDown, active: f !== 0 || s !== 0 };
	}

	return {
		pointerDown,
		pointerMove,
		pointerUp,
		pointerCancel,
		wheel,
		dblclick,
		keyDown,
		keyUp,
		tick,
		walkState,
		numericBuffer: () => (ctxActive() && buffer !== '' ? buffer : null),
		numericCtx: () => (ctxActive() ? ctx : null),
		mode: () => mode as string
	};
}

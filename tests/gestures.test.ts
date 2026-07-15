import { describe, expect, it } from 'vitest';
import { createGestures, type Action, type GHit, type GPointer } from '../src/lib/ui/gestures';

// testrigg: injisert klokke, opptak av handlingar, styrbar treff-funksjon
function rig(hitKind: GHit | ((x: number, y: number) => GHit) = { kind: 'void' }, selected: string | null = null) {
	let t = 1000;
	const actions: Action[] = [];
	const engine = createGestures({
		now: () => t,
		hit: typeof hitKind === 'function' ? hitKind : () => hitKind,
		emit: (a) => actions.push(a),
		isSelected: (id) => selected === id,
		hasSelection: () => selected !== null
	});
	return {
		engine,
		actions,
		advance: (ms: number) => {
			t += ms;
		},
		types: () => actions.map((a) => a.t),
		has: (tt: Action['t']) => actions.some((a) => a.t === tt),
		clear: () => actions.splice(0)
	};
}

function tp(id: number, x: number, y: number): GPointer {
	return { id, x, y, type: 'touch' };
}

describe('hysterese-låsing (§9.8)', () => {
	it('to fingrar: pan forbi 8 px låser sjå-gesten; seinare twist vert ignorert', () => {
		const r = rig();
		r.engine.pointerDown(tp(1, 100, 100));
		r.advance(30);
		r.engine.pointerDown(tp(2, 200, 100));
		expect(r.engine.mode()).toBe('twoUndef');

		// flytt begge 12 px til høgre i realistiske 3 px-steg (vekselvis) → pan-lås
		for (let s = 3; s <= 12; s += 3) {
			r.engine.pointerMove(tp(1, 100 + s, 100));
			r.engine.pointerMove(tp(2, 200 + s, 100));
		}
		expect(r.engine.mode()).toBe('look2');
		expect(r.has('look')).toBe(true);
		r.clear();

		// kraftig twist etterpå: framleis look, ingen rotate/fov
		r.engine.pointerMove(tp(1, 112, 140));
		r.engine.pointerMove(tp(2, 212, 60));
		expect(r.has('rotate-update')).toBe(false);
		expect(r.has('fov-pinch')).toBe(false);
		expect(r.engine.mode()).toBe('look2');
	});

	it('pinch: skala forbi 6 % låser fov; pan etterpå gjev ikkje look', () => {
		const r = rig();
		r.engine.pointerDown(tp(1, 100, 100));
		r.engine.pointerDown(tp(2, 200, 100));
		// spreier symmetrisk (sentroid i ro): 100 px → 114 px avstand = 14 % skala
		r.engine.pointerMove(tp(1, 93, 100));
		r.engine.pointerMove(tp(2, 207, 100));
		expect(r.engine.mode()).toBe('pinch');
		expect(r.has('fov-pinch')).toBe(true);
		r.clear();

		r.engine.pointerMove(tp(1, 133, 140));
		r.engine.pointerMove(tp(2, 247, 140));
		expect(r.has('look')).toBe(false);
		expect(r.engine.mode()).toBe('pinch');
	});

	it('twist på vald boks låser yaw-rotasjon', () => {
		const r = rig({ kind: 'box', id: 'b1', face: 'side' }, 'b1');
		r.engine.pointerDown(tp(1, 140, 100));
		r.engine.pointerDown(tp(2, 260, 100));
		// roter paret ~14° kring sentroid (200,100): (140,100)→(142,85), (260,100)→(258,115)
		r.engine.pointerMove(tp(1, 142, 85));
		r.engine.pointerMove(tp(2, 258, 115));
		expect(r.engine.mode()).toBe('twist');
		expect(r.has('rotate-start')).toBe(true);
		expect(r.has('rotate-update')).toBe(true);
	});

	it('under terskelen: ingen lås, og rask slepp gjev to-finger-tap = undo', () => {
		const r = rig();
		r.engine.pointerDown(tp(1, 100, 100));
		r.engine.pointerDown(tp(2, 200, 100));
		r.engine.pointerMove(tp(1, 103, 101)); // 3 px < 8 px
		r.engine.pointerMove(tp(2, 203, 101));
		expect(r.engine.mode()).toBe('twoUndef');
		r.advance(120);
		r.engine.pointerUp(tp(1, 103, 101));
		r.engine.pointerUp(tp(2, 203, 101));
		expect(r.has('undo')).toBe(true);
		expect(r.has('look')).toBe(false);
		expect(r.engine.mode()).toBe('idle');
	});

	it('tre-finger-tap = redo; tre-finger-drag = gange', () => {
		const r = rig();
		r.engine.pointerDown(tp(1, 100, 100));
		r.engine.pointerDown(tp(2, 200, 100));
		r.engine.pointerDown(tp(3, 150, 200));
		r.advance(100);
		r.engine.pointerUp(tp(1, 100, 100));
		r.engine.pointerUp(tp(2, 200, 100));
		r.engine.pointerUp(tp(3, 150, 200));
		expect(r.has('redo')).toBe(true);
		expect(r.has('undo')).toBe(false);

		r.clear();
		r.engine.pointerDown(tp(1, 100, 100));
		r.engine.pointerDown(tp(2, 200, 100));
		r.engine.pointerDown(tp(3, 150, 200));
		r.engine.pointerMove(tp(1, 100, 130));
		r.engine.pointerMove(tp(2, 200, 130));
		r.engine.pointerMove(tp(3, 150, 230));
		expect(r.engine.mode()).toBe('walk3');
		expect(r.has('walk')).toBe(true);
		expect(r.has('redo')).toBe(false);
	});

	it('to-finger long-press utan rørsle opnar arket', () => {
		const r = rig();
		r.engine.pointerDown(tp(1, 100, 100));
		r.engine.pointerDown(tp(2, 200, 100));
		r.advance(600);
		r.engine.tick();
		expect(r.has('sheet-open')).toBe(true);
		expect(r.engine.mode()).toBe('consumed');
	});

	it('long-press på boks: progressring og slett etter 450 ms', () => {
		const r = rig({ kind: 'box', id: 'b9', face: 'side' });
		r.engine.pointerDown(tp(1, 100, 100));
		expect(r.engine.mode()).toBe('boxPress');
		r.advance(200);
		r.engine.tick();
		const ring = r.actions.find((a) => a.t === 'press-ring' && a.p > 0);
		expect(ring).toBeTruthy();
		expect(r.has('delete-box')).toBe(false);
		r.advance(300);
		r.engine.tick();
		expect(r.has('delete-box')).toBe(true);
	});
});

describe('taltasting-buffer (§9.8)', () => {
	const HORIZON: GHit = { kind: 'horizon' };

	it('under augehøgd-gest: siffer + enter gjev eksakt eye-set', () => {
		const r = rig(HORIZON);
		r.engine.pointerDown({ id: 1, x: 300, y: 200, type: 'mouse', button: 0 });
		expect(r.engine.mode()).toBe('eyeDrag');
		for (const k of ['1', '7', '8', '0']) expect(r.engine.keyDown(k, {})).toBe(true);
		expect(r.engine.numericBuffer()).toBe('1780');
		expect(r.engine.keyDown('Enter', {})).toBe(true);
		const set = r.actions.find((a) => a.t === 'eye-set');
		expect(set && set.t === 'eye-set' && set.mm).toBe(1780);
		expect(r.engine.numericBuffer()).toBeNull();
	});

	it('backspace redigerer bufferen og vert alltid sluka i talkontekst', () => {
		const r = rig(HORIZON);
		r.engine.pointerDown({ id: 1, x: 300, y: 200, type: 'mouse', button: 0 });
		r.engine.keyDown('3', {});
		r.engine.keyDown('5', {});
		expect(r.engine.keyDown('Backspace', {})).toBe(true);
		expect(r.engine.numericBuffer()).toBe('3');
		expect(r.engine.keyDown('Backspace', {})).toBe(true); // tom buffer: framleis sluka
		expect(r.has('delete-selected')).toBe(false);
	});

	it('etter scroll er konteksten væpna ei stund; så døyr ho', () => {
		const r = rig();
		r.engine.wheel(-120, {});
		expect(r.has('eye-wheel')).toBe(true);
		expect(r.engine.keyDown('3', {})).toBe(true);
		expect(r.engine.keyDown('0', {})).toBe(true);
		expect(r.engine.keyDown('0', {})).toBe(true);
		expect(r.engine.keyDown('Enter', {})).toBe(true);
		const set = r.actions.find((a) => a.t === 'eye-set');
		expect(set && set.t === 'eye-set' && set.mm).toBe(300);

		r.clear();
		r.advance(5000); // langt forbi vindauget
		expect(r.engine.keyDown('5', {})).toBe(false);
		expect(r.engine.numericBuffer()).toBeNull();
	});

	it('⌥scroll væpnar fov-konteksten', () => {
		const r = rig();
		r.engine.wheel(120, { alt: true });
		expect(r.has('fov-wheel')).toBe(true);
		r.engine.keyDown('2', {});
		r.engine.keyDown('2', {});
		r.engine.keyDown('0', {});
		r.engine.keyDown('Enter', {});
		const set = r.actions.find((a) => a.t === 'fov-set');
		expect(set && set.t === 'fov-set' && set.deg).toBe(220);
	});

	it('esc tømer bufferen utan å bruke verdien', () => {
		const r = rig(HORIZON);
		r.engine.pointerDown({ id: 1, x: 300, y: 200, type: 'mouse', button: 0 });
		r.engine.keyDown('9', {});
		r.engine.keyDown('9', {});
		r.engine.keyDown('Escape', {});
		expect(r.engine.numericBuffer()).toBeNull();
		expect(r.has('eye-set')).toBe(false);
	});
});

describe('grunn-fsm', () => {
	it('høgredrag = look; på vald boks = orbit', () => {
		const r1 = rig();
		r1.engine.pointerDown({ id: 1, x: 100, y: 100, type: 'mouse', button: 2 });
		r1.engine.pointerMove({ id: 1, x: 120, y: 90, type: 'mouse' });
		expect(r1.has('look')).toBe(true);

		const r2 = rig({ kind: 'box', id: 'b1', face: 'side' }, 'b1');
		r2.engine.pointerDown({ id: 1, x: 100, y: 100, type: 'mouse', button: 2 });
		r2.engine.pointerMove({ id: 1, x: 120, y: 90, type: 'mouse' });
		expect(r2.has('orbit')).toBe(true);
		expect(r2.has('look')).toBe(false);
	});

	it('wasd vert spora i walkState med sprint', () => {
		const r = rig();
		expect(r.engine.keyDown('w', {})).toBe(true);
		expect(r.engine.walkState()).toMatchObject({ f: 1, s: 0, active: true });
		r.engine.keyDown('d', {});
		r.engine.keyDown('Shift', {});
		expect(r.engine.walkState()).toMatchObject({ f: 1, s: 1, sprint: true });
		r.engine.keyUp('w');
		r.engine.keyUp('d');
		expect(r.engine.walkState().active).toBe(false);
	});

	it('p/g emitterer brytarhandlingar', () => {
		const r = rig();
		r.engine.keyDown('p', {});
		r.engine.keyDown('g', {});
		expect(r.has('proj-cycle')).toBe(true);
		expect(r.has('grid-cycle')).toBe(true);
	});
});

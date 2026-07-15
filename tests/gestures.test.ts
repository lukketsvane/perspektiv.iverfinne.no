import { describe, expect, it } from 'vitest';
import { createGestures, type Action, type GHit, type GPointer } from '../src/lib/ui/gestures';

// testrigg: injisert klokke, opptak av handlingar, styrbar treff-funksjon.
// draw=false er defaulten i appen (navigasjon fyrst); draw=true = teiknemodus.
function rig(
	hitKind: GHit | ((x: number, y: number) => GHit) = { kind: 'void' },
	selected: string | null = null,
	draw = false
) {
	let t = 1000;
	const actions: Action[] = [];
	const engine = createGestures({
		now: () => t,
		hit: typeof hitKind === 'function' ? hitKind : () => hitKind,
		emit: (a) => actions.push(a),
		isSelected: (id) => selected === id,
		hasSelection: () => selected !== null,
		drawMode: () => draw
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
	it('to fingrar: pan forbi 8 px låser gange (navigasjonsmodus); twist vert ignorert', () => {
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
		expect(r.engine.mode()).toBe('walk2');
		expect(r.has('walk')).toBe(true);
		r.clear();

		// kraftig twist etterpå: framleis gange, ingen rotate/fov
		r.engine.pointerMove(tp(1, 112, 140));
		r.engine.pointerMove(tp(2, 212, 60));
		expect(r.has('rotate-update')).toBe(false);
		expect(r.has('fov-pinch')).toBe(false);
		expect(r.engine.mode()).toBe('walk2');
	});

	it('i teiknemodus er to-finger pan framleis sjå (éin finger teiknar)', () => {
		const r = rig({ kind: 'void' }, null, true);
		r.engine.pointerDown(tp(1, 100, 100));
		r.engine.pointerDown(tp(2, 200, 100));
		for (let s = 3; s <= 12; s += 3) {
			r.engine.pointerMove(tp(1, 100 + s, 100));
			r.engine.pointerMove(tp(2, 200 + s, 100));
		}
		expect(r.engine.mode()).toBe('look2');
		expect(r.has('look')).toBe(true);
		expect(r.has('walk')).toBe(false);
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

	it('under augehøgd-gest: siffer + enter gjev eksakt eye-set i meter', () => {
		const r = rig(HORIZON);
		r.engine.pointerDown({ id: 1, x: 300, y: 200, type: 'mouse', button: 0 });
		expect(r.engine.mode()).toBe('eyeDrag');
		for (const k of ['1', '.', '7', '8']) expect(r.engine.keyDown(k, {})).toBe(true);
		expect(r.engine.numericBuffer()).toBe('1.78');
		expect(r.engine.keyDown('Enter', {})).toBe(true);
		const set = r.actions.find((a) => a.t === 'eye-set');
		expect(set && set.t === 'eye-set' && set.m).toBe(1.78);
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
		expect(r.engine.keyDown('0', {})).toBe(true);
		expect(r.engine.keyDown('.', {})).toBe(true);
		expect(r.engine.keyDown('3', {})).toBe(true);
		expect(r.engine.keyDown('Enter', {})).toBe(true);
		const set = r.actions.find((a) => a.t === 'eye-set');
		expect(set && set.t === 'eye-set' && set.m).toBe(0.3);

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

describe('navigasjon fyrst (v1.4): sjå er gratis, redigering kostar', () => {
	const FLOOR: GHit = { kind: 'floor' };

	it('éin finger på golvet ser seg om; ingen teikning', () => {
		const r = rig(FLOOR);
		r.engine.pointerDown(tp(1, 200, 300));
		expect(r.engine.mode()).toBe('look1');
		r.engine.pointerMove(tp(1, 230, 280));
		expect(r.has('look')).toBe(true);
		expect(r.has('draw-start')).toBe(false);
	});

	it('long-press på golvet startar teikning (med progressring)', () => {
		const r = rig(FLOOR);
		r.engine.pointerDown(tp(1, 200, 300));
		r.advance(200);
		r.engine.tick();
		expect(r.has('draw-start')).toBe(false);
		r.advance(300); // forbi 450 ms
		r.engine.tick();
		expect(r.has('draw-start')).toBe(true);
		expect(r.engine.mode()).toBe('drawFootprint');
		r.engine.pointerMove(tp(1, 320, 360));
		expect(r.has('draw-update')).toBe(true);
	});

	it('teiknemodus: éin finger på golvet teiknar direkte', () => {
		const r = rig(FLOOR, null, true);
		r.engine.pointerDown(tp(1, 200, 300));
		expect(r.engine.mode()).toBe('drawFootprint');
		expect(r.has('draw-start')).toBe(true);
	});

	it('mus: venstredrag på golvet ser; klikk på boks vel; drag på vald boks flyttar', () => {
		const r1 = rig(FLOOR);
		r1.engine.pointerDown({ id: 1, x: 100, y: 100, type: 'mouse', button: 0 });
		r1.engine.pointerMove({ id: 1, x: 140, y: 90, type: 'mouse' });
		expect(r1.has('look')).toBe(true);
		expect(r1.has('draw-start')).toBe(false);

		const r2 = rig({ kind: 'box', id: 'b1', face: 'side' });
		r2.engine.pointerDown({ id: 1, x: 100, y: 100, type: 'mouse', button: 0 });
		r2.engine.pointerUp({ id: 1, x: 102, y: 101, type: 'mouse', button: 0 });
		const sel = r2.actions.find((a) => a.t === 'select');
		expect(sel && sel.t === 'select' && sel.id).toBe('b1');

		const r3 = rig({ kind: 'box', id: 'b1', face: 'side' }, 'b1');
		r3.engine.pointerDown({ id: 1, x: 100, y: 100, type: 'mouse', button: 0 });
		expect(r3.has('move-start')).toBe(true);
	});

	it('mus i teiknemodus: venstredrag på golvet teiknar (v1.3-åtferda)', () => {
		const r = rig(FLOOR, null, true);
		r.engine.pointerDown({ id: 1, x: 100, y: 100, type: 'mouse', button: 0 });
		expect(r.has('draw-start')).toBe(true);
	});

	it('penn teiknar alltid, utan teiknemodus', () => {
		const r = rig(FLOOR);
		r.engine.pointerDown({ id: 1, x: 100, y: 100, type: 'pen', button: 0 });
		expect(r.has('draw-start')).toBe(true);
		expect(r.engine.mode()).toBe('drawFootprint');
	});

	it('finger-drag på uvald boks ser; på vald boks flyttar', () => {
		const r1 = rig({ kind: 'box', id: 'b1', face: 'side' });
		r1.engine.pointerDown(tp(1, 100, 100));
		r1.engine.pointerMove(tp(1, 120, 100));
		expect(r1.engine.mode()).toBe('look1');
		expect(r1.has('move-start')).toBe(false);

		const r2 = rig({ kind: 'box', id: 'b1', face: 'side' }, 'b1');
		r2.engine.pointerDown(tp(1, 100, 100));
		r2.engine.pointerMove(tp(1, 120, 100));
		expect(r2.has('move-start')).toBe(true);
	});

	it('b emitterer teiknemodus-byte', () => {
		const r = rig();
		r.engine.keyDown('b', {});
		expect(r.has('drawmode-toggle')).toBe(true);
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

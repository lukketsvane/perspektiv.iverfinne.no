<script lang="ts">
	import { onMount } from 'svelte';
	import { defaultDoc } from '../perspective/scene';
	import { walk as camWalk } from '../perspective/camera';
	import { renderScene } from './render';
	import { hitTest } from './hittest';
	import { createGestures, type GHit, type GPointer } from './gestures';
	import { applyAction, ctxLabel, makeUi } from './ops';
	import Hud from './Hud.svelte';

	const ui = makeUi(defaultDoc(), () => performance.now());

	let canvas: HTMLCanvasElement | undefined = $state();
	let hudText = $state('');
	let hudVisible = $state(false);

	onMount(() => {
		const cv = canvas!;
		const ctx2d = cv.getContext('2d')!;
		let w = 0;
		let h = 0;
		let dpr = 1;

		const engine = createGestures({
			now: () => performance.now(),
			hit: (x, y): GHit => {
				if (!ui.frame) return { kind: 'void' };
				const hh = hitTest(ui.doc, ui.frame, x, y);
				if (hh.kind === 'box') return { kind: 'box', id: hh.id, face: hh.face };
				if (hh.kind === 'horizon') return { kind: 'horizon' };
				if (hh.kind === 'floor') return { kind: 'floor' };
				return { kind: 'void' };
			},
			emit: (a) => applyAction(ui, a),
			isSelected: (id) => ui.selection === id,
			hasSelection: () => ui.selection !== null
		});

		const resize = () => {
			const rect = cv.getBoundingClientRect();
			dpr = Math.min(2, window.devicePixelRatio || 1);
			w = Math.max(1, rect.width);
			h = Math.max(1, rect.height);
			cv.width = Math.round(w * dpr);
			cv.height = Math.round(h * dpr);
			ui.dirty = true;
		};
		const ro = new ResizeObserver(resize);
		ro.observe(cv);
		resize();

		const norm = (e: PointerEvent): GPointer => ({
			id: e.pointerId,
			x: e.clientX,
			y: e.clientY,
			type: (e.pointerType || 'mouse') as GPointer['type'],
			button: e.button,
			shift: e.shiftKey,
			alt: e.altKey,
			meta: e.metaKey,
			ctrl: e.ctrlKey
		});

		const down = (e: PointerEvent) => {
			cv.setPointerCapture(e.pointerId);
			engine.pointerDown(norm(e));
			e.preventDefault();
		};
		const move = (e: PointerEvent) => engine.pointerMove(norm(e));
		const up = (e: PointerEvent) => engine.pointerUp(norm(e));
		const pcancel = (e: PointerEvent) => engine.pointerCancel(e.pointerId);
		const onwheel = (e: WheelEvent) => {
			e.preventDefault();
			engine.wheel(e.deltaY, { alt: e.altKey });
		};
		const dbl = (e: MouseEvent) => engine.dblclick(e.clientX, e.clientY);
		const ctxmenu = (e: Event) => e.preventDefault();
		const kd = (e: KeyboardEvent) => {
			if (
				engine.keyDown(e.key, {
					shift: e.shiftKey,
					alt: e.altKey,
					meta: e.metaKey,
					ctrl: e.ctrlKey
				})
			)
				e.preventDefault();
		};
		const ku = (e: KeyboardEvent) => engine.keyUp(e.key);

		cv.addEventListener('pointerdown', down);
		cv.addEventListener('pointermove', move);
		cv.addEventListener('pointerup', up);
		cv.addEventListener('pointercancel', pcancel);
		cv.addEventListener('wheel', onwheel, { passive: false });
		cv.addEventListener('dblclick', dbl);
		cv.addEventListener('contextmenu', ctxmenu);
		window.addEventListener('keydown', kd);
		window.addEventListener('keyup', ku);

		let raf = 0;
		let tPrev = performance.now();
		const loop = (tNow: number) => {
			raf = requestAnimationFrame(loop);
			const dt = Math.min(0.05, (tNow - tPrev) / 1000);
			tPrev = tNow;

			engine.tick();

			const ws = engine.walkState();
			if (ws.active) {
				const v = 1400 * (ws.sprint ? 4 : 1) * dt;
				camWalk(ui.doc.camera, ws.f * v, ws.s * v);
				ui.dirty = true;
			}

			const buf = engine.numericBuffer();
			const text = buf !== null ? `${ctxLabel(engine.numericCtx())} ${buf}▏` : ui.hudText;
			const vis = buf !== null || performance.now() < ui.hudUntil;
			if (text !== hudText) hudText = text;
			if (vis !== hudVisible) hudVisible = vis;

			if (!ui.dirty) return;
			ui.dirty = false;
			ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
			ui.frame = renderScene(
				ctx2d,
				ui.doc,
				{ w, h },
				{
					selection: ui.selection,
					ghost: ui.ghost,
					footprint: ui.footprint,
					pressRing: ui.pressRing
				}
			);
		};
		raf = requestAnimationFrame(loop);

		return () => {
			cancelAnimationFrame(raf);
			ro.disconnect();
			cv.removeEventListener('pointerdown', down);
			cv.removeEventListener('pointermove', move);
			cv.removeEventListener('pointerup', up);
			cv.removeEventListener('pointercancel', pcancel);
			cv.removeEventListener('wheel', onwheel);
			cv.removeEventListener('dblclick', dbl);
			cv.removeEventListener('contextmenu', ctxmenu);
			window.removeEventListener('keydown', kd);
			window.removeEventListener('keyup', ku);
		};
	});
</script>

<canvas bind:this={canvas}></canvas>
<Hud text={hudText} visible={hudVisible} />

<style>
	canvas {
		position: fixed;
		inset: 0;
		width: 100vw;
		height: 100dvh;
		display: block;
		touch-action: none;
		user-select: none;
		-webkit-user-select: none;
		background: #f7f4ee;
	}
</style>

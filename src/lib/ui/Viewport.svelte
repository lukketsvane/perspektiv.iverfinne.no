<script lang="ts">
	import { onMount } from 'svelte';
	import { defaultDoc } from '../perspective/scene';
	import { walk as camWalk } from '../perspective/camera';
	import { loadLocal, makeAutosaver } from '../perspective/io';
	import { paletteFor, renderScene } from './render';
	import { hitTest } from './hittest';
	import { createGestures, type Action, type GHit, type GPointer } from './gestures';
	import { applyAction, ctxLabel, importJson, makeUi } from './ops';
	import Hud from './Hud.svelte';
	import Sheet from './Sheet.svelte';
	import Toolbar from './Toolbar.svelte';

	const ui = makeUi(defaultDoc(), () => performance.now());

	let canvas: HTMLCanvasElement | undefined = $state();
	let hudText = $state('');
	let hudVisible = $state(false);
	let sheetOpen = $state(false);
	let sheetX = $state(0);
	let sheetY = $state(0);
	let locked = $state(false);
	let theme = $state<'light' | 'dark'>('light');

	// tema-fargane som css-variablar for Hud/Sheet/Toolbar og body
	const applyTheme = () => {
		const pal = paletteFor(ui.doc.settings.theme);
		const root = document.documentElement;
		root.style.setProperty('--fp-paper', pal.paper);
		root.style.setProperty('--fp-ink', pal.ink);
		root.style.setProperty('--fp-blue', pal.blue);
		root.style.setProperty('--fp-red', pal.red);
	};

	const act = (a: Action) => {
		applyAction(ui, a);
		if (ui.sheet.open !== sheetOpen) {
			sheetOpen = ui.sheet.open;
			sheetX = ui.sheet.x;
			sheetY = ui.sheet.y;
		}
		if (ui.doc.settings.locked !== locked) locked = ui.doc.settings.locked;
		if (ui.doc.settings.theme !== theme) {
			theme = ui.doc.settings.theme;
			applyTheme();
		}
	};

	const closeSheet = () => {
		ui.sheet.open = false;
		sheetOpen = false;
	};

	const doImport = (json: string) => {
		if (importJson(ui, json)) {
			hudText = 'json importert';
			ui.hudUntil = performance.now() + 1200;
		} else {
			hudText = 'ugyldig json';
			ui.hudUntil = performance.now() + 1200;
		}
	};

	onMount(() => {
		const cv = canvas!;
		const ctx2d = cv.getContext('2d')!;
		let w = 0;
		let h = 0;
		let dpr = 1;

		// autolagra scene frå førre økt
		const saved = loadLocal();
		if (saved) {
			ui.doc.boxes = saved.boxes;
			Object.assign(ui.doc.camera, saved.camera);
			Object.assign(ui.doc.settings, saved.settings);
		}
		locked = ui.doc.settings.locked;
		theme = ui.doc.settings.theme;
		applyTheme();
		const autosaver = makeAutosaver(() => ui.doc);

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
			emit: act,
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
			try {
				cv.setPointerCapture(e.pointerId);
			} catch {
				// peikaren kan alt vere borte (raske tapp); gesten skal likevel handsamast
			}
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
			if (sheetOpen && e.key === 'Escape') {
				closeSheet();
				e.preventDefault();
				return;
			}
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
		// json-import via drag & drop på papiret
		const dragover = (e: DragEvent) => e.preventDefault();
		const drop = async (e: DragEvent) => {
			e.preventDefault();
			const f = e.dataTransfer?.files?.[0];
			if (f && (f.type === 'application/json' || f.name.endsWith('.json')))
				doImport(await f.text());
		};

		cv.addEventListener('pointerdown', down);
		cv.addEventListener('pointermove', move);
		cv.addEventListener('pointerup', up);
		cv.addEventListener('pointercancel', pcancel);
		cv.addEventListener('wheel', onwheel, { passive: false });
		cv.addEventListener('dblclick', dbl);
		cv.addEventListener('contextmenu', ctxmenu);
		window.addEventListener('keydown', kd);
		window.addEventListener('keyup', ku);
		window.addEventListener('dragover', dragover);
		window.addEventListener('drop', drop);

		let raf = 0;
		let tPrev = performance.now();
		const loop = (tNow: number) => {
			raf = requestAnimationFrame(loop);
			const dt = Math.min(0.05, (tNow - tPrev) / 1000);
			tPrev = tNow;

			engine.tick();

			const ws = engine.walkState();
			if (ws.active && !ui.doc.settings.locked) {
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
			autosaver.touch();
		};
		raf = requestAnimationFrame(loop);

		// dev-introspeksjon for skripta verifisering (inga ui-flate)
		if (import.meta.env.DEV) {
			(window as unknown as Record<string, unknown>).__fp = { ui, engine, act };
		}

		return () => {
			cancelAnimationFrame(raf);
			ro.disconnect();
			autosaver.flush();
			autosaver.dispose();
			cv.removeEventListener('pointerdown', down);
			cv.removeEventListener('pointermove', move);
			cv.removeEventListener('pointerup', up);
			cv.removeEventListener('pointercancel', pcancel);
			cv.removeEventListener('wheel', onwheel);
			cv.removeEventListener('dblclick', dbl);
			cv.removeEventListener('contextmenu', ctxmenu);
			window.removeEventListener('keydown', kd);
			window.removeEventListener('keyup', ku);
			window.removeEventListener('dragover', dragover);
			window.removeEventListener('drop', drop);
		};
	});
</script>

<canvas bind:this={canvas}></canvas>
<Hud text={hudText} visible={hudVisible} />
<Toolbar {locked} {theme} {act} />
<Sheet
	open={sheetOpen}
	x={sheetX}
	y={sheetY}
	doc={ui.doc}
	{act}
	onimport={doImport}
	onclose={closeSheet}
/>

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
		background: var(--fp-paper, #f7f4ee);
	}
</style>

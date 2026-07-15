<script lang="ts">
	import { onMount } from 'svelte';
	import { defaultDoc, type Doc } from '../perspective/scene';
	import { renderScene } from './render';

	const doc: Doc = defaultDoc();
	let canvas: HTMLCanvasElement | undefined = $state();
	let dirty = true;

	onMount(() => {
		const cv = canvas!;
		const ctx = cv.getContext('2d')!;
		let w = 0;
		let h = 0;
		let dpr = 1;

		const resize = () => {
			const rect = cv.getBoundingClientRect();
			dpr = Math.min(2, window.devicePixelRatio || 1);
			w = Math.max(1, rect.width);
			h = Math.max(1, rect.height);
			cv.width = Math.round(w * dpr);
			cv.height = Math.round(h * dpr);
			dirty = true;
		};
		const ro = new ResizeObserver(resize);
		ro.observe(cv);
		resize();

		let raf = 0;
		const loop = () => {
			raf = requestAnimationFrame(loop);
			if (!dirty) return;
			dirty = false;
			ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
			renderScene(ctx, doc, { w, h });
		};
		loop();

		return () => {
			cancelAnimationFrame(raf);
			ro.disconnect();
		};
	});
</script>

<canvas bind:this={canvas}></canvas>

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

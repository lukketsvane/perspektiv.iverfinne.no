<script lang="ts">
	import type { Action } from './gestures';
	import type { Doc } from '../perspective/scene';
	import { PRESET_NAMES } from '../perspective/presets';

	let {
		open = false,
		x = 0,
		y = 0,
		doc,
		act,
		onimport,
		onclose
	}: {
		open?: boolean;
		x?: number;
		y?: number;
		doc: Doc;
		act: (a: Action) => void;
		onimport: (json: string) => void;
		onclose: () => void;
	} = $props();

	// lokalt spegelbilete av innstillingane; friska opp ved opning og etter kvar handling
	let snap = $state({
		proj: 'stereo',
		gridX: true,
		gridY: true,
		gridZ: true,
		floor: true,
		horizon: true,
		vps: true,
		jitter: false,
		moduleTicks: false,
		maskFaces: false,
		fit: 'inscribe'
	});

	function refresh() {
		snap = {
			proj: doc.camera.proj,
			gridX: doc.settings.gridX,
			gridY: doc.settings.gridY,
			gridZ: doc.settings.gridZ,
			floor: doc.settings.floor,
			horizon: doc.settings.horizon,
			vps: doc.settings.vps,
			jitter: doc.settings.jitter,
			moduleTicks: doc.settings.moduleTicks,
			maskFaces: doc.settings.maskFaces,
			fit: doc.settings.fit
		};
	}

	$effect(() => {
		if (open) refresh();
	});

	function toggle(key: string, value: boolean) {
		act({ t: 'settings-patch', patch: { [key]: value } });
		refresh();
	}

	function setProj(p: string) {
		act({ t: 'proj-set', proj: p });
		refresh();
	}

	let fileInput: HTMLInputElement | undefined = $state();

	async function onFile(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const f = input.files?.[0];
		if (f) onimport(await f.text());
		input.value = '';
		onclose();
	}

	const GRID_KEYS: Array<[string, string]> = [
		['gridX', 'x-sirklar'],
		['gridY', 'vertikalar'],
		['gridZ', 'z-sirklar'],
		['floor', 'golv'],
		['horizon', 'horisont'],
		['vps', 'vp-prikkar']
	];

	let style = $derived(
		`left:${Math.min(Math.max(12, x - 110), Math.max(12, (typeof window !== 'undefined' ? window.innerWidth : 800) - 232))}px;` +
			`top:${Math.min(Math.max(12, y - 40), Math.max(12, (typeof window !== 'undefined' ? window.innerHeight : 600) - 360))}px`
	);
</script>

{#if open}
	<div
		class="backdrop"
		onpointerdown={onclose}
		role="presentation"
	></div>
	<div class="sheet" {style} role="menu" tabindex="-1">
		<div class="row seg">
			{#each ['stereo', 'equi', 'linear'] as p (p)}
				<button class:on={snap.proj === p} onpointerdown={() => setProj(p)}>{p}</button>
			{/each}
		</div>
		<div class="sep"></div>
		<div class="grid2">
			{#each GRID_KEYS as [key, label] (key)}
				<button
					class="row toggle"
					class:on={snap[key as keyof typeof snap] === true}
					onpointerdown={() => toggle(key, !(snap[key as keyof typeof snap] === true))}
				>
					<span class="dot"></span>{label}
				</button>
			{/each}
			<button class="row toggle" class:on={snap.jitter} onpointerdown={() => toggle('jitter', !snap.jitter)}>
				<span class="dot"></span>jitter
			</button>
			<button class="row toggle" class:on={snap.moduleTicks} onpointerdown={() => toggle('moduleTicks', !snap.moduleTicks)}>
				<span class="dot"></span>modul h/8
			</button>
			<button class="row toggle" class:on={snap.maskFaces} onpointerdown={() => toggle('maskFaces', !snap.maskFaces)}>
				<span class="dot"></span>maska flater
			</button>
			<button
				class="row toggle"
				class:on={snap.fit === 'cover'}
				onpointerdown={() => act({ t: 'settings-patch', patch: { fit: snap.fit === 'cover' ? 'inscribe' : 'cover' } })}
			>
				<span class="dot"></span>cover
			</button>
		</div>
		<div class="sep"></div>
		<button class="row" onpointerdown={() => act({ t: 'preset-load', name: null })}>tilfeldig preset</button>
		<div class="grid2">
			{#each PRESET_NAMES as p (p)}
				<button class="row preset" onpointerdown={() => act({ t: 'preset-load', name: p })}>{p}</button>
			{/each}
		</div>
		<div class="sep"></div>
		<button class="row" onpointerdown={() => { act({ t: 'export-svg' }); onclose(); }}>eksporter svg</button>
		<button class="row" onpointerdown={() => { act({ t: 'export-json' }); onclose(); }}>eksporter json</button>
		<button class="row" onpointerdown={() => fileInput?.click()}>importer json…</button>
		<input bind:this={fileInput} type="file" accept=".json,application/json" onchange={onFile} hidden />
	</div>
{/if}

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		background: transparent;
	}
	.sheet {
		position: fixed;
		width: 216px;
		max-height: min(72vh, 560px);
		overflow-y: auto;
		background: var(--fp-paper, #f7f4ee);
		border: 1px solid color-mix(in srgb, var(--fp-ink, #1a1a1c) 55%, transparent);
		border-radius: 3px;
		box-shadow: 2px 3px 0 color-mix(in srgb, var(--fp-ink, #1a1a1c) 12%, transparent);
		padding: 6px;
		font:
			500 11px ui-monospace,
			SFMono-Regular,
			Menlo,
			monospace;
		color: var(--fp-ink, #1a1a1c);
		user-select: none;
		animation: inn 0.14s ease;
	}
	.grid2 {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0 4px;
	}
	@keyframes inn {
		from {
			opacity: 0;
			transform: translateY(4px);
		}
		to {
			opacity: 1;
			transform: none;
		}
	}
	.row {
		display: flex;
		align-items: center;
		gap: 6px;
		width: 100%;
		padding: 5px 6px;
		background: none;
		border: none;
		font: inherit;
		color: inherit;
		text-align: left;
		cursor: pointer;
		border-radius: 2px;
	}
	.row:active {
		background: color-mix(in srgb, var(--fp-blue, #1155cc) 10%, transparent);
	}
	.seg {
		display: flex;
		gap: 4px;
		padding: 2px;
	}
	.seg button {
		flex: 1;
		font: inherit;
		background: none;
		border: 1px solid color-mix(in srgb, var(--fp-ink, #1a1a1c) 35%, transparent);
		border-radius: 2px;
		padding: 4px 0;
		color: inherit;
		cursor: pointer;
	}
	.seg button.on {
		border-color: var(--fp-blue, #1155cc);
		color: var(--fp-blue, #1155cc);
	}
	.preset {
		padding-top: 3px;
		padding-bottom: 3px;
		opacity: 0.85;
	}
	.toggle .dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		border: 1px solid color-mix(in srgb, var(--fp-ink, #1a1a1c) 50%, transparent);
		flex: none;
	}
	.toggle.on .dot {
		background: var(--fp-red, #c8232e);
		border-color: var(--fp-red, #c8232e);
	}
	.sep {
		height: 1px;
		background: color-mix(in srgb, var(--fp-ink, #1a1a1c) 18%, transparent);
		margin: 4px 2px;
	}
</style>

<script lang="ts">
	import type { Action } from './gestures';

	let {
		locked = false,
		theme = 'light',
		drawMode = false,
		act
	}: {
		locked?: boolean;
		theme?: 'light' | 'dark';
		drawMode?: boolean;
		act: (a: Action) => void;
	} = $props();

	let el: HTMLDivElement | undefined = $state();

	function openSheet() {
		const r = el?.getBoundingClientRect();
		act({ t: 'sheet-open', x: (r?.left ?? 40) - 110, y: (r?.bottom ?? 40) + 10 });
	}
</script>

<div class="bar" bind:this={el}>
	<button
		class="knapp"
		class:aktiv={drawMode}
		class:daud={locked}
		title={drawMode ? 'navigasjon (b): drag ser' : 'teiknemodus (b): drag teiknar'}
		aria-label="teiknemodus"
		aria-pressed={drawMode}
		disabled={locked}
		onpointerdown={(e) => {
			e.stopPropagation();
			if (!locked) act({ t: 'drawmode-toggle' });
		}}
	>
		<svg viewBox="0 0 16 16" aria-hidden="true">
			<path d="M3 13l1-3.2 7.2-7.2a1.1 1.1 0 0 1 1.6 0l.6.6a1.1 1.1 0 0 1 0 1.6L6.2 12z" />
			<path d="M10 4.5l1.5 1.5" />
		</svg>
	</button>
	<button
		class="knapp"
		class:aktiv={locked}
		title={locked ? 'lås opp (l)' : 'lås som referanse (l)'}
		aria-label="referanselås"
		aria-pressed={locked}
		onpointerdown={(e) => {
			e.stopPropagation();
			act({ t: 'lock-toggle' });
		}}
	>
		<svg viewBox="0 0 16 16" aria-hidden="true">
			{#if locked}
				<rect x="3.5" y="7" width="9" height="6" rx="1" />
				<path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
			{:else}
				<rect x="3.5" y="7" width="9" height="6" rx="1" />
				<path d="M5.5 7V5a2.5 2.5 0 0 1 5 0" />
			{/if}
		</svg>
	</button>
	<button
		class="knapp"
		title={theme === 'dark' ? 'lys modus (i)' : 'mørk modus (i)'}
		aria-label="inverter fargar"
		onpointerdown={(e) => {
			e.stopPropagation();
			act({ t: 'theme-toggle' });
		}}
	>
		<svg viewBox="0 0 16 16" aria-hidden="true">
			<circle cx="8" cy="8" r="5.2" />
			<path d="M8 2.8v10.4A5.2 5.2 0 0 0 8 2.8Z" fill="currentColor" stroke="none" />
		</svg>
	</button>
	<button
		class="knapp"
		class:daud={locked}
		title="innstillingar"
		aria-label="innstillingsark"
		disabled={locked}
		onpointerdown={(e) => {
			e.stopPropagation();
			if (!locked) openSheet();
		}}
	>
		<svg viewBox="0 0 16 16" aria-hidden="true">
			<circle cx="3.5" cy="8" r="1.15" fill="currentColor" stroke="none" />
			<circle cx="8" cy="8" r="1.15" fill="currentColor" stroke="none" />
			<circle cx="12.5" cy="8" r="1.15" fill="currentColor" stroke="none" />
		</svg>
	</button>
</div>

<style>
	.bar {
		position: fixed;
		top: max(10px, env(safe-area-inset-top));
		right: max(10px, env(safe-area-inset-right));
		display: flex;
		flex-direction: column;
		gap: 4px;
		z-index: 10;
	}
	.knapp {
		width: 26px;
		height: 26px;
		display: grid;
		place-items: center;
		padding: 0;
		border-radius: 3px;
		border: 1px solid color-mix(in srgb, var(--fp-ink, #1a1a1c) 40%, transparent);
		background: color-mix(in srgb, var(--fp-paper, #f7f4ee) 72%, transparent);
		color: var(--fp-ink, #1a1a1c);
		opacity: 0.35;
		cursor: pointer;
		transition:
			opacity 0.15s ease,
			border-color 0.15s ease;
		touch-action: none;
	}
	.knapp:hover,
	.knapp:active {
		opacity: 1;
	}
	.knapp.aktiv {
		opacity: 1;
		color: var(--fp-blue, #1155cc);
		border-color: var(--fp-blue, #1155cc);
	}
	.knapp.daud {
		opacity: 0.15;
		cursor: default;
	}
	/* touch har ikkje hover: hald knappane lesbare, men diskrete */
	@media (pointer: coarse) {
		.knapp {
			opacity: 0.55;
		}
	}
	.knapp svg {
		width: 13px;
		height: 13px;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.4;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
</style>

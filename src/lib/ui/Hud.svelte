<script lang="ts">
	let { text = '', visible = false }: { text?: string; visible?: boolean } = $props();
</script>

<div class="hud" class:visible aria-hidden="true">{text}</div>

<style>
	.hud {
		position: fixed;
		left: 50%;
		bottom: max(20px, env(safe-area-inset-bottom));
		transform: translateX(-50%);
		font:
			500 13px ui-monospace,
			SFMono-Regular,
			Menlo,
			monospace;
		letter-spacing: 0.03em;
		color: #1a1a1c;
		opacity: 0;
		transition: opacity 0.18s ease;
		pointer-events: none;
		user-select: none;
		white-space: nowrap;
	}
	.hud.visible {
		opacity: 0.85;
	}
</style>

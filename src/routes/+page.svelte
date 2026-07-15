<script lang="ts">
	import Viewport from '$lib/ui/Viewport.svelte';
</script>

<svelte:head>
	<title>femtepunkt</title>
</svelte:head>

<Viewport />

<style>
	:global(html, body) {
		margin: 0;
		padding: 0;
		height: 100%;
		overflow: hidden;
		overscroll-behavior: none;
		background: var(--fp-paper, #f7f4ee);
	}
</style>

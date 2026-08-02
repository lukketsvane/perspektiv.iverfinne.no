<script lang="ts">
	import { onMount } from 'svelte';

	let { open = false, onclose }: { open?: boolean; onclose: () => void } = $props();
	let host: HTMLDivElement | undefined = $state();
	let input: HTMLInputElement | undefined = $state();
	let ready = $state(false);
	let loading = $state(false);
	let error = $state('');
	let selectedName = $state('ingen modell');
	let mode = $state<'translate' | 'rotate' | 'scale'>('translate');
	let scale = $state(1);

	type Runtime = {
		add(files: FileList): Promise<void>;
		setMode(value: typeof mode): void;
		setScale(value: number): void;
		remove(): void;
		frame(): void;
		dispose(): void;
	};
	let runtime: Runtime | undefined;

	async function createRuntime(container: HTMLDivElement): Promise<Runtime> {
		// Three blir lasta som ESM. Dette held sjølve prosjektet lite, medan GLB-loader,
		// PBR-material og transformhandtak kjem frå nøyaktig same Three-versjon.
		const THREE_URL = 'https://esm.sh/three@0.179.1';
		const [{ default: THREE }, { GLTFLoader }, { OrbitControls }, { TransformControls }] =
			(await Promise.all([
				import(/* @vite-ignore */ THREE_URL).then((m) => ({ default: m })),
				import(/* @vite-ignore */ `${THREE_URL}/examples/jsm/loaders/GLTFLoader.js`),
				import(/* @vite-ignore */ `${THREE_URL}/examples/jsm/controls/OrbitControls.js`),
				import(/* @vite-ignore */ `${THREE_URL}/examples/jsm/controls/TransformControls.js`)
			])) as any;

		const scene = new THREE.Scene();
		scene.background = new THREE.Color(0xcfd8df);
		scene.fog = new THREE.Fog(0xcfd8df, 35, 110);
		const camera = new THREE.PerspectiveCamera(48, 1, 0.01, 500);
		camera.position.set(7, 5, 9);
		const renderer = new THREE.WebGLRenderer({ antialias: true });
		renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
		renderer.shadowMap.enabled = true;
		renderer.shadowMap.type = THREE.PCFSoftShadowMap;
		renderer.outputColorSpace = THREE.SRGBColorSpace;
		renderer.toneMapping = THREE.ACESFilmicToneMapping;
		renderer.toneMappingExposure = 1.05;
		container.appendChild(renderer.domElement);

		const hemi = new THREE.HemisphereLight(0xddeeff, 0x665a49, 1.25);
		scene.add(hemi);
		const sun = new THREE.DirectionalLight(0xfff2d6, 4.2);
		sun.position.set(-12, 18, 8);
		sun.castShadow = true;
		sun.shadow.mapSize.set(2048, 2048);
		sun.shadow.camera.left = sun.shadow.camera.bottom = -18;
		sun.shadow.camera.right = sun.shadow.camera.top = 18;
		sun.shadow.camera.near = 0.5;
		sun.shadow.camera.far = 60;
		sun.shadow.bias = -0.00015;
		scene.add(sun);

		const ground = new THREE.Mesh(
			new THREE.PlaneGeometry(200, 200),
			new THREE.MeshStandardMaterial({ color: 0xa9ada8, roughness: 0.88, metalness: 0 })
		);
		ground.rotation.x = -Math.PI / 2;
		ground.receiveShadow = true;
		scene.add(ground);
		const grid = new THREE.GridHelper(40, 40, 0x677079, 0x899198);
		grid.position.y = 0.002;
		scene.add(grid);

		const orbit = new OrbitControls(camera, renderer.domElement);
		orbit.enableDamping = true;
		orbit.target.set(0, 1, 0);
		orbit.maxPolarAngle = Math.PI / 2 - 0.02;
		const transform = new TransformControls(camera, renderer.domElement);
		transform.setSize(0.8);
		transform.setTranslationSnap(0.1);
		transform.setRotationSnap(THREE.MathUtils.degToRad(5));
		transform.addEventListener('dragging-changed', (e: any) => (orbit.enabled = !e.value));
		scene.add(transform.getHelper());
		const loader = new GLTFLoader();
		const models: any[] = [];
		let selected: any;

		function choose(object: any, name: string) {
			selected = object;
			transform.attach(object);
			selectedName = name;
			scale = object.scale.x;
		}
		function resize() {
			const { width, height } = container.getBoundingClientRect();
			camera.aspect = width / Math.max(1, height);
			camera.updateProjectionMatrix();
			renderer.setSize(width, height, false);
		}
		const ro = new ResizeObserver(resize);
		ro.observe(container);
		resize();
		let raf = 0;
		const animate = () => {
			raf = requestAnimationFrame(animate);
			orbit.update();
			renderer.render(scene, camera);
		};
		animate();

		return {
			async add(files) {
				for (const file of Array.from(files)) {
					if (!file.name.toLowerCase().endsWith('.glb')) continue;
					const url = URL.createObjectURL(file);
					try {
						const gltf = await loader.loadAsync(url);
						const model = gltf.scene;
						model.name = file.name;
						model.traverse((o: any) => {
							if (!o.isMesh) return;
							o.castShadow = true;
							o.receiveShadow = true;
							if (o.material) o.material.envMapIntensity = 0.7;
						});
						const box = new THREE.Box3().setFromObject(model);
						const size = box.getSize(new THREE.Vector3());
						const autoScale = 2.2 / Math.max(size.x, size.y, size.z, 0.001);
						model.scale.setScalar(autoScale);
						box.setFromObject(model);
						model.position.y -= box.min.y;
						model.position.x = (models.length % 4) * 2.5 - 2.5;
						scene.add(model);
						models.push(model);
						choose(model, file.name);
					} finally {
						URL.revokeObjectURL(url);
					}
				}
			},
			setMode(value) { transform.setMode(value); },
			setScale(value) { if (selected) selected.scale.setScalar(value); },
			remove() {
				if (!selected) return;
				transform.detach();
				scene.remove(selected);
				models.splice(models.indexOf(selected), 1);
				selected.traverse((o: any) => {
					o.geometry?.dispose();
					const mats = Array.isArray(o.material) ? o.material : [o.material];
					mats.filter(Boolean).forEach((m: any) => m.dispose());
				});
				selected = undefined;
				selectedName = 'ingen modell';
			},
			frame() {
				if (!selected) return;
				const box = new THREE.Box3().setFromObject(selected);
				const sphere = box.getBoundingSphere(new THREE.Sphere());
				orbit.target.copy(sphere.center);
				camera.position.copy(sphere.center).add(new THREE.Vector3(1, 0.7, 1).normalize().multiplyScalar(Math.max(2, sphere.radius * 3.2)));
				orbit.update();
			},
			dispose() {
				cancelAnimationFrame(raf); ro.disconnect(); orbit.dispose(); transform.dispose(); renderer.dispose(); renderer.domElement.remove();
			}
		};
	}

	$effect(() => {
		if (!open || !host || runtime) return;
		loading = true;
		createRuntime(host).then((r) => { runtime = r; ready = true; error = ''; }).catch(() => {
			error = 'kunne ikkje laste 3D-motoren – sjekk nettilkoplinga';
		}).finally(() => loading = false);
	});

	onMount(() => () => runtime?.dispose());

	async function filesPicked(files?: FileList | null) {
		if (!files?.length || !runtime) return;
		loading = true; error = '';
		try { await runtime.add(files); } catch { error = 'GLB-fila kunne ikkje lesast'; }
		finally { loading = false; }
	}
</script>

	<section class="studio" class:shown={open} aria-label="GLB-studio" aria-hidden={!open}>
		<div class="view" role="application" aria-label="3D-scene" bind:this={host} ondragover={(e) => e.preventDefault()} ondrop={(e) => { e.preventDefault(); filesPicked(e.dataTransfer?.files); }}></div>
		<header><strong>GLB studio</strong><span>realistisk sollys</span><button onclick={onclose} aria-label="lukk">×</button></header>
		<aside>
			<button class="load" onclick={() => input?.click()} disabled={!ready || loading}>{loading ? 'lastar…' : '+ last inn .glb'}</button>
			<input bind:this={input} type="file" accept=".glb,model/gltf-binary" multiple hidden onchange={(e) => { filesPicked(e.currentTarget.files); e.currentTarget.value = ''; }} />
			<p class="hint">eller slepp GLB-filer rett i scena</p>
			<div class="name" title={selectedName}>{selectedName}</div>
			<div class="modes">
				{#each [['translate','flytt'],['rotate','roter'],['scale','skaler']] as [value,label]}
					<button class:on={mode === value} onclick={() => { mode = value as typeof mode; runtime?.setMode(mode); }}>{label}</button>
				{/each}
			</div>
			<label>uniform skala <output>{scale.toFixed(2)}×</output><input type="range" min="0.02" max="5" step="0.01" bind:value={scale} oninput={() => runtime?.setScale(scale)} /></label>
			<div class="actions"><button onclick={() => runtime?.frame()}>fokuser</button><button class="danger" onclick={() => runtime?.remove()}>slett</button></div>
			<p class="help">Venstre mus: roter kamera<br />Høgre mus: panorer · hjul: zoom<br />Bruk aksane i scena for presis plassering.</p>
			{#if error}<p class="error">{error}</p>{/if}
		</aside>
	</section>

<style>
	.studio { display: none; position: fixed; inset: 0; z-index: 40; color: #eef2f4; font: 500 12px ui-monospace, monospace; background: #263039; }
	.studio.shown { display: block; }
	.view { position: absolute; inset: 0; }
	.view :global(canvas) { width: 100%; height: 100%; display: block; }
	header { position: absolute; top: 16px; left: 18px; right: 18px; display: flex; align-items: baseline; gap: 12px; pointer-events: none; text-shadow: 0 1px 4px #000; }
	header strong { font-size: 15px; letter-spacing: .04em; } header span { opacity: .6; } header button { margin-left: auto; pointer-events: auto; font-size: 25px; }
	button { border: 1px solid #78848c; background: #28343dcc; color: inherit; border-radius: 4px; padding: 7px 9px; cursor: pointer; font: inherit; }
	aside { position: absolute; left: 16px; bottom: 16px; width: 230px; padding: 12px; background: #1c252cdd; border: 1px solid #68747c; border-radius: 7px; backdrop-filter: blur(8px); box-shadow: 0 8px 30px #0005; }
	.load { width: 100%; padding: 10px; border-color: #e5b762; color: #ffe4aa; } .hint { opacity: .55; text-align: center; margin: 6px 0 12px; font-size: 10px; }
	.name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-bottom: 9px; color: #fff; }
	.modes { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; } .modes button.on { background: #d59b3c; border-color: #f4c56d; color: #111; }
	label { display: block; margin: 13px 0; } output { float: right; color: #efc777; } input[type='range'] { width: 100%; margin-top: 8px; accent-color: #e0a540; }
	.actions { display: flex; gap: 5px; } .actions button { flex: 1; } .danger { color: #ffaaa2; }
	.help { margin: 12px 0 0; opacity: .6; line-height: 1.5; font-size: 10px; } .error { color: #ff9e94; line-height: 1.4; }
	@media (max-width: 520px) { aside { left: 8px; bottom: 8px; width: calc(100% - 40px); } header { top: 10px; left: 12px; } }
</style>

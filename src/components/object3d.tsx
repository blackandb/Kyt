'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

export default function Object3D() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = ref.current;
    if (!host) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' });
    } catch {
      // The decorative scene must never prevent sign-in on devices without WebGL.
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = envTex;
    scene.environmentIntensity = 0.55;

    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
    camera.position.set(0, 0, 6.2);

    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(1.5, 3, 4);
    scene.add(key);
    const rimA = new THREE.PointLight(0xe8e8ff, 18, 12);
    rimA.position.set(-2.5, 1.5, -2);
    const rimB = new THREE.PointLight(0xffffff, 12, 12);
    rimB.position.set(2.5, -1.8, -2);
    scene.add(rimA, rimB);

    const group = new THREE.Group();
    scene.add(group);

    const core = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.72, 1),
      new THREE.MeshPhysicalMaterial({
        color: 0x111114,
        metalness: 0.9,
        roughness: 0.28,
        clearcoat: 1,
        clearcoatRoughness: 0.12,
        flatShading: true
      })
    );
    group.add(core);

    const chrome = new THREE.MeshPhysicalMaterial({ color: 0xdedee4, metalness: 1, roughness: 0.14, clearcoat: 1 });
    const hexA = new THREE.Mesh(new THREE.TorusGeometry(1.22, 0.05, 6, 6), chrome);
    const hexB = new THREE.Mesh(new THREE.TorusGeometry(1.46, 0.028, 6, 6), chrome.clone());
    hexA.rotation.x = Math.PI / 2.4;
    hexB.rotation.set(Math.PI / 1.8, 0.4, Math.PI / 6);
    group.add(hexA, hexB);

    const scanMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 });
    const scan = new THREE.Mesh(new THREE.TorusGeometry(0.98, 0.008, 8, 96), scanMat);
    scan.rotation.x = Math.PI / 2;
    group.add(scan);

    const dots = new THREE.Group();
    const dotGeo = new THREE.SphereGeometry(0.035, 12, 12);
    const dotMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    for (let i = 0; i < 6; i++) {
      const d = new THREE.Mesh(dotGeo, dotMat);
      const a = (i / 6) * Math.PI * 2;
      d.position.set(Math.cos(a) * 1.22, 0, Math.sin(a) * 1.22);
      dots.add(d);
    }
    dots.rotation.x = hexA.rotation.x - Math.PI / 2;
    group.add(dots);

    const resize = () => {
      const { clientWidth: w, clientHeight: h } = host;
      renderer.setSize(w, h, false);
      camera.aspect = w / Math.max(1, h);
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(host);

    const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
    const onMove = (e: PointerEvent) => {
      pointer.tx = (e.clientX / window.innerWidth - 0.5) * 0.5;
      pointer.ty = (e.clientY / window.innerHeight - 0.5) * 0.4;
    };
    window.addEventListener('pointermove', onMove, { passive: true });

    let visible = true;
    const io = new IntersectionObserver(([entry]) => (visible = entry.isIntersecting));
    io.observe(host);

    const clock = new THREE.Clock();
    let raf = 0;
    const render = () => {
      const t = clock.getElapsedTime();
      pointer.x += (pointer.tx - pointer.x) * 0.04;
      pointer.y += (pointer.ty - pointer.y) * 0.04;
      group.rotation.y = t * 0.18 + pointer.x;
      group.rotation.x = Math.sin(t * 0.3) * 0.08 + pointer.y;
      group.position.y = Math.sin(t * 0.6) * 0.05;
      core.rotation.y = -t * 0.12;
      hexB.rotation.z = Math.PI / 6 + t * 0.08;
      const s = (t * 0.35) % 1;
      scan.position.y = (s - 0.5) * 1.4;
      scan.scale.setScalar(Math.sqrt(Math.max(0.05, 1 - Math.pow((s - 0.5) * 1.42, 2))));
      scanMat.opacity = 0.55 * Math.sin(s * Math.PI);
      renderer.render(scene, camera);
    };

    const loop = () => {
      raf = requestAnimationFrame(loop);
      if (visible) render();
    };
    if (reduced) render();
    else loop();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      window.removeEventListener('pointermove', onMove);
      scene.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          const m = o.material as THREE.Material | THREE.Material[];
          (Array.isArray(m) ? m : [m]).forEach((x) => x.dispose());
        }
      });
      envTex.dispose();
      pmrem.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }, []);

  return <div ref={ref} style={{ position: 'absolute', inset: 0 }} />;
}

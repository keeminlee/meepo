'use client';

import React, { useEffect, useRef, useMemo } from 'react';
import * as THREE from 'three';

interface CelestialHeroBackgroundProps {
  className?: string;
}

export const CelestialHeroBackground: React.FC<CelestialHeroBackgroundProps> = ({ className }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollYRef = useRef(0);
  const lastScrollYRef = useRef(0);
  const scrollVelocityRef = useRef(0);

  useEffect(() => {
    if (!containerRef.current) return;

    // --- Setup ---
    const width = window.innerWidth;
    const height = window.innerHeight;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 1000);
    camera.position.z = 5;

    const renderer = new THREE.WebGLRenderer({ 
      antialias: true, 
      alpha: true,
      powerPreference: 'high-performance'
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    containerRef.current.appendChild(renderer.domElement);

    // --- Starfield (Background) ---
    const starCount = 1200;
    const starGeometry = new THREE.BufferGeometry();
    const starPositions = new Float32Array(starCount * 3);
    const starSizes = new Float32Array(starCount);
    const starOpacities = new Float32Array(starCount);

    for (let i = 0; i < starCount; i++) {
      const i3 = i * 3;
      // Spread stars more towards edges, keep center relatively quiet
      const radius = 10 + Math.random() * 40;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);

      starPositions[i3] = radius * Math.sin(phi) * Math.cos(theta);
      starPositions[i3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
      starPositions[i3 + 2] = -radius * Math.cos(phi);

      starSizes[i] = Math.random() * 1.5 + 0.5;
      starOpacities[i] = Math.random() * 0.5 + 0.2;
    }

    starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
    starGeometry.setAttribute('size', new THREE.BufferAttribute(starSizes, 1));
    starGeometry.setAttribute('opacity', new THREE.BufferAttribute(starOpacities, 1));

    const starMaterial = new THREE.ShaderMaterial({
      transparent: true,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: new THREE.Color('#f4c96b') } // Warm gold tint
      },
      vertexShader: `
        attribute float size;
        attribute float opacity;
        varying float vOpacity;
        uniform float uTime;
        void main() {
          vOpacity = opacity * (0.7 + 0.3 * sin(uTime * 0.5 + position.x));
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * (300.0 / -mvPosition.z);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        varying float vOpacity;
        uniform vec3 uColor;
        void main() {
          float d = distance(gl_PointCoord, vec2(0.5));
          if (d > 0.5) discard;
          float strength = 1.0 - (d * 2.0);
          gl_FragColor = vec4(uColor, strength * vOpacity);
        }
      `
    });

    const stars = new THREE.Points(starGeometry, starMaterial);
    scene.add(stars);

    // --- Gold Dust (Layered Particles) ---
    const dustCount = 400;
    const dustGeometry = new THREE.BufferGeometry();
    const dustPositions = new Float32Array(dustCount * 3);
    const dustVelocities = new Float32Array(dustCount * 3);

    for (let i = 0; i < dustCount; i++) {
      const i3 = i * 3;
      dustPositions[i3] = (Math.random() - 0.5) * 20;
      dustPositions[i3 + 1] = (Math.random() - 0.5) * 20;
      dustPositions[i3 + 2] = (Math.random() - 0.5) * 10;

      dustVelocities[i3] = (Math.random() - 0.5) * 0.002;
      dustVelocities[i3 + 1] = (Math.random() - 0.5) * 0.002;
      dustVelocities[i3 + 2] = (Math.random() - 0.5) * 0.002;
    }

    dustGeometry.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3));
    const dustMaterial = new THREE.PointsMaterial({
      size: 0.03,
      color: 0xf4c96b,
      transparent: true,
      opacity: 0.4,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });

    const dust = new THREE.Points(dustGeometry, dustMaterial);
    scene.add(dust);

    // --- Shooting Stars ---
    const shootingStars: { 
      mesh: THREE.Line; 
      velocity: THREE.Vector3; 
      life: number; 
      maxLife: number;
      opacity: number;
    }[] = [];

    const createShootingStar = (isScrollBoosted = false) => {
      const startX = (Math.random() - 0.5) * 30;
      const startY = 10 + Math.random() * 5;
      const startZ = -10 - Math.random() * 10;

      const geometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0, -1, 0)
      ]);

      const brightness = isScrollBoosted ? 0.8 : 0.4;
      const material = new THREE.LineBasicMaterial({ 
        color: 0xffffff, 
        transparent: true, 
        opacity: brightness,
        blending: THREE.AdditiveBlending
      });

      const line = new THREE.Line(geometry, material);
      line.position.set(startX, startY, startZ);
      
      // Scale trail length
      const trailLength = isScrollBoosted ? 2.5 : 1.5;
      line.scale.y = trailLength;
      
      scene.add(line);

      const angle = Math.PI * 0.25 + (Math.random() - 0.5) * 0.1;
      const speed = isScrollBoosted ? 0.4 : 0.2;
      
      shootingStars.push({
        mesh: line,
        velocity: new THREE.Vector3(Math.cos(angle) * speed, -Math.sin(angle) * speed, 0),
        life: 0,
        maxLife: isScrollBoosted ? 60 : 100,
        opacity: brightness
      });
    };

    // --- Scroll Handling ---
    const handleScroll = () => {
      scrollYRef.current = window.scrollY;
    };
    window.addEventListener('scroll', handleScroll);

    // --- Resize Handling ---
    const handleResize = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    // --- Animation Loop ---
    let time = 0;
    const animate = () => {
      const frameId = requestAnimationFrame(animate);
      time += 0.01;

      // Calculate scroll velocity
      scrollVelocityRef.current = Math.abs(scrollYRef.current - lastScrollYRef.current);
      lastScrollYRef.current = scrollYRef.current;

      // Ambient movement
      stars.rotation.y += 0.0002;
      stars.rotation.x += 0.0001;
      starMaterial.uniforms.uTime.value = time;

      // Dust movement
      const dustPositionsAttr = dustGeometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < dustCount; i++) {
        const i3 = i * 3;
        dustPositionsAttr.array[i3] += dustVelocities[i3];
        dustPositionsAttr.array[i3 + 1] += dustVelocities[i3 + 1];
        dustPositionsAttr.array[i3 + 2] += dustVelocities[i3 + 2];

        // Wrap around
        if (Math.abs(dustPositionsAttr.array[i3]) > 10) dustPositionsAttr.array[i3] *= -0.9;
        if (Math.abs(dustPositionsAttr.array[i3 + 1]) > 10) dustPositionsAttr.array[i3 + 1] *= -0.9;
      }
      dustPositionsAttr.needsUpdate = true;

      // Shooting stars logic
      const scrollBoost = Math.min(scrollVelocityRef.current * 0.05, 1);
      const spawnChance = 0.005 + scrollBoost * 0.05;

      if (Math.random() < spawnChance) {
        createShootingStar(scrollBoost > 0.2);
      }

      for (let i = shootingStars.length - 1; i >= 0; i--) {
        const s = shootingStars[i];
        s.mesh.position.add(s.velocity);
        s.life++;

        // Fade out
        const lifeRatio = s.life / s.maxLife;
        (s.mesh.material as THREE.LineBasicMaterial).opacity = s.opacity * (1 - lifeRatio);

        if (s.life >= s.maxLife) {
          scene.remove(s.mesh);
          s.mesh.geometry.dispose();
          (s.mesh.material as THREE.Material).dispose();
          shootingStars.splice(i, 1);
        }
      }

      // Subtle camera drift based on scroll
      camera.position.y = 5 - scrollYRef.current * 0.002;
      camera.lookAt(0, 0, 0);

      renderer.render(scene, camera);
    };

    const frameId = requestAnimationFrame(animate);

    // --- Cleanup ---
    return () => {
      window.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(frameId);
      
      if (containerRef.current && renderer.domElement) {
        containerRef.current.removeChild(renderer.domElement);
      }
      
      // Dispose resources
      starGeometry.dispose();
      starMaterial.dispose();
      dustGeometry.dispose();
      dustMaterial.dispose();
      renderer.dispose();
    };
  }, []);

  return (
    <div 
      ref={containerRef} 
      className={`fixed inset-0 pointer-events-none z-0 overflow-hidden ${className}`}
      style={{
        background: 'radial-gradient(circle at center, #0a0c14 0%, #050508 100%)'
      }}
    >
      {/* Subtle Vignette Overlay */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_transparent_0%,_rgba(0,0,0,0.4)_100%)] pointer-events-none" />
    </div>
  );
};

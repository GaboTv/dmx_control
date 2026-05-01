import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

import { FIXTURE_CONFIGS, type FixtureState, clampDmxByte, isDirectControlMode } from '../shared/dmx';

interface TheaterViewerProps {
  fixtures: FixtureState[];
}

interface LightVisual {
  beam: THREE.Mesh<THREE.ConeGeometry, THREE.MeshBasicMaterial>;
  glow: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
  lens: THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial>;
  spot: THREE.SpotLight;
}

interface ViewerApi {
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
}

const LIGHT_POSITIONS = [
  new THREE.Vector3(-2.45, 0.18, 2.35),
  new THREE.Vector3(2.45, 0.18, 2.35),
];

const LIGHT_TARGETS = [new THREE.Vector3(-0.55, 0.95, -1.2), new THREE.Vector3(0.55, 0.95, -1.2)];

const OFF_FIXTURE: FixtureState = {
  blue: 0,
  functionMode: 0,
  functionSpeed: 0,
  green: 0,
  master: 0,
  red: 0,
  strobe: 0,
  white: 0,
};

export function TheaterViewer({ fixtures }: TheaterViewerProps) {
  const apiRef = useRef<ViewerApi>();
  const containerRef = useRef<HTMLDivElement>(null);
  const fixturesRef = useRef(fixtures);

  useEffect(() => {
    fixturesRef.current = fixtures;
  }, [fixtures]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x09070d);
    scene.fog = new THREE.Fog(0x09070d, 7, 16);

    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 80);
    camera.position.set(5.2, 3.8, 6.2);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.append(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.maxDistance = 12;
    controls.minDistance = 3.3;
    controls.target.set(0, 0.9, -0.45);
    apiRef.current = { camera, controls };

    buildTheater(scene);
    const visuals = LIGHT_POSITIONS.map((position, index) => createLightVisual(scene, position, LIGHT_TARGETS[index]));

    const resize = () => {
      const width = Math.max(1, container.clientWidth);
      const height = Math.max(1, container.clientHeight);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);
    resize();

    const clock = new THREE.Clock();
    let animationFrame = 0;
    const animate = () => {
      const elapsed = clock.getElapsedTime();
      updateLightVisuals(visuals, fixturesRef.current, elapsed);
      controls.update();
      renderer.render(scene, camera);
      animationFrame = window.requestAnimationFrame(animate);
    };
    animate();

    return () => {
      window.cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      controls.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          disposeMaterial(object.material);
        }
      });
      apiRef.current = undefined;
    };
  }, []);

  const setView = (view: 'front' | 'reset' | 'side' | 'top') => {
    const api = apiRef.current;
    if (!api) {
      return;
    }

    const target = new THREE.Vector3(0, 0.9, -0.55);
    const positions = {
      front: new THREE.Vector3(0, 2.2, 6.8),
      reset: new THREE.Vector3(5.2, 3.8, 6.2),
      side: new THREE.Vector3(6.3, 2.8, 0.8),
      top: new THREE.Vector3(0, 8.2, 0.01),
    };

    api.camera.position.copy(positions[view]);
    api.controls.target.copy(target);
    api.controls.update();
  };

  return (
    <div className="theaterViewer">
      <div className="theaterCanvas" ref={containerRef} />
      <div className="viewerHud">
        <div>
          <strong>3D Theater Preview</strong>
          <span>Floor fixtures: front-left A001, front-right A009</span>
        </div>
        <div className="viewerButtons">
          <button onClick={() => setView('reset')} type="button">
            Orbit
          </button>
          <button onClick={() => setView('front')} type="button">
            Front
          </button>
          <button onClick={() => setView('top')} type="button">
            Top
          </button>
          <button onClick={() => setView('side')} type="button">
            Side
          </button>
        </div>
      </div>
      <div className="viewerLegend">
        {FIXTURE_CONFIGS.map((fixture, index) => {
          const visual = fixtureToVisual(fixtures[index] ?? OFF_FIXTURE, index, 0);
          return (
            <span key={fixture.id}>
              <i style={{ background: visual.cssColor }} />
              {fixture.label}: A{String(fixture.startAddress).padStart(3, '0')}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function buildTheater(scene: THREE.Scene): void {
  scene.add(new THREE.HemisphereLight(0x38405f, 0x08060a, 0.9));

  const keyLight = new THREE.DirectionalLight(0xffffff, 1.3);
  keyLight.position.set(0, 6, 4);
  keyLight.castShadow = true;
  scene.add(keyLight);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(9.4, 7.2),
    new THREE.MeshStandardMaterial({ color: 0x17111e, roughness: 0.72, metalness: 0.04 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  const performanceArea = new THREE.Mesh(
    new THREE.PlaneGeometry(5.9, 4.25),
    new THREE.MeshBasicMaterial({ color: 0x2b2136, opacity: 0.55, transparent: true }),
  );
  performanceArea.position.set(0, 0.012, -0.4);
  performanceArea.rotation.x = -Math.PI / 2;
  scene.add(performanceArea);

  const backWall = new THREE.Mesh(
    new THREE.PlaneGeometry(9.4, 4.4),
    new THREE.MeshStandardMaterial({ color: 0x100c17, roughness: 0.9 }),
  );
  backWall.position.set(0, 2.2, -3.62);
  backWall.receiveShadow = true;
  scene.add(backWall);

  const curtainMaterial = new THREE.MeshStandardMaterial({ color: 0x3f0715, roughness: 0.82 });
  for (const x of [-4.2, 4.2]) {
    const curtain = new THREE.Mesh(new THREE.BoxGeometry(0.65, 4.25, 0.16), curtainMaterial.clone());
    curtain.position.set(x, 2.12, -3.48);
    curtain.castShadow = true;
    scene.add(curtain);
  }

  const grid = new THREE.GridHelper(7, 14, 0x6f5a7a, 0x2f263b);
  grid.position.y = 0.018;
  grid.position.z = -0.4;
  scene.add(grid);

  const centerLine = new THREE.Mesh(
    new THREE.BoxGeometry(0.025, 0.025, 4.25),
    new THREE.MeshBasicMaterial({ color: 0xffa861, opacity: 0.55, transparent: true }),
  );
  centerLine.position.set(0, 0.035, -0.4);
  scene.add(centerLine);
}

function createLightVisual(scene: THREE.Scene, position: THREE.Vector3, target: THREE.Vector3): LightVisual {
  const direction = target.clone().sub(position).normalize();
  const beamLength = position.distanceTo(target) + 1.3;

  const base = new THREE.Group();
  base.position.copy(position);
  scene.add(base);

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.48, 0.2, 0.36),
    new THREE.MeshStandardMaterial({ color: 0x111016, roughness: 0.5, metalness: 0.35 }),
  );
  body.castShadow = true;
  base.add(body);

  const lens = new THREE.Mesh(
    new THREE.SphereGeometry(0.13, 24, 12),
    new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.35 }),
  );
  lens.position.copy(direction.clone().multiplyScalar(0.24));
  base.add(lens);

  const beamGeometry = new THREE.ConeGeometry(1.15, beamLength, 48, 1, true);
  beamGeometry.translate(0, -beamLength / 2, 0);
  const beam = new THREE.Mesh(
    beamGeometry,
    new THREE.MeshBasicMaterial({
      blending: THREE.AdditiveBlending,
      color: 0xffffff,
      depthWrite: false,
      opacity: 0,
      side: THREE.DoubleSide,
      transparent: true,
    }),
  );
  beam.position.copy(position);
  beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), direction);
  scene.add(beam);

  const glow = new THREE.Mesh(
    new THREE.CircleGeometry(0.98, 48),
    new THREE.MeshBasicMaterial({
      blending: THREE.AdditiveBlending,
      color: 0xffffff,
      depthWrite: false,
      opacity: 0,
      transparent: true,
    }),
  );
  glow.position.copy(target);
  glow.position.y = 0.025;
  glow.rotation.x = -Math.PI / 2;
  scene.add(glow);

  const spotTarget = new THREE.Object3D();
  spotTarget.position.copy(target);
  scene.add(spotTarget);

  const spot = new THREE.SpotLight(0xffffff, 0, beamLength + 2, Math.PI / 7, 0.65, 1.2);
  spot.position.copy(position);
  spot.castShadow = true;
  spot.target = spotTarget;
  scene.add(spot);

  return { beam, glow, lens, spot };
}

function updateLightVisuals(visuals: LightVisual[], fixtures: FixtureState[], elapsed: number): void {
  visuals.forEach((visual, index) => {
    const fixture = fixtures[index] ?? OFF_FIXTURE;
    const { color, intensity } = fixtureToVisual(fixture, index, elapsed);
    visual.beam.material.color.copy(color);
    visual.beam.material.opacity = 0.08 + intensity * 0.34;
    visual.beam.visible = intensity > 0.015;
    visual.glow.material.color.copy(color);
    visual.glow.material.opacity = intensity * 0.42;
    visual.glow.scale.setScalar(0.72 + intensity * 0.8);
    visual.lens.material.color.copy(color);
    visual.lens.material.emissive.copy(color);
    visual.lens.material.emissiveIntensity = 0.25 + intensity * 1.7;
    visual.spot.color.copy(color);
    visual.spot.intensity = intensity * 5.6;
  });
}

function fixtureToVisual(fixture: FixtureState, fixtureIndex: number, elapsed: number) {
  const master = clampDmxByte(fixture.master) / 255;
  const strobe = clampDmxByte(fixture.strobe) / 255;
  const strobePulse = strobe > 0 ? (Math.sin(elapsed * (8 + strobe * 34)) > 0 ? 1 : 0.12) : 1;
  const color = isDirectControlMode(fixture.functionMode)
    ? directFixtureColor(fixture)
    : macroFixtureColor(fixture, fixtureIndex, elapsed);
  const intensity = Math.min(1, master * strobePulse * colorBrightness(color));

  return {
    color,
    cssColor: `#${color.getHexString()}`,
    intensity,
  };
}

function directFixtureColor(fixture: FixtureState): THREE.Color {
  const white = clampDmxByte(fixture.white);
  const red = clampDmxByte(fixture.red) + white * 0.85;
  const green = clampDmxByte(fixture.green) + white * 0.85;
  const blue = clampDmxByte(fixture.blue) + white * 0.85;
  return new THREE.Color(
    Math.min(1, red / 255),
    Math.min(1, green / 255),
    Math.min(1, blue / 255),
  );
}

function macroFixtureColor(fixture: FixtureState, fixtureIndex: number, elapsed: number): THREE.Color {
  const speed = clampDmxByte(fixture.functionSpeed) / 255;
  const mode = clampDmxByte(fixture.functionMode);
  const baseHue = fixtureIndex * 0.22 + speed * 0.4;
  const movingHue = (baseHue + elapsed * (0.02 + speed * 0.18)) % 1;

  if (mode <= 100) {
    return new THREE.Color().setHSL((baseHue + 0.06) % 1, 0.82, 0.55);
  }

  if (mode <= 150) {
    const jump = Math.floor(elapsed * (1 + speed * 8)) / 6;
    return new THREE.Color().setHSL((baseHue + jump) % 1, 0.88, 0.54);
  }

  if (mode <= 200) {
    return new THREE.Color().setHSL(movingHue, 0.86, 0.56);
  }

  if (mode <= 250) {
    const pulse = 0.44 + Math.abs(Math.sin(elapsed * (1.5 + speed * 8))) * 0.22;
    return new THREE.Color().setHSL(movingHue, 0.9, pulse);
  }

  return new THREE.Color().setHSL((elapsed * 0.24 + fixtureIndex * 0.33) % 1, 0.95, 0.58);
}

function colorBrightness(color: THREE.Color): number {
  return Math.max(0.08, Math.min(1, color.r * 0.3 + color.g * 0.59 + color.b * 0.11));
}

function disposeMaterial(material: THREE.Material | THREE.Material[]): void {
  if (Array.isArray(material)) {
    material.forEach((item) => item.dispose());
    return;
  }

  material.dispose();
}

import * as THREE from 'three';

/** Unused legacy export — kept so older imports keep compiling. */
export const CLOUD_Y = -9;

export interface SkyLight {
  /** 0 night .. 1 day. */
  day: number;
  /** 0 clear .. 1 heavy storm. */
  storm: number;
  horizon: THREE.Color;
  zenith: THREE.Color;
  sun: THREE.Vector3;
  /** Soft sun disc / glow tint. */
  sunColor?: THREE.Color;
}

/**
 * Soft painterly sky dome — gentle horizon haze, wide sun glow, quiet stars.
 * Tuned for a Genshin-like day/night read (low contrast, atmospheric).
 */
export class Skyscape {
  readonly group = new THREE.Group();
  private dome: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private sunCol = new THREE.Color(0xffe0b8);

  constructor() {
    this.group.name = 'skyscape';
    this.dome = new THREE.Mesh(
      new THREE.SphereGeometry(1400, 48, 24),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: {
          uTop: { value: new THREE.Color() },
          uHorizon: { value: new THREE.Color() },
          uSun: { value: new THREE.Vector3(0, 1, 0) },
          uSunCol: { value: new THREE.Color(0xffe0b8) },
          uDay: { value: 1 },
          uStars: { value: 0 },
          uTime: { value: 0 },
        },
        vertexShader: /* glsl */ `
          varying vec3 vDir;
          void main() {
            vDir = normalize(position);
            vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            gl_Position = p.xyww;
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uSun; uniform vec3 uSunCol;
          uniform float uDay; uniform float uStars; uniform float uTime;
          varying vec3 vDir;
          float h31(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
          void main() {
            vec3 d = normalize(vDir);
            float up = clamp(d.y, -1.0, 1.0);
            // Soft band: horizon haze lifts into a muted zenith (painterly, not hard).
            float t = pow(max(up, 0.0), 0.48);
            // Thin haze by day so morning stays a clear blue; a little more at the night horizon.
            float haze = exp(-max(up, 0.0) * 4.2) * (0.12 + 0.22 * (1.0 - uDay));
            vec3 col = mix(uHorizon, uTop, t);
            col = mix(col, uHorizon, haze);
            vec3 sunN = normalize(uSun);
            float sunDot = max(dot(d, sunN), 0.0);
            float disc = pow(sunDot, 64.0) * smoothstep(-0.02, 0.18, sunN.y);
            float glow = pow(sunDot, 8.0) * smoothstep(-0.12, 0.22, sunN.y);
            col += uSunCol * (disc * 0.18 + glow * 0.08) * uDay;
            // Gentle under-horizon fill so the void never goes pure black.
            float under = smoothstep(0.05, -0.35, up);
            col = mix(col, uHorizon * 0.55, under * 0.65);
            if (uStars > 0.01 && up > 0.04) {
              vec3 s = d * 220.0;
              vec3 cell = floor(s);
              float r = h31(cell);
              float star = step(0.9972, r) * smoothstep(0.38, 0.0, length(fract(s) - 0.5));
              star *= 0.4 + 0.6 * sin(uTime * (1.2 + r * 2.5) + r * 40.0);
              col += vec3(0.75, 0.82, 1.0) * star * uStars * 0.55 * smoothstep(0.04, 0.35, up);
            }
            gl_FragColor = vec4(col, 1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`,
      }),
    );
    this.dome.renderOrder = -10;
    this.dome.frustumCulled = false;
    this.group.add(this.dome);
  }

  setIsland(_cx: number, _cz: number, _radius: number): void { /* city footprint only — no void field */ }

  update(now: number, light: SkyLight, _cityGlow: number, _farness: number): void {
    const t = now / 1000;
    const dome = this.dome.material.uniforms;
    dome.uTop.value.copy(light.zenith);
    dome.uHorizon.value.copy(light.horizon);
    dome.uSun.value.copy(light.sun);
    dome.uSunCol.value.copy(light.sunColor ?? this.sunCol);
    dome.uDay.value = light.day;
    dome.uStars.value = Math.max(0, 1 - light.day * 1.8) * (1 - light.storm * 0.85);
    dome.uTime.value = t;
  }

  dispose(): void {
    this.dome.geometry.dispose();
    this.dome.material.dispose();
  }
}

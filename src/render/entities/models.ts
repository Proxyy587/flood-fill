// Toy-style entity models built from boxes and short cylinders: brick
// helicopters, blocky people with faces and swinging limbs, cars with cabins,
// lamps and wheels. Every model faces +x with its origin on the ground under
// the centre; 1 world unit = 1 cell = 4 m.
import * as THREE from 'three';
import { VehicleKind } from '../../contracts';

/** Which limb a vertex belongs to, for the walk cycle in the person shader. */
export const PART = { body: 0, armL: 1, armR: 2, legL: 3, legR: 4 } as const;
/** How a vertex glows: lamps light up at night, beacons flash in turn. */
export const GLOW = { none: 0, lamp: 1, beaconA: 2, beaconB: 3 } as const;

interface PieceOpts {
  /** Take the per-instance colour (car paint, uniform shirt). */
  tint?: boolean;
  glow?: number;
  part?: number;
}

const SHADE = { top: 1, bottom: 0.62, side: 0.9, end: 0.8 } as const;

/** Accumulates boxes and cylinders into one geometry with the entity attributes. */
export class Kit {
  private pos: number[] = [];
  private nor: number[] = [];
  private col: number[] = [];
  private mask: number[] = [];
  private glow: number[] = [];
  private part: number[] = [];
  private idx: number[] = [];
  private c = new THREE.Color();

  constructor(private tintAll = false) {}

  private vertex(p: [number, number, number], n: [number, number, number], shade: number, o: PieceOpts): void {
    this.pos.push(...p);
    this.nor.push(...n);
    this.col.push(this.c.r * shade, this.c.g * shade, this.c.b * shade);
    this.mask.push(this.tintAll || o.tint ? 1 : 0);
    this.glow.push(o.glow ?? GLOW.none);
    this.part.push(o.part ?? PART.body);
  }

  /** Axis-aligned box centred on (x, y, z). */
  box(x: number, y: number, z: number, sx: number, sy: number, sz: number, color: number, o: PieceOpts = {}): this {
    this.c.setHex(o.tint ? 0xffffff : color);
    const [hx, hy, hz] = [sx / 2, sy / 2, sz / 2];
    const faces: { n: [number, number, number]; s: number; q: [number, number, number][] }[] = [
      { n: [1, 0, 0], s: SHADE.side, q: [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]] },
      { n: [-1, 0, 0], s: SHADE.side, q: [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]] },
      { n: [0, 1, 0], s: SHADE.top, q: [[-1, 1, -1], [-1, 1, 1], [1, 1, 1], [1, 1, -1]] },
      { n: [0, -1, 0], s: SHADE.bottom, q: [[-1, -1, 1], [-1, -1, -1], [1, -1, -1], [1, -1, 1]] },
      { n: [0, 0, 1], s: SHADE.end, q: [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]] },
      { n: [0, 0, -1], s: SHADE.end, q: [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]] },
    ];
    for (const f of faces) {
      const base = this.pos.length / 3;
      for (const [a, b, d] of f.q) this.vertex([x + a * hx, y + b * hy, z + d * hz], f.n, f.s, o);
      this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    return this;
  }

  /** Short cylinder along `axis` ('y' for studs and hubs, 'z' for wheels). */
  cyl(x: number, y: number, z: number, r: number, h: number, color: number, axis: 'y' | 'z' = 'y', o: PieceOpts = {}, seg = 12): this {
    this.c.setHex(o.tint ? 0xffffff : color);
    const at = (a: number, t: number): [number, number, number] => {
      const u = Math.cos(a) * r;
      const v = Math.sin(a) * r;
      return axis === 'y' ? [x + u, y + t, z + v] : [x + u, y + v, z + t];
    };
    const norm = (a: number): [number, number, number] => (axis === 'y' ? [Math.cos(a), 0, Math.sin(a)] : [Math.cos(a), Math.sin(a), 0]);
    const capN = (s: number): [number, number, number] => (axis === 'y' ? [0, s, 0] : [0, 0, s]);
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2;
      const a1 = ((i + 1) / seg) * Math.PI * 2;
      const base = this.pos.length / 3;
      this.vertex(at(a0, -h / 2), norm(a0), SHADE.side, o);
      this.vertex(at(a1, -h / 2), norm(a1), SHADE.side, o);
      this.vertex(at(a1, h / 2), norm(a1), SHADE.side, o);
      this.vertex(at(a0, h / 2), norm(a0), SHADE.side, o);
      if (axis === 'y') this.idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
      else this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    for (const s of [-1, 1]) {
      const centre = this.pos.length / 3;
      this.vertex(axis === 'y' ? [x, y + (s * h) / 2, z] : [x, y, z + (s * h) / 2], capN(s), s > 0 ? SHADE.top : SHADE.bottom, o);
      for (let i = 0; i <= seg; i++) this.vertex(at((i / seg) * Math.PI * 2, (s * h) / 2), capN(s), s > 0 ? SHADE.top : SHADE.bottom, o);
      for (let i = 0; i < seg; i++) {
        const flip = (axis === 'y') === s > 0;
        if (flip) this.idx.push(centre, centre + i + 2, centre + i + 1);
        else this.idx.push(centre, centre + i + 1, centre + i + 2);
      }
    }
    return this;
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('tintMask', new THREE.Float32BufferAttribute(this.mask, 1));
    g.setAttribute('glow', new THREE.Float32BufferAttribute(this.glow, 1));
    g.setAttribute('part', new THREE.Float32BufferAttribute(this.part, 1));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

const C = {
  tyre: 0x23272c,
  hub: 0xc3cad1,
  glass: 0x26394d,
  sky: 0x9fd3f0,
  chrome: 0xc9d1d8,
  dark: 0x2a2f35,
  lamp: 0xfff2c2,
  tail: 0xff2d2d,
  white: 0xf6f7f7,
  red: 0xd62d20,
  blue: 0x2f6cff,
  navy: 0x1d3a8a,
  orange: 0xff6a13,
  yellow: 0xf5c518,
  skin: 0xe8b07a,
  hair: 0x2b1d14,
  pants: 0x2d3e57,
} as const;

const wheels = (k: Kit, xs: number[], zHalf: number, r: number): void => {
  for (const x of xs) {
    for (const s of [-1, 1]) {
      k.cyl(x, r, s * zHalf, r, 0.05, C.tyre, 'z');
      k.cyl(x, r, s * (zHalf + 0.026), r * 0.5, 0.006, C.hub, 'z');
    }
  }
};

const lamps = (k: Kit, front: number, rear: number, y: number, z: number): void => {
  for (const s of [-1, 1]) {
    k.box(front, y, s * z, 0.012, 0.032, 0.055, C.lamp, { glow: GLOW.lamp });
    k.box(rear, y, s * z, 0.012, 0.03, 0.05, C.tail, { glow: GLOW.lamp });
  }
};

const lightBar = (k: Kit, x: number, y: number): void => {
  k.box(x, y, 0, 0.05, 0.02, 0.05, C.dark);
  k.box(x, y + 0.002, -0.055, 0.05, 0.024, 0.06, 0xff3b30, { glow: GLOW.beaconA });
  k.box(x, y + 0.002, 0.055, 0.05, 0.024, 0.06, 0x3b7bff, { glow: GLOW.beaconB });
};

/** Hatchback: tinted paint, glass cabin, round wheels, head and tail lamps. */
const car = (police: boolean): THREE.BufferGeometry => {
  const k = new Kit(police);
  wheels(k, [0.17, -0.17], 0.115, 0.055);
  const paint = police ? { color: C.white, tint: false } : { color: C.white, tint: true };
  k.box(0, 0.115, 0, 0.56, 0.09, 0.27, paint.color, { tint: paint.tint });
  k.box(0.2, 0.163, 0, 0.16, 0.01, 0.25, paint.color, { tint: paint.tint });
  k.box(-0.035, 0.2, 0, 0.29, 0.08, 0.245, C.glass);
  k.box(-0.045, 0.2525, 0, 0.27, 0.025, 0.255, paint.color, { tint: paint.tint });
  if (police) {
    k.box(0, 0.12, 0, 0.3, 0.05, 0.274, C.navy);
    k.box(0.281, 0.13, 0, 0.004, 0.02, 0.12, C.navy);
    lightBar(k, -0.04, 0.275);
  }
  for (const s of [-1, 1]) k.box(s * 0.285, 0.085, 0, 0.022, 0.04, 0.27, C.chrome);
  k.box(0.281, 0.108, 0, 0.008, 0.025, 0.09, C.dark);
  lamps(k, 0.282, -0.282, 0.132, 0.088);
  return k.build();
};

const bus = (): THREE.BufferGeometry => {
  const k = new Kit(true);
  wheels(k, [0.27, -0.27], 0.13, 0.065);
  k.box(0, 0.2, 0, 0.86, 0.26, 0.3, 0x2e86c1);
  k.box(0, 0.1, 0, 0.862, 0.035, 0.302, C.yellow);
  k.box(-0.03, 0.255, 0, 0.72, 0.085, 0.304, C.glass);
  for (let x = -0.33; x <= 0.3; x += 0.12) k.box(x, 0.255, 0, 0.012, 0.086, 0.306, 0x2e86c1);
  k.box(0.428, 0.25, 0, 0.008, 0.12, 0.26, C.sky);
  k.box(0, 0.34, 0, 0.84, 0.02, 0.28, C.white);
  k.box(-0.12, 0.362, 0, 0.22, 0.03, 0.16, 0xdfe6ea);
  k.box(0.431, 0.315, 0, 0.006, 0.03, 0.16, 0xffa31a, { glow: GLOW.lamp });
  lamps(k, 0.432, -0.432, 0.12, 0.11);
  return k.build();
};

const ambulance = (): THREE.BufferGeometry => {
  const k = new Kit(true);
  wheels(k, [0.2, -0.2], 0.12, 0.058);
  k.box(0.21, 0.165, 0, 0.2, 0.19, 0.28, C.white);
  k.box(0.27, 0.215, 0, 0.09, 0.08, 0.27, C.glass);
  k.box(-0.08, 0.215, 0, 0.42, 0.29, 0.29, C.white);
  k.box(0, 0.15, 0, 0.62, 0.035, 0.292, C.red);
  for (const s of [-1, 1]) {
    k.box(-0.08, 0.27, s * 0.146, 0.1, 0.03, 0.004, C.red);
    k.box(-0.08, 0.27, s * 0.146, 0.03, 0.1, 0.004, C.red);
  }
  k.box(-0.08, 0.362, 0, 0.1, 0.004, 0.03, C.red);
  k.box(-0.08, 0.362, 0, 0.03, 0.004, 0.1, C.red);
  lightBar(k, 0.21, 0.27);
  k.box(-0.29, 0.34, 0, 0.012, 0.025, 0.2, 0x3b7bff, { glow: GLOW.beaconB });
  lamps(k, 0.312, -0.292, 0.12, 0.1);
  return k.build();
};

const boat = (): THREE.BufferGeometry => {
  const k = new Kit(true);
  k.box(-0.03, 0.05, 0, 0.5, 0.1, 0.3, C.orange);
  k.box(0.25, 0.06, 0, 0.08, 0.09, 0.22, C.orange);
  k.box(0.31, 0.07, 0, 0.05, 0.08, 0.12, C.orange);
  for (const s of [-1, 1]) k.box(-0.03, 0.1, s * 0.15, 0.5, 0.022, 0.022, 0x30343a);
  k.box(-0.03, 0.101, 0, 0.44, 0.004, 0.24, 0x55606b);
  k.box(0.06, 0.14, 0, 0.07, 0.08, 0.1, C.white);
  k.box(0.1, 0.19, 0, 0.01, 0.04, 0.1, C.sky);
  k.box(0.06, 0.19, 0, 0.025, 0.025, 0.025, 0x3b7bff, { glow: GLOW.beaconB });
  k.box(-0.3, 0.13, 0, 0.06, 0.1, 0.07, 0x1d2126);
  k.box(-0.315, 0.04, 0, 0.02, 0.08, 0.02, 0x1d2126);
  for (const s of [-1, 1]) {
    k.box(-0.11, 0.15, s * 0.06, 0.06, 0.07, 0.06, 0xff8c1a);
    k.box(-0.11, 0.21, s * 0.06, 0.05, 0.05, 0.05, C.skin);
    k.box(-0.11, 0.242, s * 0.06, 0.056, 0.018, 0.056, C.white);
  }
  k.box(0.33, 0.1, 0, 0.01, 0.02, 0.05, C.lamp, { glow: GLOW.lamp });
  return k.build();
};

/** Top of the helicopter's rotor mast, where the rotor hub sits. */
export const ROTOR_HUB_Y = 0.4;

/** Brick-built rescue helicopter: studs on the roof, bubble cockpit, skids, tail rotor. */
const helicopter = (): THREE.BufferGeometry => {
  const k = new Kit(true);
  for (const s of [-1, 1]) {
    k.box(0.02, 0.02, s * 0.15, 0.66, 0.03, 0.03, C.dark);
    k.box(0.22, 0.008, s * 0.15, 0.06, 0.016, 0.034, C.dark);
    for (const x of [-0.12, 0.16]) k.box(x, 0.06, s * 0.125, 0.03, 0.07, 0.025, C.dark);
  }
  k.box(0.02, 0.2, 0, 0.42, 0.24, 0.26, C.red);
  k.box(0.02, 0.185, 0, 0.424, 0.04, 0.264, C.white);
  k.box(0.27, 0.17, 0, 0.1, 0.16, 0.22, C.red);
  k.box(0.3, 0.235, 0, 0.12, 0.1, 0.2, C.sky);
  k.box(0.24, 0.27, 0, 0.06, 0.04, 0.2, C.sky);
  for (const s of [-1, 1]) k.box(0.06, 0.24, s * 0.131, 0.14, 0.08, 0.004, C.sky);
  for (const x of [-0.11, 0.0, 0.11]) for (const z of [-0.06, 0.06]) k.cyl(x, 0.33, z, 0.026, 0.02, C.red);
  k.box(-0.38, 0.26, 0, 0.42, 0.07, 0.07, C.red);
  k.box(-0.38, 0.262, 0, 0.18, 0.072, 0.072, C.white);
  k.box(-0.59, 0.33, 0, 0.1, 0.17, 0.025, C.red);
  k.box(-0.57, 0.27, 0, 0.12, 0.016, 0.16, C.red);
  k.box(-0.6, 0.34, 0.03, 0.02, 0.18, 0.012, C.dark);
  k.box(-0.6, 0.34, 0.03, 0.18, 0.02, 0.012, C.dark);
  k.box(0.02, 0.37, 0, 0.06, 0.06, 0.06, C.dark);
  k.box(-0.635, 0.42, 0, 0.02, 0.02, 0.02, C.white, { glow: GLOW.beaconA });
  k.box(0.0, 0.075, 0, 0.04, 0.02, 0.04, 0xff3b30, { glow: GLOW.beaconA });
  k.box(0.33, 0.12, 0, 0.012, 0.03, 0.06, C.lamp, { glow: GLOW.lamp });
  return k.build();
};

const VEHICLE_BUILDERS: Record<VehicleKind, () => THREE.BufferGeometry> = {
  [VehicleKind.Car]: () => car(false),
  [VehicleKind.Bus]: bus,
  [VehicleKind.Ambulance]: ambulance,
  [VehicleKind.PoliceCar]: () => car(true),
  [VehicleKind.Boat]: boat,
  [VehicleKind.Helicopter]: helicopter,
};

export const vehicleGeometry = (kind: VehicleKind): THREE.BufferGeometry => VEHICLE_BUILDERS[kind]();

/** Main rotor, spun by the entity layer. Origin at the hub. */
export const rotorGeometry = (): THREE.BufferGeometry => {
  const k = new Kit(true);
  k.cyl(0, 0.015, 0, 0.035, 0.03, C.dark);
  k.box(0, 0.025, 0, 1.15, 0.012, 0.055, 0x3a3f45);
  k.box(0, 0.025, 0, 0.055, 0.012, 1.15, 0x3a3f45);
  for (const s of [-1, 1]) {
    k.box(s * 0.545, 0.026, 0, 0.06, 0.013, 0.056, C.yellow);
    k.box(0, 0.026, s * 0.545, 0.056, 0.013, 0.06, C.yellow);
  }
  return k.build();
};

/** Shoulder and hip heights: the pivots for the walk cycle. */
export const PERSON_PIVOT = { shoulder: 0.27, hip: 0.15 } as const;

/** Blocky figure with a big head, face and hair; the shirt takes the role colour. */
export const personGeometry = (): THREE.BufferGeometry => {
  const k = new Kit();
  for (const [s, leg, arm] of [
    [1, PART.legL, PART.armL],
    [-1, PART.legR, PART.armR],
  ] as const) {
    k.box(0, 0.075, s * 0.031, 0.06, 0.15, 0.056, C.pants, { part: leg });
    k.box(0.008, 0.008, s * 0.031, 0.075, 0.016, 0.058, C.dark, { part: leg });
    k.box(0, 0.235, s * 0.0875, 0.052, 0.07, 0.045, C.white, { tint: true, part: arm });
    k.box(0, 0.175, s * 0.0875, 0.048, 0.05, 0.042, C.skin, { part: arm });
  }
  k.box(0, 0.21, 0, 0.08, 0.12, 0.13, C.white, { tint: true });
  k.box(0, 0.152, 0, 0.082, 0.012, 0.132, 0x3b2a1e);
  k.box(0, 0.278, 0, 0.04, 0.016, 0.04, C.skin);
  k.box(0, 0.338, 0, 0.11, 0.11, 0.11, C.skin);
  for (const s of [-1, 1]) k.box(0.056, 0.348, s * 0.022, 0.004, 0.018, 0.012, 0x15181b);
  k.box(0.056, 0.316, 0, 0.004, 0.007, 0.036, 0x15181b);
  k.box(0, 0.4, 0, 0.116, 0.024, 0.116, C.hair);
  k.box(-0.048, 0.36, 0, 0.022, 0.07, 0.116, C.hair);
  return k.build();
};

export interface EntityUniforms {
  uNight: { value: number };
  uTime: { value: number };
}

/**
 * Lambert material for every entity. The per-instance colour applies only
 * where `tintMask` is 1, lamps glow at night and beacons flash. With `walk`,
 * limbs swing from an instanced `walk` attribute (phase, amplitude, wave).
 */
export const INSTANCE_TINT_LINE = 'vColor.rgb *= instanceColor.rgb;';

export const maskedColorVertex = (): string =>
  THREE.ShaderChunk.color_vertex.replace(INSTANCE_TINT_LINE, 'vColor.rgb *= mix( vec3( 1.0 ), instanceColor.rgb, tintMask );');

const WALK_VERTEX = /* glsl */ `
vec3 transformed = vec3( position );
if ( part > 0.5 ) {
  bool isLeg = part > 2.5;
  float side = ( part < 1.5 || ( part > 2.5 && part < 3.5 ) ) ? 1.0 : -1.0;
  float pivotY = isLeg ? ${PERSON_PIVOT.hip.toFixed(3)} : ${PERSON_PIVOT.shoulder.toFixed(3)};
  if ( !isLeg && walk.z > 0.5 ) {
    float a = -side * ( 2.5 + 0.35 * sin( walk.x * 2.0 ) );
    vec2 p = vec2( transformed.y - pivotY, transformed.z - side * 0.065 );
    transformed.y = p.x * cos( a ) - p.y * sin( a ) + pivotY;
    transformed.z = p.x * sin( a ) + p.y * cos( a ) + side * 0.065;
  } else {
    float a = sin( walk.x ) * walk.y * side * ( isLeg ? 0.7 : -0.9 );
    vec2 p = vec2( transformed.x, transformed.y - pivotY );
    transformed.x = p.x * cos( a ) - p.y * sin( a );
    transformed.y = p.x * sin( a ) + p.y * cos( a ) + pivotY;
  }
}
`;

const GLOW_FRAGMENT = /* glsl */ `
float glowOn = 0.0;
if ( vGlow > 0.5 && vGlow < 1.5 ) glowOn = uNight;
else if ( vGlow > 1.5 && vGlow < 2.5 ) glowOn = step( 0.0, sin( uTime * 9.0 ) );
else if ( vGlow > 2.5 ) glowOn = step( 0.0, -sin( uTime * 9.0 ) );
outgoingLight = mix( outgoingLight, diffuseColor.rgb * 1.7, glowOn );
#include <opaque_fragment>
`;

export const entityMaterial = (opts: { walk?: boolean } = {}): { material: THREE.MeshLambertMaterial; uniforms: EntityUniforms } => {
  const uniforms: EntityUniforms = { uNight: { value: 0 }, uTime: { value: 0 } };
  const m = new THREE.MeshLambertMaterial({ vertexColors: true });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = uniforms.uNight;
    shader.uniforms.uTime = uniforms.uTime;
    let vs = shader.vertexShader
      .replace('#include <common>', `#include <common>\nattribute float tintMask;\nattribute float glow;\nattribute float part;\n${opts.walk ? 'attribute vec3 walk;\n' : ''}varying float vGlow;`)
      .replace('#include <color_vertex>', `${maskedColorVertex()}\nvGlow = glow;`);
    if (opts.walk) vs = vs.replace('#include <begin_vertex>', WALK_VERTEX);
    shader.vertexShader = vs;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uNight;\nuniform float uTime;\nvarying float vGlow;')
      .replace('#include <opaque_fragment>', GLOW_FRAGMENT);
  };
  m.customProgramCacheKey = () => (opts.walk ? 'entity-toy-walk' : 'entity-toy');
  return { material: m, uniforms };
};

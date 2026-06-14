/**
 * Engine — renderer, scene, camera, lighting, sky and post-processing.
 *
 * Aims for a "baked in Unity" desert look: ACES filmic tone mapping,
 * a warm shadow-casting sun, hemispheric bounce light, exponential haze
 * fog and a gradient sky dome with a bloom-lit sun disc.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';

const QUALITY = {
  high:   { pixelRatio: 1.5, shadowMap: 4096, bloom: true, fxaa: true, shadows: true, ssao: true },
  medium: { pixelRatio: 1.25, shadowMap: 2048, bloom: true, fxaa: true, shadows: true, ssao: true },
  low:    { pixelRatio: 1.0, shadowMap: 1024, bloom: false, fxaa: false, shadows: true, ssao: false },
};

// Filmic grade: contrast, saturation, warm tint and vignette — the
// desaturated-warm look that reads as "tactical shooter".
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    contrast: { value: 1.09 }, saturation: { value: 1.14 }, brightness: { value: -0.005 },
    warmth: { value: 0.028 }, vignette: { value: 0.46 }, vignetteSoft: { value: 0.32 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
  fragmentShader: /* glsl */`
    varying vec2 vUv; uniform sampler2D tDiffuse;
    uniform float contrast, saturation, brightness, warmth, vignette, vignetteSoft;
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 col = c.rgb;
      col = (col - 0.5) * contrast + 0.5 + brightness;
      float l = dot(col, vec3(0.2126,0.7152,0.0722));
      col = mix(vec3(l), col, saturation);
      col *= vec3(1.0 + warmth, 1.0 + warmth*0.25, 1.0 - warmth*0.6);   // warm
      float d = distance(vUv, vec2(0.5));
      float edge = smoothstep(vignetteSoft, 0.82, d);
      col *= mix(1.0, 1.0 - vignette, edge);
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), c.a);
    }`,
};

export class Engine {
  constructor(canvas, quality = 'medium') {
    this.canvas = canvas;
    this.quality = QUALITY[quality] || QUALITY.medium;
    this.qualityName = quality;

    this.renderer = new THREE.WebGLRenderer({
      canvas, antialias: this.quality.fxaa ? false : true, powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.quality.pixelRatio));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = this.quality.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();

    // Warm desert haze fog.
    this.fogColor = new THREE.Color(0xd9c39a);
    this.scene.fog = new THREE.Fog(this.fogColor, 55, 190);
    this.scene.background = this.fogColor.clone();

    this.camera = new THREE.PerspectiveCamera(90, window.innerWidth / window.innerHeight, 0.05, 1200);
    this.camera.rotation.order = 'YXZ';

    this._buildLights();
    this._buildSky();
    this._buildEnvironment();
    this._buildComposer();
    this._buildViewmodelLayer();

    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
  }

  // Shared overlay camera for first-person weapons. Each player's weapon
  // lives in its own viewmodel scene (built by its WeaponManager) so it
  // never clips into world geometry and isn't affected by world fog/bloom.
  _buildViewmodelLayer() {
    this.vmCamera = new THREE.PerspectiveCamera(68, window.innerWidth / window.innerHeight, 0.01, 50);
    // a second world camera for split-screen player 2
    this.camera2 = new THREE.PerspectiveCamera(90, window.innerWidth / window.innerHeight, 0.05, 1200);
    this.camera2.rotation.order = 'YXZ';
    this.split = false;
  }

  // Standard lights for a viewmodel scene (called by WeaponManager).
  addViewmodelLights(scene) {
    scene.add(new THREE.HemisphereLight(0xd8e4ff, 0x66584a, 1.0));
    const key = new THREE.DirectionalLight(0xfff2da, 2.2); key.position.set(-0.6, 1.2, 1.5); scene.add(key);
    const fill = new THREE.DirectionalLight(0x95a8c8, 0.7); fill.position.set(1.2, 0.3, 0.6); scene.add(fill);
    if (this.envMap) scene.environment = this.envMap;
  }

  // Configure for 1 or 2 local players (horizontal split for 2).
  setPlayerCount(n) {
    this.split = n >= 2;
    this.resize();
  }

  _buildLights() {
    // Warm key sun.
    const sun = new THREE.DirectionalLight(0xffeccb, 3.2);
    this.sunDir = new THREE.Vector3(-0.55, 0.7, 0.45).normalize();
    sun.position.copy(this.sunDir.clone().multiplyScalar(120));
    sun.castShadow = this.quality.shadows;
    sun.shadow.mapSize.set(this.quality.shadowMap, this.quality.shadowMap);
    const d = 95;
    sun.shadow.camera.left = -d; sun.shadow.camera.right = d;
    sun.shadow.camera.top = d; sun.shadow.camera.bottom = -d;
    sun.shadow.camera.near = 1; sun.shadow.camera.far = 320;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.035;
    this.scene.add(sun);
    this.scene.add(sun.target);
    this.sun = sun;

    // Sky/ground bounce.
    const hemi = new THREE.HemisphereLight(0xbcd4ff, 0xa8814a, 0.55);
    this.scene.add(hemi);

    // Soft warm fill so shadowed faces aren't crushed (kept low for contrast).
    const amb = new THREE.AmbientLight(0xffe6c2, 0.2);
    this.scene.add(amb);

    // Cool rim/bounce from the opposite side.
    const rim = new THREE.DirectionalLight(0x9fb4d8, 0.42);
    rim.position.set(40, 30, -50);
    this.scene.add(rim);
  }

  _buildSky() {
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(800, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide, depthWrite: false, fog: false,
        uniforms: {
          uTop: { value: new THREE.Color(0x4a78b8) },
          uMid: { value: new THREE.Color(0xbcd0e0) },
          uBot: { value: new THREE.Color(0xe9d6ad) },
          uSun: { value: this.sunDir.clone() },
          uSunCol: { value: new THREE.Color(0xfff4d6) },
        },
        vertexShader: /* glsl */`
          varying vec3 vDir;
          void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
        `,
        fragmentShader: /* glsl */`
          varying vec3 vDir; uniform vec3 uTop,uMid,uBot,uSun,uSunCol;
          void main(){
            float h = normalize(vDir).y;
            vec3 col = mix(uBot, uMid, smoothstep(-0.05, 0.25, h));
            col = mix(col, uTop, smoothstep(0.15, 0.7, h));
            float s = max(dot(normalize(vDir), normalize(uSun)), 0.0);
            col += uSunCol * pow(s, 90.0) * 1.4;            // sun disc
            col += uSunCol * pow(s, 6.0) * 0.18;            // glow halo
            gl_FragColor = vec4(col, 1.0);
          }
        `,
      })
    );
    sky.frustumCulled = false;
    this.scene.add(sky);
    this.sky = sky;
  }

  // Prefilter the sky into an environment map (IBL). Gives metals (guns,
  // barrels, the truck) and surfaces real reflections — the biggest lift
  // from "hobby" to "AAA". Captured once at startup from the sky dome.
  _buildEnvironment() {
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    pmrem.compileEquirectangularShader();
    // Temporary scene holding just the sky dome for a clean capture.
    const capScene = new THREE.Scene();
    const skyClone = this.sky.clone();
    skyClone.material = this.sky.material; // share shader
    capScene.add(skyClone);
    const rt = pmrem.fromScene(capScene, 0.04, 0.1, 2000);
    this.scene.environment = rt.texture;
    this.envMap = rt.texture;
    if ('environmentIntensity' in this.scene) this.scene.environmentIntensity = 0.85;
    pmrem.dispose();
  }

  _buildComposer() {
    const w = window.innerWidth, h = window.innerHeight;
    this.composer = new EffectComposer(this.renderer);
    this.composer.setPixelRatio(Math.min(window.devicePixelRatio, this.quality.pixelRatio));
    this.composer.setSize(w, h);

    this.renderPass = new RenderPass(this.scene, this.camera);

    // Ground-truth ambient occlusion — soft contact shadows in crevices.
    this.ssaoEnabled = !!this.quality.ssao;
    if (this.quality.ssao) {
      this.gtaoPass = new GTAOPass(this.scene, this.camera, w, h);
      try {
        this.gtaoPass.output = GTAOPass.OUTPUT.Default;
        this.gtaoPass.blendIntensity = 1.0;
        this.gtaoPass.updateGtaoMaterial({ radius: 0.45, distanceExponent: 1.0, thickness: 1.0, scale: 1.0, samples: 16, distanceFallOff: 1.0, screenSpaceRadius: false });
        this.gtaoPass.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 4, radiusExponent: 1, rings: 2, samples: 16 });
      } catch (e) { console.warn('GTAO config:', e.message); }
    }

    this.bloomEnabled = this.quality.bloom;
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(w, h), 0.5, 0.55, 0.82);

    this.gradePass = new ShaderPass(GradeShader);

    this.fxaaPass = this.quality.fxaa ? new ShaderPass(FXAAShader) : null;
    this._updateFxaa();

    this.outputPass = new OutputPass();
    this._composePasses();
  }

  // Rebuild the ordered pass list from feature flags.
  _composePasses() {
    this.composer.passes = [];
    this.composer.addPass(this.renderPass);
    if (this.ssaoEnabled && this.gtaoPass) this.composer.addPass(this.gtaoPass);
    if (this.bloomEnabled) this.composer.addPass(this.bloomPass);
    this.composer.addPass(this.gradePass);
    if (this.fxaaPass) this.composer.addPass(this.fxaaPass);
    this.composer.addPass(this.outputPass);
  }

  _updateFxaa() {
    if (!this.fxaaPass) return;
    const pr = this.renderer.getPixelRatio();
    this.fxaaPass.material.uniforms['resolution'].value.set(
      1 / (window.innerWidth * pr), 1 / (window.innerHeight * pr));
  }

  setBloom(on) {
    this.bloomEnabled = on && this.quality.bloom !== false;
    this._composePasses();
  }
  setSSAO(on) {
    this.ssaoEnabled = on && !!this.gtaoPass;
    this._composePasses();
  }

  setFov(fov) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    // split-screen stacks two viewports vertically -> each is w x h/2
    const aspect = this.split ? (w / (h / 2)) : (w / h);
    this.camera.aspect = aspect; this.camera.updateProjectionMatrix();
    this.camera2.aspect = aspect; this.camera2.updateProjectionMatrix();
    if (this.vmCamera) { this.vmCamera.aspect = aspect; this.vmCamera.updateProjectionMatrix(); }
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.bloomPass?.setSize(w, h);
    this.gtaoPass?.setSize(w, h);
    this._updateFxaa();
  }

  /**
   * Render the given player views. views = [{camera, vmScene}, ...].
   * 1 view -> full post-FX composer. 2 views -> direct dual scissor render
   * (top = views[0], bottom = views[1]).
   */
  render(views) {
    const r = this.renderer;
    if (!views || views.length <= 1) {
      const v = (views && views[0]) || { camera: this.camera, vmScene: null };
      this.renderPass.camera = v.camera || this.camera;
      this.composer.render();
      if (v && v.vmScene) {
        r.autoClear = false; r.clearDepth();
        r.render(v.vmScene, this.vmCamera);
        r.autoClear = true;
      }
      return;
    }
    // split: two stacked halves
    const w = r.domElement.width, h = r.domElement.height;   // device pixels
    const halfH = Math.floor(h / 2);
    const rects = [[0, halfH, w, h - halfH], [0, 0, w, halfH]]; // GL y is bottom-up
    r.setScissorTest(true);
    for (let i = 0; i < 2; i++) {
      const [x, y, vw, vh] = rects[i];
      r.setViewport(x, y, vw, vh);
      r.setScissor(x, y, vw, vh);
      r.clear();
      r.render(this.scene, views[i].camera);
      if (views[i].vmScene) { r.clearDepth(); r.render(views[i].vmScene, this.vmCamera); }
    }
    r.setScissorTest(false);
    r.setViewport(0, 0, w, h);
  }

  dispose() {
    window.removeEventListener('resize', this._onResize);
    this.renderer.dispose();
  }
}

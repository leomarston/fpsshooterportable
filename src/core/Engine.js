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
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';

const QUALITY = {
  high:   { pixelRatio: 1.5, shadowMap: 4096, bloom: true, fxaa: true, shadows: true },
  medium: { pixelRatio: 1.25, shadowMap: 2048, bloom: true, fxaa: true, shadows: true },
  low:    { pixelRatio: 1.0, shadowMap: 1024, bloom: false, fxaa: false, shadows: true },
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
    this.renderer.toneMappingExposure = 1.05;
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
    this._buildComposer();
    this._buildViewmodelLayer();

    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
  }

  // Separate overlay scene for the first-person weapon so it never clips
  // into world geometry and isn't affected by world fog/bloom.
  _buildViewmodelLayer() {
    this.vmScene = new THREE.Scene();
    this.vmCamera = new THREE.PerspectiveCamera(68, window.innerWidth / window.innerHeight, 0.01, 50);
    this.vmScene.add(new THREE.HemisphereLight(0xd8e4ff, 0x66584a, 1.0));
    const key = new THREE.DirectionalLight(0xfff2da, 2.2);
    key.position.set(-0.6, 1.2, 1.5);
    this.vmScene.add(key);
    const fill = new THREE.DirectionalLight(0x95a8c8, 0.7);
    fill.position.set(1.2, 0.3, 0.6);
    this.vmScene.add(fill);
  }

  _buildLights() {
    // Warm key sun.
    const sun = new THREE.DirectionalLight(0xfff0d0, 2.7);
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
    const hemi = new THREE.HemisphereLight(0xcfe0ff, 0xb08a4e, 0.85);
    this.scene.add(hemi);

    // Soft warm fill so shadowed faces aren't crushed.
    const amb = new THREE.AmbientLight(0xffe9c8, 0.32);
    this.scene.add(amb);

    // Cool rim/bounce from the opposite side.
    const rim = new THREE.DirectionalLight(0x9fb4d8, 0.5);
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

  _buildComposer() {
    this.composer = new EffectComposer(this.renderer);
    this.composer.setPixelRatio(Math.min(window.devicePixelRatio, this.quality.pixelRatio));
    this.composer.setSize(window.innerWidth, window.innerHeight);

    this.renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this.renderPass);

    this.bloomEnabled = this.quality.bloom;
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight), 0.55, 0.5, 0.85);
    if (this.bloomEnabled) this.composer.addPass(this.bloomPass);

    if (this.quality.fxaa) {
      this.fxaaPass = new ShaderPass(FXAAShader);
      this._updateFxaa();
      this.composer.addPass(this.fxaaPass);
    }

    this.outputPass = new OutputPass();
    this.composer.addPass(this.outputPass);
  }

  _updateFxaa() {
    if (!this.fxaaPass) return;
    const pr = this.renderer.getPixelRatio();
    this.fxaaPass.material.uniforms['resolution'].value.set(
      1 / (window.innerWidth * pr), 1 / (window.innerHeight * pr));
  }

  setBloom(on) {
    if (!this.fxaaPass && !this.bloomPass) return;
    // Rebuild composer passes to toggle bloom cleanly.
    this.composer.passes = this.composer.passes.filter(p => p !== this.bloomPass);
    if (on && this.quality.bloom !== false) {
      // insert bloom before fxaa/output
      const idx = this.composer.passes.indexOf(this.outputPass);
      const insertAt = this.fxaaPass ? this.composer.passes.indexOf(this.fxaaPass) : idx;
      this.composer.passes.splice(insertAt, 0, this.bloomPass);
    }
    this.bloomEnabled = on;
  }

  setFov(fov) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.vmCamera) { this.vmCamera.aspect = w / h; this.vmCamera.updateProjectionMatrix(); }
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.bloomPass?.setSize(w, h);
    this._updateFxaa();
  }

  render() {
    this.composer.render();
    // Composite the first-person weapon on top of the post-processed frame.
    if (this.vmScene && this.vmCamera) {
      this.renderer.autoClear = false;
      this.renderer.clearDepth();
      this.renderer.render(this.vmScene, this.vmCamera);
      this.renderer.autoClear = true;
    }
  }

  dispose() {
    window.removeEventListener('resize', this._onResize);
    this.renderer.dispose();
  }
}

import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { moveLabel } from './moves'
import type { Axis, CubeCommand, Cubie, ExperienceOptions } from './types'

export type { CubeCommand } from './types'

const SPACING = 1.02
const HALF_PI = Math.PI / 2
const COLORS = {
  right: 0xff385c,
  left: 0xff9f1c,
  top: 0xf5f1dc,
  bottom: 0xffd60a,
  front: 0x18b57d,
  back: 0x3478f6,
}

type Meteor = {
  group: THREE.Group
  trail: THREE.Mesh
  head: THREE.Mesh
  velocity: THREE.Vector3
  life: number
  maxLife: number
}

export class CosmicCube {
  private host: HTMLDivElement
  private scene = new THREE.Scene()
  private camera!: THREE.PerspectiveCamera | THREE.OrthographicCamera
  private renderer: THREE.WebGLRenderer
  private composer: EffectComposer
  private controls: OrbitControls
  private cubeRoot = new THREE.Group()
  private cubies: Cubie[] = []
  private turnPivot = new THREE.Group()
  private queue: (CubeCommand & { undo?: boolean })[] = []
  private history: CubeCommand[] = []
  private activeTurn: { command: CubeCommand & { undo?: boolean }; progress: number; members: Cubie[] } | null = null
  private stars: THREE.Points[] = []
  private meteors: Meteor[] = []
  private nebulae: THREE.Sprite[] = []
  private clock = new THREE.Clock()
  private raf = 0
  private elapsed = 0
  private moveCount = 0
  private autoRotate = true
  private soundOn = true
  private disposed = false
  private isTest: boolean
  private isStudio: boolean
  private view: string
  private options: ExperienceOptions
  private resizeObserver: ResizeObserver
  private materials: THREE.Material[] = []
  private geometries: THREE.BufferGeometry[] = []
  private textures: THREE.Texture[] = []
  private environmentTarget!: THREE.WebGLRenderTarget
  private audioContext: AudioContext | null = null
  private interacting = false
  private resumeOrbitAt = 0
  private lastMove = '—'
  private onControlStart = () => { this.interacting = true }
  private onControlEnd = () => { this.interacting = false; this.resumeOrbitAt = this.elapsed + 2 }

  constructor(host: HTMLDivElement, options: ExperienceOptions = {}) {
    this.host = host
    this.options = options
    const params = new URLSearchParams(location.search)
    this.isTest = params.get('test') === '1'
    this.isStudio = params.get('studio') === '1'
    this.view = params.get('view') || 'front'
    document.documentElement.classList.toggle('studio-mode', this.isStudio)

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.8))
    this.renderer.setSize(host.clientWidth, host.clientHeight)
    this.renderer.setClearColor(this.isStudio ? 0x070914 : 0x02030a, 1)
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.05
    host.appendChild(this.renderer.domElement)

    const aspect = Math.max(host.clientWidth / Math.max(host.clientHeight, 1), 0.1)
    if (this.isStudio) {
      const size = 3.7
      this.camera = new THREE.OrthographicCamera(-size * aspect, size * aspect, size, -size, 0.1, 100)
      this.setStudioCamera()
    } else {
      this.camera = new THREE.PerspectiveCamera(37, aspect, 0.1, 160)
      this.camera.position.set(7.15, 4.35, 8.5)
    }

    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.enableDamping = !this.isTest
    this.controls.dampingFactor = 0.055
    this.controls.enablePan = false
    this.controls.minDistance = 7
    this.controls.maxDistance = 23
    this.controls.target.set(0, 0.05, 0)
    this.controls.autoRotate = false
    this.controls.rotateSpeed = 0.55
    this.controls.zoomSpeed = 0.8
    this.controls.addEventListener('start', this.onControlStart)
    this.controls.addEventListener('end', this.onControlEnd)
    if (this.isStudio) this.controls.enabled = false

    this.composer = new EffectComposer(this.renderer)
    this.composer.addPass(new RenderPass(this.scene, this.camera))
    const bloom = new UnrealBloomPass(new THREE.Vector2(host.clientWidth, host.clientHeight), this.isStudio ? 0.42 : 0.8, 0.72, 0.68)
    bloom.threshold = 2.0
    bloom.strength = this.isStudio ? 0.18 : 0.32
    bloom.radius = 0.68
    this.composer.addPass(bloom)
    this.composer.addPass(new OutputPass())

    this.scene.add(this.cubeRoot)
    // Keep the pivot in the cube's local frame so orbiting never changes a layer's axis.
    this.cubeRoot.add(this.turnPivot)
    this.setupReflection()
    this.buildEnvironment()
    this.buildCube()
    this.setupLights()
    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(host)

    window.render_state_to_text = () => JSON.stringify(this.getState(), null, 2)
    window.step = (ms: number) => {
      const steps = Math.max(1, Math.ceil(ms / (1000 / 60)))
      const dt = ms / 1000 / steps
      for (let i = 0; i < steps; i += 1) this.update(Math.min(dt, 1 / 30))
      this.render()
      return window.render_state_to_text()
    }

    this.render()
    window.__READY__ = true
    this.notifyActivity()
    if (!this.isTest) this.animate()
  }

  setAutoRotate(value: boolean) { this.autoRotate = value }
  setSound(value: boolean) { this.soundOn = value }

  private notifyActivity() {
    this.options.onActivity?.({
      busy: Boolean(this.activeTurn || this.queue.length),
      solved: this.isSolved(),
      canUndo: this.history.length > 0 && !this.activeTurn && !this.queue.length,
      lastMove: this.lastMove,
    })
  }

  private isSolved() {
    if (this.activeTurn) return false
    // Compare sticker normals by world-facing side. Center spins do not affect solvedness.
    const faces = new Map<string, THREE.Material>()
    for (const { mesh } of this.cubies) {
      for (const child of mesh.children) {
        if (!(child instanceof THREE.Mesh) || !child.userData.sticker) continue
        const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(child.quaternion).applyQuaternion(mesh.quaternion).round()
        const key = normal.toArray().join(',')
        const material = child.material as THREE.Material
        if (faces.has(key) && faces.get(key) !== material) return false
        faces.set(key, material)
      }
    }
    return faces.size === 6
  }

  enqueue(command: CubeCommand) {
    if (this.queue.length >= 36) return
    this.queue.push({ ...command })
    this.options.onStatus?.('层级旋转执行中')
    this.notifyActivity()
  }

  scramble(count = 18) {
    if (this.activeTurn || this.queue.length) return
    const axes: Axis[] = ['x', 'y', 'z']
    let previous = ''
    for (let i = 0; i < count; i += 1) {
      let axis = axes[Math.floor(Math.random() * axes.length)]
      while (axis === previous) axis = axes[Math.floor(Math.random() * axes.length)]
      previous = axis
      this.queue.push({ axis, layer: (Math.random() > 0.5 ? 1 : -1), direction: (Math.random() > 0.5 ? 1 : -1) })
    }
    this.options.onStatus?.('正在打乱')
    this.notifyActivity()
  }

  undo() {
    if (this.activeTurn || this.queue.length || !this.history.length) return
    const command = this.history[this.history.length - 1]
    this.queue.push({ ...command, direction: command.direction === 1 ? -1 : 1, undo: true })
    this.options.onStatus?.('正在撤销')
    this.notifyActivity()
  }

  reset() {
    this.queue = []
    this.activeTurn = null
    while (this.turnPivot.children.length) this.cubeRoot.attach(this.turnPivot.children[0])
    this.turnPivot.rotation.set(0, 0, 0)
    this.cubies.forEach(({ mesh, coord, home }) => {
      coord.copy(home)
      mesh.position.copy(home).multiplyScalar(SPACING)
      mesh.quaternion.identity()
    })
    this.moveCount = 0
    this.history = []
    this.lastMove = '—'
    this.options.onMove?.(0)
    this.options.onStatus?.('核心已复位')
    this.notifyActivity()
  }

  private setupReflection() {
    const room = new RoomEnvironment()
    const generator = new THREE.PMREMGenerator(this.renderer)
    this.environmentTarget = generator.fromScene(room, 0.04)
    this.scene.environment = this.environmentTarget.texture
    this.scene.environmentIntensity = 0.32
    room.dispose()
    generator.dispose()
  }

  private surfaceTexture() {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1024
    const ctx = canvas.getContext('2d')!
    const pixels = ctx.createImageData(1024, 1024)
    const random = this.seeded(3409)
    for (let i = 0; i < pixels.data.length; i += 4) {
      const shade = 175 + Math.floor(random() * 60)
      pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = shade
      pixels.data[i + 3] = 255
    }
    ctx.putImageData(pixels, 0, 0)
    const texture = new THREE.CanvasTexture(canvas)
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping
    texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy())
    this.textures.push(texture)
    return texture
  }

  private buildCube() {
    const surface = this.surfaceTexture()
    const bodyGeometry = new RoundedBoxGeometry(0.91, 0.91, 0.91, 5, 0.105)
    this.geometries.push(bodyGeometry)
    const bodyMaterial = new THREE.MeshPhysicalMaterial({
      color: 0x070912,
      metalness: 0.73,
      roughness: 0.3,
      roughnessMap: surface,
      bumpMap: surface,
      bumpScale: 0.008,
      clearcoat: 0.7,
      clearcoatRoughness: 0.2,
      envMapIntensity: 1.2,
    })
    this.materials.push(bodyMaterial)
    const stickerGeometry = this.createRoundedPlane(0.76, 0.105)
    this.geometries.push(stickerGeometry)
    const edgeMaterial = new THREE.LineBasicMaterial({ color: 0x444d6a, transparent: true, opacity: 0.27 })
    this.materials.push(edgeMaterial)
    const edgeGeometry = new THREE.EdgesGeometry(bodyGeometry, 28)
    this.geometries.push(edgeGeometry)

    const stickerMaterials = new Map<number, THREE.MeshPhysicalMaterial>()
    Object.values(COLORS).forEach((color) => {
      const material = new THREE.MeshPhysicalMaterial({
        color,
        roughness: 0.3,
        roughnessMap: surface,
        bumpMap: surface,
        bumpScale: 0.003,
        metalness: 0.04,
        clearcoat: 0.55,
        clearcoatRoughness: 0.2,
        emissive: color,
        emissiveIntensity: 0.045,
        envMapIntensity: 0.85,
      })
      stickerMaterials.set(color, material)
      this.materials.push(material)
    })

    for (let x = -1; x <= 1; x += 1) {
      for (let y = -1; y <= 1; y += 1) {
        for (let z = -1; z <= 1; z += 1) {
          const group = new THREE.Group()
          group.position.set(x * SPACING, y * SPACING, z * SPACING)
          const body = new THREE.Mesh(bodyGeometry, bodyMaterial)
          body.castShadow = true
          body.receiveShadow = true
          group.add(body)
          const edges = new THREE.LineSegments(edgeGeometry, edgeMaterial)
          group.add(edges)
          if (x === 1) this.addSticker(group, stickerGeometry, stickerMaterials.get(COLORS.right)!, 'x', 1)
          if (x === -1) this.addSticker(group, stickerGeometry, stickerMaterials.get(COLORS.left)!, 'x', -1)
          if (y === 1) this.addSticker(group, stickerGeometry, stickerMaterials.get(COLORS.top)!, 'y', 1)
          if (y === -1) this.addSticker(group, stickerGeometry, stickerMaterials.get(COLORS.bottom)!, 'y', -1)
          if (z === 1) this.addSticker(group, stickerGeometry, stickerMaterials.get(COLORS.front)!, 'z', 1)
          if (z === -1) this.addSticker(group, stickerGeometry, stickerMaterials.get(COLORS.back)!, 'z', -1)
          this.cubeRoot.add(group)
          this.cubies.push({ mesh: group, coord: new THREE.Vector3(x, y, z), home: new THREE.Vector3(x, y, z) })
        }
      }
    }
    this.cubeRoot.rotation.set(0.08, -0.12, -0.08)
    if (this.isStudio) this.cubeRoot.rotation.set(0, 0, 0)
  }

  private createRoundedPlane(size: number, radius: number) {
    const h = size / 2
    const shape = new THREE.Shape()
    shape.moveTo(-h + radius, -h)
    shape.lineTo(h - radius, -h)
    shape.quadraticCurveTo(h, -h, h, -h + radius)
    shape.lineTo(h, h - radius)
    shape.quadraticCurveTo(h, h, h - radius, h)
    shape.lineTo(-h + radius, h)
    shape.quadraticCurveTo(-h, h, -h, h - radius)
    shape.lineTo(-h, -h + radius)
    shape.quadraticCurveTo(-h, -h, -h + radius, -h)
    return new THREE.ShapeGeometry(shape, 5)
  }

  private addSticker(group: THREE.Group, geometry: THREE.ShapeGeometry, material: THREE.Material, axis: Axis, direction: number) {
    const sticker = new THREE.Mesh(geometry, material)
    const offset = 0.463
    sticker.position[axis] = offset * direction
    if (axis === 'x') sticker.rotation.y = direction > 0 ? HALF_PI : -HALF_PI
    if (axis === 'y') sticker.rotation.x = direction > 0 ? -HALF_PI : HALF_PI
    if (axis === 'z' && direction < 0) sticker.rotation.y = Math.PI
    sticker.castShadow = true
    sticker.receiveShadow = true
    sticker.userData.sticker = true
    group.add(sticker)
  }

  private setupLights() {
    const ambient = new THREE.HemisphereLight(0x8fa9ff, 0x120d2a, 0.55)
    this.scene.add(ambient)
    const key = new THREE.DirectionalLight(0xe8efff, 1.8)
    key.position.set(-3.5, 8, 7)
    key.castShadow = true
    key.shadow.mapSize.set(2048, 2048)
    key.shadow.camera.near = 0.1
    key.shadow.camera.far = 30
    key.shadow.camera.left = -7
    key.shadow.camera.right = 7
    key.shadow.camera.top = 7
    key.shadow.camera.bottom = -7
    key.shadow.bias = -0.0003
    key.shadow.normalBias = 0.025
    this.scene.add(key)
    const cyan = new THREE.PointLight(0x36bfff, 28, 16, 2)
    cyan.position.set(5, -1, 4)
    this.scene.add(cyan)
    const violet = new THREE.PointLight(0x704cff, 38, 18, 2)
    violet.position.set(-5, 1.5, -2)
    this.scene.add(violet)
    const magenta = new THREE.PointLight(0xe64eff, 18, 15, 2)
    magenta.position.set(0, -4, -3)
    this.scene.add(magenta)
  }

  private buildEnvironment() {
    if (this.isStudio) {
      const floor = new THREE.Mesh(
        new THREE.CircleGeometry(7, 96),
        new THREE.MeshStandardMaterial({ color: 0x080b18, roughness: 0.7, metalness: 0.15, transparent: true, opacity: 0.72 }),
      )
      floor.rotation.x = -HALF_PI
      floor.position.y = -2.05
      floor.receiveShadow = true
      this.scene.add(floor)
      this.geometries.push(floor.geometry)
      this.materials.push(floor.material)
      return
    }
    this.createStarField(2600, 46, 0xa9c8ff, 0.062)
    this.createStarField(720, 28, 0xf2eaff, 0.10)
    this.createGalaxy()
    this.createNebula(new THREE.Vector3(-8, 0.2, -11), 24, ['#100923', '#45287c', '#a18ade'])
    this.createNebula(new THREE.Vector3(7, 4, -16), 23, ['#07172c', '#145575', '#75c5de'])
    this.createNebula(new THREE.Vector3(2, -7, -13), 20, ['#160c26', '#502660', '#b776b5'])
    for (let i = 0; i < 7; i += 1) this.createMeteor(i)
  }

  private createStarField(count: number, radius: number, color: number, size: number) {
    const positions = new Float32Array(count * 3)
    const random = this.seeded(941 + count)
    for (let i = 0; i < count; i += 1) {
      const r = radius * (0.42 + random() * 0.58)
      const theta = random() * Math.PI * 2
      const phi = Math.acos(2 * random() - 1)
      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta)
      positions[i * 3 + 1] = r * Math.cos(phi)
      positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta)
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    const material = new THREE.PointsMaterial({ color, map: this.starTexture(), size, sizeAttenuation: true, transparent: true, opacity: 0.86, depthWrite: false, blending: THREE.AdditiveBlending })
    const points = new THREE.Points(geometry, material)
    this.scene.add(points)
    this.stars.push(points)
    this.geometries.push(geometry)
    this.materials.push(material)
  }

  private createGalaxy() {
    const count = 6800
    const positions = new Float32Array(count * 3)
    const colors = new Float32Array(count * 3)
    const random = this.seeded(4081)
    const inner = new THREE.Color(0x8fdfff)
    const outer = new THREE.Color(0x985cff)
    for (let i = 0; i < count; i += 1) {
      const radius = Math.pow(random(), 0.72) * 17
      const branch = (i % 4) / 4 * Math.PI * 2
      const spin = radius * 0.36
      const scatter = Math.pow(random(), 2.3) * (random() < 0.5 ? -1 : 1) * 2.3
      positions[i * 3] = Math.cos(branch + spin) * radius + scatter
      positions[i * 3 + 1] = (random() - 0.5) * (0.25 + radius * 0.07)
      positions[i * 3 + 2] = Math.sin(branch + spin) * radius + scatter
      const c = inner.clone().lerp(outer, radius / 17)
      colors[i * 3] = c.r
      colors[i * 3 + 1] = c.g
      colors[i * 3 + 2] = c.b
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    const material = new THREE.PointsMaterial({ map: this.starTexture(), size: 0.075, vertexColors: true, transparent: true, opacity: 0.62, depthWrite: false, blending: THREE.AdditiveBlending })
    const galaxy = new THREE.Points(geometry, material)
    galaxy.rotation.x = 1.0
    galaxy.rotation.z = -0.28
    galaxy.position.set(-1, 0, -8)
    this.scene.add(galaxy)
    this.stars.push(galaxy)
    this.geometries.push(geometry)
    this.materials.push(material)
  }

  private starTexture() {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 64
    const ctx = canvas.getContext('2d')!
    const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
    gradient.addColorStop(0, '#ffffff')
    gradient.addColorStop(0.15, '#ffffff')
    gradient.addColorStop(0.35, '#ffffff60')
    gradient.addColorStop(1, '#ffffff00')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, 64, 64)
    const texture = new THREE.CanvasTexture(canvas)
    this.textures.push(texture)
    return texture
  }

  private createNebula(position: THREE.Vector3, scale: number, colors: string[]) {
    const canvas = document.createElement('canvas')
    const size = 1024
    canvas.width = canvas.height = size
    const ctx = canvas.getContext('2d')!
    const pixels = ctx.createImageData(size, size)
    const random = this.seeded(Math.round(position.x * 79 + position.y * 113 + 5000))
    const grid = Float32Array.from({ length: 65536 }, random)
    const noise = (x: number, y: number) => {
      const ix = Math.floor(x), iy = Math.floor(y)
      let fx = x - ix, fy = y - iy
      fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy)
      const at = (a: number, b: number) => grid[(a & 255) + (b & 255) * 256]
      return THREE.MathUtils.lerp(THREE.MathUtils.lerp(at(ix, iy), at(ix + 1, iy), fx), THREE.MathUtils.lerp(at(ix, iy + 1), at(ix + 1, iy + 1), fx), fy)
    }
    const fbm = (x: number, y: number) => {
      let sum = 0, amplitude = 0.5
      for (let octave = 0; octave < 6; octave++) {
        sum += noise(x, y) * amplitude
        x = x * 2.03 + 13.7; y = y * 2.03 + 9.2; amplitude *= 0.5
      }
      return sum
    }
    const palette = colors.map((hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)))
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const u = x / size, v = y / size
        const warp = fbm(u * 3, v * 3)
        const density = fbm(u * 5 + warp * 3, v * 5 + warp * 2)
        const filament = Math.pow(Math.max(0, 1 - Math.abs(density - 0.5) * 4.5), 3)
        const envelope = Math.pow(Math.max(0, 1 - Math.hypot((u - 0.5) * 2, (v - 0.5) * 2)), 1.4)
        const band = Math.exp(-Math.pow((v - 0.5 + (u - 0.5) * 0.45 + (warp - 0.5) * 0.5) * 3.8, 2))
        const brightness = Math.min(1, density * 0.8 + filament * 0.45)
        const p = (y * size + x) * 4
        const low = brightness < 0.5 ? palette[0] : palette[1]
        const high = brightness < 0.5 ? palette[1] : palette[2]
        const t = brightness < 0.5 ? brightness * 2 : (brightness - 0.5) * 2
        for (let c = 0; c < 3; c++) pixels.data[p + c] = low[c] + (high[c] - low[c]) * t
        pixels.data[p + 3] = Math.min(255, envelope * band * (density * 0.7 + filament * 0.6) * 360)
      }
    }
    ctx.putImageData(pixels, 0, 0)
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending })
    const sprite = new THREE.Sprite(material)
    sprite.position.copy(position)
    sprite.scale.set(scale, scale, 1)
    this.scene.add(sprite)
    this.nebulae.push(sprite)
    this.textures.push(texture)
    this.materials.push(material)
  }

  private createMeteor(index: number) {
    const group = new THREE.Group()
    const trailGeometry = new THREE.CylinderGeometry(0.008, 0.065, 1, 7, 1, true)
    trailGeometry.rotateZ(HALF_PI)
    trailGeometry.translate(-0.5, 0, 0)
    const color = index % 2 ? 0x8bdcff : 0xb99cff
    const trailMaterial = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.44, blending: THREE.AdditiveBlending, depthWrite: false })
    const trail = new THREE.Mesh(trailGeometry, trailMaterial)
    trail.scale.x = 2.2 + (index % 3) * 0.8
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 3, 3), transparent: true, depthWrite: false }))
    group.add(trail, head)
    this.scene.add(group)
    this.geometries.push(trailGeometry, head.geometry)
    this.materials.push(trailMaterial, head.material as THREE.Material)
    const meteor: Meteor = { group, trail, head, velocity: new THREE.Vector3(), life: 0, maxLife: 1 }
    this.resetMeteor(meteor, index * 0.8)
    this.meteors.push(meteor)
  }

  private resetMeteor(meteor: Meteor, delay = 0) {
    const random = this.seeded(Math.floor((this.elapsed + delay + 1) * 997))
    meteor.group.position.set(-11 - random() * 7, 3 + random() * 9, -5 - random() * 12)
    meteor.velocity.set(5.5 + random() * 5, -3.2 - random() * 2.8, 0.2)
    meteor.group.rotation.z = Math.atan2(meteor.velocity.y, meteor.velocity.x)
    meteor.life = -delay
    meteor.maxLife = 2.4 + random() * 2
    meteor.group.visible = false
  }

  private beginTurn(command: CubeCommand & { undo?: boolean }) {
    const members = this.cubies.filter((cubie) => Math.round(cubie.coord[command.axis]) === command.layer)
    this.turnPivot.rotation.set(0, 0, 0)
    this.cubeRoot.updateWorldMatrix(true, true)
    members.forEach(({ mesh }) => this.turnPivot.attach(mesh))
    this.activeTurn = { command, progress: 0, members }
    this.playTurnSound()
  }

  private updateTurn(dt: number) {
    if (!this.activeTurn && this.queue.length) this.beginTurn(this.queue.shift()!)
    if (!this.activeTurn) return
    const { command, members } = this.activeTurn
    const duration = 0.32
    const previous = this.activeTurn.progress
    this.activeTurn.progress = Math.min(1, previous + dt / duration)
    const easedNow = 1 - Math.pow(1 - this.activeTurn.progress, 3)
    const easedBefore = 1 - Math.pow(1 - previous, 3)
    this.turnPivot.rotateOnAxis(this.axisVector(command.axis), command.direction * HALF_PI * (easedNow - easedBefore))
    if (this.activeTurn.progress >= 1) {
      this.turnPivot.updateMatrixWorld(true)
      const rotation = new THREE.Matrix4().makeRotationAxis(this.axisVector(command.axis), command.direction * HALF_PI)
      members.forEach((cubie) => {
        this.cubeRoot.attach(cubie.mesh)
        cubie.coord.applyMatrix4(rotation)
        cubie.coord.set(Math.round(cubie.coord.x), Math.round(cubie.coord.y), Math.round(cubie.coord.z))
        cubie.mesh.position.copy(cubie.coord).multiplyScalar(SPACING)
        this.snapQuaternion(cubie.mesh.quaternion)
      })
      this.turnPivot.rotation.set(0, 0, 0)
      this.activeTurn = null
      if (command.undo) this.history.pop()
      else this.history.push({ axis: command.axis, layer: command.layer, direction: command.direction })
      this.moveCount = this.history.length
      this.lastMove = moveLabel(command)
      this.options.onMove?.(this.moveCount)
      this.options.onStatus?.(this.queue.length ? '层级旋转执行中' : this.isSolved() ? '六面已归位' : '等待下一步')
      this.notifyActivity()
    }
  }

  private axisVector(axis: Axis) {
    return axis === 'x' ? new THREE.Vector3(1, 0, 0) : axis === 'y' ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1)
  }

  private snapQuaternion(quaternion: THREE.Quaternion) {
    // Cube orientations are signed permutation matrices; snap basis vectors directly.
    const matrix = new THREE.Matrix4().makeRotationFromQuaternion(quaternion)
    matrix.elements.forEach((value, i) => { matrix.elements[i] = Math.round(value) })
    quaternion.setFromRotationMatrix(matrix).normalize()
  }

  private playTurnSound() {
    if (!this.soundOn || this.isTest) return
    try {
      const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      const context = this.audioContext ??= new AudioContextClass()
      if (context.state === 'suspended') void context.resume()
      const oscillator = context.createOscillator()
      const gain = context.createGain()
      oscillator.type = 'triangle'
      oscillator.frequency.setValueAtTime(96, context.currentTime)
      oscillator.frequency.exponentialRampToValueAtTime(54, context.currentTime + 0.075)
      gain.gain.setValueAtTime(0.045, context.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.09)
      oscillator.connect(gain).connect(context.destination)
      oscillator.start()
      oscillator.stop(context.currentTime + 0.1)
      oscillator.addEventListener('ended', () => { oscillator.disconnect(); gain.disconnect() })
    } catch { /* audio is a progressive enhancement */ }
  }

  private animate = () => {
    if (this.disposed) return
    this.raf = requestAnimationFrame(this.animate)
    this.update(Math.min(this.clock.getDelta(), 0.05))
    this.render()
  }

  private update(dt: number) {
    this.elapsed += dt
    this.updateTurn(dt)
    if (this.autoRotate && !this.isStudio && !this.activeTurn && !this.interacting && this.elapsed > this.resumeOrbitAt) {
      this.cubeRoot.rotation.y += dt * 0.055
      this.cubeRoot.rotation.x = 0.08 + Math.sin(this.elapsed * 0.18) * 0.035
    }
    this.stars.forEach((stars, index) => { stars.rotation.y += dt * (index === 2 ? -0.008 : 0.0025 * (index + 1)) })
    this.nebulae.forEach((sprite, index) => { sprite.material.rotation += dt * (index % 2 ? -0.006 : 0.004) })
    this.meteors.forEach((meteor, index) => {
      meteor.life += dt
      if (meteor.life < 0) return
      meteor.group.visible = true
      meteor.group.position.addScaledVector(meteor.velocity, dt)
      const fade = Math.min(1, meteor.life * 3) * Math.max(0, 1 - meteor.life / meteor.maxLife)
      ;(meteor.trail.material as THREE.MeshBasicMaterial).opacity = fade * 0.46
      ;(meteor.head.material as THREE.MeshBasicMaterial).opacity = fade
      if (meteor.life > meteor.maxLife) this.resetMeteor(meteor, 0.8 + index * 0.17)
    })
    this.controls.update()
  }

  private render() { this.composer.render() }

  private getState() {
    return {
      ready: window.__READY__,
      mode: this.isStudio ? `studio:${this.view}` : 'experience',
      elapsedSeconds: Number(this.elapsed.toFixed(3)),
      cube: {
        cubies: this.cubies.length,
        moveCount: this.moveCount,
        queuedMoves: this.queue.length,
        turnActive: Boolean(this.activeTurn),
        rotation: [this.cubeRoot.rotation.x, this.cubeRoot.rotation.y, this.cubeRoot.rotation.z].map((n) => Number(n.toFixed(4))),
        coordinatesValid: this.cubies.every((c) => ['x', 'y', 'z'].every((axis) => Number.isInteger(c.coord[axis as Axis]))),
        uniquePositions: new Set(this.cubies.map((c) => c.coord.toArray().join(','))).size,
        activeMembers: this.activeTurn?.members.length ?? 0,
        solved: this.isSolved(),
        autoRotate: this.autoRotate,
        soundOn: this.soundOn,
        signature: this.cubies.map(({ mesh, coord }) => [...coord.toArray(), ...new THREE.Matrix4().makeRotationFromQuaternion(mesh.quaternion).elements.map((n) => Math.round(n * 1000) / 1000)]),
      },
      environment: { stars: this.stars.length, nebulae: this.nebulae.length, meteors: this.meteors.length, reflection: Boolean(this.scene.environment), textureResolution: 1024, shadows: this.renderer.shadowMap.enabled },
      resources: this.renderer.info.memory,
      camera: this.camera.position.toArray().map((n) => Number(n.toFixed(3))),
      error: window.__LAST_ERROR__,
    }
  }

  private setStudioCamera() {
    const positions: Record<string, THREE.Vector3> = {
      front: new THREE.Vector3(0, 0.2, 10),
      rear: new THREE.Vector3(0, 0.2, -10),
      side: new THREE.Vector3(10, 0.2, 0),
      top: new THREE.Vector3(0, 10, 0.001),
    }
    this.camera.position.copy(positions[this.view] || positions.front)
    this.camera.lookAt(0, 0, 0)
  }

  private resize() {
    if (this.disposed) return
    const width = Math.max(this.host.clientWidth, 1)
    const height = Math.max(this.host.clientHeight, 1)
    const aspect = width / height
    if (this.camera instanceof THREE.PerspectiveCamera) {
      this.camera.aspect = aspect
      this.camera.fov = aspect < 0.8 ? 53 : aspect < 1.15 ? 44 : 37
      // Reserve the lower portion for touch controls on narrow screens.
      this.camera.setViewOffset(width, height, 0, aspect < 0.8 ? height * 0.13 : 0, width, height)
      this.camera.updateProjectionMatrix()
    } else {
      const size = 3.7
      this.camera.left = -size * aspect
      this.camera.right = size * aspect
      this.camera.top = size
      this.camera.bottom = -size
      this.camera.updateProjectionMatrix()
    }
    const pixelRatio = Math.min(devicePixelRatio, width < 600 ? 1.5 : 1.8)
    this.renderer.setPixelRatio(pixelRatio)
    this.composer.setPixelRatio(pixelRatio)
    this.renderer.setSize(width, height, false)
    this.composer.setSize(width, height)
    this.render()
  }

  private seeded(seed: number) {
    let value = seed >>> 0
    return () => {
      value += 0x6d2b79f5
      let t = value
      t = Math.imul(t ^ (t >>> 15), t | 1)
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }

  dispose() {
    this.disposed = true
    cancelAnimationFrame(this.raf)
    this.resizeObserver.disconnect()
    this.controls.dispose()
    this.controls.removeEventListener('start', this.onControlStart)
    this.controls.removeEventListener('end', this.onControlEnd)
    for (const pass of this.composer.passes) pass.dispose()
    this.composer.dispose()
    this.environmentTarget.dispose()
    this.scene.traverse((object) => { if (object instanceof THREE.Light && 'shadow' in object) (object as THREE.DirectionalLight).shadow?.dispose() })
    this.renderer.dispose()
    this.geometries.forEach((geometry) => geometry.dispose())
    this.materials.forEach((material) => material.dispose())
    this.textures.forEach((texture) => texture.dispose())
    if (this.audioContext) void this.audioContext.close()
    window.__READY__ = false
    this.host.replaceChildren()
    document.documentElement.classList.remove('studio-mode')
  }
}

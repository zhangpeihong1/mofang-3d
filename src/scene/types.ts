import type * as THREE from 'three'

export type Axis = 'x' | 'y' | 'z'
export type CubeCommand = { axis: Axis; layer: -1 | 0 | 1; direction: -1 | 1 }
export type Cubie = { mesh: THREE.Group; coord: THREE.Vector3; home: THREE.Vector3 }
export type CubeActivity = { busy: boolean; solved: boolean; canUndo: boolean; lastMove: string }
export type ExperienceOptions = {
  onMove?: (count: number) => void
  onStatus?: (text: string) => void
  onActivity?: (activity: CubeActivity) => void
}

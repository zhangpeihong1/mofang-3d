import type { CubeCommand } from './types'

// Clockwise as seen looking directly at the named face (standard cube notation).
export const MOVES: Array<{ label: string; name: string; command: CubeCommand }> = [
  { label: 'U', name: '上层', command: { axis: 'y', layer: 1, direction: -1 } },
  { label: 'D', name: '下层', command: { axis: 'y', layer: -1, direction: 1 } },
  { label: 'L', name: '左层', command: { axis: 'x', layer: -1, direction: 1 } },
  { label: 'R', name: '右层', command: { axis: 'x', layer: 1, direction: -1 } },
  { label: 'F', name: '前层', command: { axis: 'z', layer: 1, direction: -1 } },
  { label: 'B', name: '后层', command: { axis: 'z', layer: -1, direction: 1 } },
  { label: 'M', name: '中层 · X', command: { axis: 'x', layer: 0, direction: 1 } },
  { label: 'E', name: '中层 · Y', command: { axis: 'y', layer: 0, direction: 1 } },
  { label: 'S', name: '中层 · Z', command: { axis: 'z', layer: 0, direction: -1 } },
]

export function moveLabel(command: CubeCommand) {
  const move = MOVES.find(({ command: c }) => c.axis === command.axis && c.layer === command.layer)!
  return move.label + (move.command.direction === command.direction ? '' : '′')
}

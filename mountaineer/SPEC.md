# Mountaineer (登山家) - Game Spec

## Overview
2-player abstract strategy stacking game. Players alternate moving their colored pieces on a 2x5 grid island, stacking onto adjacent occupied cells. Win by having your piece on top when all 10 pieces merge into one stack.

## Components
- 5 green pieces (Player 1)
- 5 blue pieces (Player 2)
- 2x5 grid board (10 cells)

## Setup
1. Shuffle all 10 pieces randomly
2. Place face-up in a 2x5 grid (2 rows, 5 columns)
3. Green moves first

## Rules

### Movement
- On your turn, select one of your **topmost** pieces (not covered by another piece)
- Move it 1 step in any orthogonal direction (up/down/left/right)
- Destination **must** already have at least one piece (no moving to empty cells)
- The moving piece is placed **on top** of the destination stack

### Constraints (both must hold after the move)
1. **Adjacency**: The moved piece must share an edge with at least one other piece on the board
2. **Connectivity**: All occupied cells must form a single connected island (no splitting)

### Turn Order
- Green moves first, then Blue, alternating
- Only the topmost piece at any position can be selected and moved
- Covered pieces cannot be moved

### Winning
- When all 10 pieces are stacked in one cell, the **topmost piece** determines the winner
- The player whose color is on top wins

## Data Structure

```js
state = {
  board: { "r,c": ["G","B","G",...], ... },  // cell -> stack of pieces (index 0 = bottom)
  turn: 'G' | 'B',
  selected: null | { r, c },
  phase: 'landing' | 'playing' | 'game-over',
  winner: null | 'G' | 'B',
  history: [prevStates...],
  lastMove: null | { from: {r,c}, to: {r,c} }
}
```

## Grid Coordinates
- Row 0 = top row, Row 1 = bottom row
- Col 0 = left, Col 4 = right
- 4 neighbors: (r-1,c), (r+1,c), (r,c-1), (r,c+1)

## UI Layout (mobile-first)

```
+---------------------------+
|     登 山 家               |
|  Green's Turn  (3 left)   |
+---------------------------+
|                           |
|   [c0] [c1] [c2] [c3] [c4]|  Row 0
|   [c0] [c1] [c2] [c3] [c4]|  Row 1
|                           |
|      [←] [↑] [↓] [→]     |  (when selected)
|      [Cancel]             |
+---------------------------+
|  G: 3 left   B: 2 left    |
+---------------------------+
|  [Undo]  [Restart]  [?]   |
+---------------------------+
```

## Key Algorithms

### Move Validation
1. Source cell has pieces and top piece matches current player
2. Destination is within bounds and has pieces
3. After simulated move: BFS from any occupied cell visits all occupied cells (connectivity)

### Win Check
- Count total pieces across all cells; if any cell has 10 pieces, game over

## Interactions
- Tap cell with your top piece -> select (gold highlight)
- Tap valid adjacent cell with pieces -> move piece there
- Tap direction button (when selected) -> move in that direction
- Tap other own piece -> re-select
- Tap elsewhere / Cancel -> deselect
- No valid moves -> show Pass button

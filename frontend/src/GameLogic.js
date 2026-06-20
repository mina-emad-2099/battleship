// frontend/src/gameLogic.js

// Generates a clean 10x10 matrix
export const createEmptyBoard = () => Array(10).fill(null).map(() => Array(10).fill(0));

// Core Algorithm: Validates if a ship can fit without going out of bounds or overlapping
export const canPlaceShip = (board, startX, startY, shipSize, isHorizontal) => {
    if (isHorizontal) {
        // Boundary check: Does it hang off the right edge?
        if (startY + shipSize > 10) return false;

        // Overlap check: Scan the intended path
        for (let y = 0; y < shipSize; y++) {
            if (board[startX][startY + y] !== 0) return false; // Collision detected
        }
    } else { // Vertical
        // Boundary check: Does it hang off the bottom edge?
        if (startX + shipSize > 10) return false;

        // Overlap check: Scan the intended path
        for (let x = 0; x < shipSize; x++) {
            if (board[startX + x][startY] !== 0) return false; // Collision detected
        }
    }
    return true; // The path is clear
};
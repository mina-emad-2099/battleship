// frontend/src/components/Board.jsx
import { Fragment } from 'react';

// Maps the numeric cell state used throughout the app to a CSS class (defined
// in App.css) and an optional icon. Keep this in sync with the cell values
// written by App.jsx / the server: 0 = water, 1 = ship, 2 = miss, 3 = hit.
const CELL_DISPLAY = {
    0: { className: 'water', icon: null },
    1: { className: 'ship', icon: null },
    2: { className: 'miss', icon: null }, // ring drawn in CSS via ::after
    3: { className: 'hit', icon: '✕' },
};

const COLUMN_LABELS = Array.from({ length: 10 }, (_, i) => i + 1);
const ROW_LABELS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];

export default function Board({ matrix, onCellClick, variant = 'own', isScanning = false }) {
    const handleActivate = (x, y) => onCellClick(x, y);

    return (
        <div className="board-frame">
            <div className="board">
                <div className="coord-label" aria-hidden="true" />
                {COLUMN_LABELS.map((n) => (
                    <div className="coord-label" key={`col-${n}`} aria-hidden="true">{n}</div>
                ))}

                {matrix.map((row, x) => (
                    <Fragment key={`row-${x}`}>
                        <div className="coord-label" aria-hidden="true">{ROW_LABELS[x]}</div>
                        {row.map((cellValue, y) => {
                            const { className, icon } = CELL_DISPLAY[cellValue] ?? CELL_DISPLAY[0];
                            return (
                                <div
                                    key={`${x}-${y}`}
                                    className={`cell ${className}`}
                                    role="button"
                                    tabIndex={0}
                                    aria-label={`${ROW_LABELS[x]}${y + 1}`}
                                    onClick={() => handleActivate(x, y)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' || e.key === ' ') {
                                            e.preventDefault();
                                            handleActivate(x, y);
                                        }
                                    }}
                                >
                                    {icon}
                                </div>
                            );
                        })}
                    </Fragment>
                ))}
            </div>

            {variant === 'enemy' && (
                <div className={`radar-sweep ${isScanning ? 'active' : ''}`} aria-hidden="true" />
            )}
        </div>
    );
}
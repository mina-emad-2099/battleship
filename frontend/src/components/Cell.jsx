// frontend/src/components/Cell.jsx
export default function Cell({ x, y, value, onClick }) {
    // Map our integer state to the CSS classes we just wrote
    // 0 = water, 1 = ship, 2 = miss, 3 = hit
    const stateMapping = {
        0: "water",
        1: "ship",
        2: "miss",
        3: "hit"
    };

    const statusClass = stateMapping[value];

    return (
        <div 
            className={`cell ${statusClass}`}
            onClick={() => onClick(x, y)}
        >
            {value === 3 ? "💥" : value === 2 ? "🌊" : ""}
        </div>
    );
}
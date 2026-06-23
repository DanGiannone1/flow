"use client";

function DataCell({ value, column }: { value: string; column: string }) {
  const lowerVal = value.toLowerCase();
  const lowerCol = column.toLowerCase();

  // Priority Chips
  if (lowerCol.includes("priority") || lowerCol === "tag") {
    let type: "high" | "med" | "low" = "med";
    if (lowerVal.includes("high") || lowerVal === "m" || lowerVal.includes("mandatory")) type = "high";
    if (lowerVal.includes("low") || lowerVal === "i" || lowerVal.includes("info")) type = "low";
    return <span className={`cell-pill cell-pill-${type}`}>{value}</span>;
  }

  // Status Chips
  if (lowerCol.includes("status")) {
    let type: "high" | "med" | "low" = "med";
    if (lowerVal === "met" || lowerVal === "done" || lowerVal === "go") type = "low"; // Using low color (green) for success
    if (lowerVal === "not met" || lowerVal === "no go") type = "high"; // Red
    return <span className={`cell-pill cell-pill-${type}`}>{value}</span>;
  }

  // Scores with Horizontal Bars
  if (lowerCol.includes("score") || lowerCol.includes("weight")) {
    const num = parseFloat(value);
    if (!isNaN(num)) {
      const percent = Math.min(Math.max((num / 5) * 100, 5), 100); // Assume 0-5 scale
      return (
        <div className="relative w-full py-1">
          <div className="cell-bar-bg" style={{ transform: `scaleX(${percent / 100})` }} />
          <span className="relative z-10 font-mono font-bold text-text-primary">{value}</span>
        </div>
      );
    }
  }

  return <span className="text-text-secondary">{value}</span>;
}

export default function CsvTable({ content }: { content: string }) {
  const rows = content.trim().split("\n").map((line) => {
    const cells: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { inQuotes = !inQuotes; continue; }
      if (ch === "," && !inQuotes) { cells.push(current.trim()); current = ""; continue; }
      current += ch;
    }
    cells.push(current.trim());
    return cells;
  });
  if (rows.length === 0) return <pre className="text-xs text-text-muted">Empty CSV</pre>;
  const [header, ...body] = rows;
  return (
    <div className="table-wrapper">
      <table className="w-full border-separate border-spacing-0">
        <thead>
          <tr>
            {header.map((cell, i) => (
              <th key={i}>{cell}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row, ri) => (
            <tr key={ri} className="group">
              {row.map((cell, ci) => (
                <td key={ci}>
                  <DataCell value={cell} column={header[ci]} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

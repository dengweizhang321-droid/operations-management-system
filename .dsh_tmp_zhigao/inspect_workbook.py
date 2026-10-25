import sys
from openpyxl import load_workbook

path = sys.argv[1]
wb = load_workbook(path, data_only=False)
print("SHEETS:", wb.sheetnames)
for ws in wb.worksheets:
    print("=" * 80)
    print(f"SHEET: {ws.title!r} dims={ws.dimensions} max_row={ws.max_row} max_col={ws.max_column}")
    print("  tables:", {k: v.ref for k, v in getattr(ws, "tables", {}).items()})
    print("  merged:", [str(r) for r in ws.merged_cells.ranges][:40])
    print("  charts:", len(getattr(ws, "_charts", [])), "images:", len(getattr(ws, "_images", [])))
    print("  freeze:", ws.freeze_panes)
    # print first 30 rows x first 20 cols
    for r in range(1, min(ws.max_row, 30) + 1):
        vals = []
        for c in range(1, min(ws.max_column, 20) + 1):
            cell = ws.cell(row=r, column=c)
            v = cell.value
            if v is None:
                continue
            vals.append(f"{cell.coordinate}={v!r}")
        if vals:
            print(f"   R{r}: " + " | ".join(vals))

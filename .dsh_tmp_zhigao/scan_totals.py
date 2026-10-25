import sys
from openpyxl import load_workbook
from openpyxl.utils import column_index_from_string, get_column_letter

wb = load_workbook(sys.argv[1], data_only=True)
ws = wb["类目销售情况"]
cols = [get_column_letter(c) for c in range(column_index_from_string("DL"), column_index_from_string("KD") + 1)]
print(f"{'col':<4}{'header':<24}{'sumRows':>16}{'less8_9_14':>16}{'total69':>16}{'residual':>14}")
for col in cols:
    ci = column_index_from_string(col)
    h = ws.cell(row=3, column=ci).value
    vals = {r: ws.cell(row=r, column=ci).value for r in range(5, 69)}
    s = sum(v for v in vals.values() if isinstance(v, (int, float)))
    sub = sum(vals[r] for r in (8, 9, 14) if isinstance(vals[r], (int, float)))
    tot = ws.cell(row=69, column=ci).value
    tot = tot if isinstance(tot, (int, float)) else 0
    print(f"{col:<4}{str(h):<24}{s:>16,.2f}{s-sub:>16,.2f}{tot:>16,.2f}{s-sub-tot:>14,.2f}")

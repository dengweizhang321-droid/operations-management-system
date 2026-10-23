import sys, os, datetime
from openpyxl import load_workbook

xlsx = sys.argv[1]
wb = load_workbook(xlsx, data_only=False)
print("sheets:", wb.sheetnames)
print("defined names:", list(wb.defined_names.keys())[:20] if hasattr(wb.defined_names, "keys") else wb.defined_names)
for ws in wb.worksheets:
    print(f"--- {ws.title}: dims={ws.dimensions} max_row={ws.max_row} max_col={ws.max_column}")
    print(f"    charts={len(getattr(ws, '_charts', []))} images={len(getattr(ws, '_images', []))} "
          f"cf={len(ws.conditional_formatting._cf_rules) if ws.conditional_formatting else 0} "
          f"dv={len(ws.data_validations.dataValidation)} autofilter={ws.auto_filter.ref} "
          f"merged={len(ws.merged_cells.ranges)} freeze={ws.freeze_panes} tables={list(getattr(ws,'tables',{}).keys())}")
    print(f"    pane/views: {ws.sheet_view.zoomScale} tabColor={ws.sheet_properties.tabColor}")
print("calc props:", wb.calculation.fullCalcOnLoad, wb.calculation.calcId, wb.calculation.calcMode)
print("mtime:", datetime.datetime.fromtimestamp(os.path.getmtime(xlsx)), "size:", os.path.getsize(xlsx))
print("lock:", os.path.exists(os.path.join(os.path.dirname(xlsx), "~$" + os.path.basename(xlsx))))
# external links
import zipfile
with zipfile.ZipFile(xlsx) as z:
    ext = [n for n in z.namelist() if "externalLink" in n]
print("external link parts:", ext)

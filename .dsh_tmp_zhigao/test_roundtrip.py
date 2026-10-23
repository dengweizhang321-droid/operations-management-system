import sys, zipfile, shutil, os
from openpyxl import load_workbook

src = sys.argv[1]
dst = sys.argv[2]
shutil.copy2(src, dst)

with zipfile.ZipFile(src) as z:
    before = sorted(z.namelist())
wb = load_workbook(dst, data_only=False)
ws = wb["类目销售情况"]
print("KA5 formula before save:", ws["KA5"].value)
wb.save(dst)
with zipfile.ZipFile(dst) as z:
    after = sorted(z.namelist())
print("parts only in original:", [p for p in before if p not in after])
print("parts only in saved   :", [p for p in after if p not in before])
wb2 = load_workbook(dst, data_only=False)
ws2 = wb2["类目销售情况"]
print("KA5 formula after save:", ws2["KA5"].value)
print("sheets after save:", wb2.sheetnames)
print("sizes:", os.path.getsize(src), os.path.getsize(dst))
from openpyxl.utils import column_index_from_string
import datetime
for col in ["JW", "KA", "KB", "KC", "KD"]:
    ci = column_index_from_string(col)
    print(col, [ws2.cell(row=r, column=ci).value for r in (5, 69)])

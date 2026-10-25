import sys, zipfile
from lxml import etree
from openpyxl import load_workbook
from openpyxl.utils import column_index_from_string

a, b = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(a) as za, zipfile.ZipFile(b) as zb:
    ia, ib = {i.filename: i for i in za.infolist()}, {i.filename: i for i in zb.infolist()}
    print("parts only in original:", sorted(set(ia) - set(ib)))
    print("parts only in patched :", sorted(set(ib) - set(ia)))
    print(f"{'part':<48}{'orig':>12}{'patch':>12}{'same?':>7}")
    for n in sorted(set(ia) & set(ib)):
        same = za.read(n) == zb.read(n)
        print(f"{n:<48}{ia[n].file_size:>12}{ib[n].file_size:>12}{'yes' if same else 'DIFF':>7}")
    print("testzip patched:", zb.testzip())

print("--- xml well-formed check")
with zipfile.ZipFile(b) as zb:
    for n in zb.namelist():
        if n.endswith(".xml") or n.endswith(".rels"):
            try:
                etree.fromstring(zb.read(n))
            except Exception as e:
                print("  XML ERROR", n, e)
print("  ok")

print("--- openpyxl verify")
wb = load_workbook(b, data_only=False)
print("sheets:", wb.sheetnames)
ws = wb["类目销售情况"]
for r in range(5, 70):
    lab = ws.cell(row=r, column=1).value
    kb = ws.cell(row=r, column=column_index_from_string("KB")).value
    ka = ws.cell(row=r, column=column_index_from_string("KA")).value
    kd = ws.cell(row=r, column=column_index_from_string("KD")).value
    print(f"  r{r:<3}{str(lab):<16} KA={ka!r:<16} KB={kb!r:<16} KD={'formula' if isinstance(kd, str) and str(kd).startswith('=') else kd!r}")

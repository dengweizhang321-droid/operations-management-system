import sys, zipfile
from openpyxl import load_workbook
from openpyxl.utils import get_column_letter

for path in sys.argv[1:]:
    print("=" * 70)
    print(path)
    with zipfile.ZipFile(path) as z:
        names = z.namelist()
        for n in names:
            if "externalLink" in n or "pivot" in n or n.endswith(".xml.rels"):
                print("   part:", n, z.getinfo(n).file_size)
    wb = load_workbook(path, data_only=False)
    ext = []
    for ws in wb.worksheets:
        for row in ws.iter_rows():
            for c in row:
                if isinstance(c.value, str) and c.value.startswith("=") and "[" in c.value:
                    ext.append((ws.title, c.coordinate, c.value[:70]))
    print("   formulas with external refs:", len(ext))
    for e in ext[:5]:
        print("      ", e)
    print("   sheets:", wb.sheetnames)

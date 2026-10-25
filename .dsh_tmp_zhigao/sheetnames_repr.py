import sys
from openpyxl import load_workbook
wb = load_workbook(sys.argv[1], read_only=True)
for n in wb.sheetnames:
    print(repr(n), [hex(ord(c)) for c in n])
wb.close()

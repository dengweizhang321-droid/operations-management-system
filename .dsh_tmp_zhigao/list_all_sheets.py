import sys, zipfile, re, os, glob

roots = sys.argv[1:]
files = []
for root in roots:
    for dirpath, dirnames, filenames in os.walk(root):
        for fn in filenames:
            if fn.lower().endswith((".xlsx", ".xlsm")) and not fn.startswith("~$"):
                files.append(os.path.join(dirpath, fn))

for path in sorted(files):
    try:
        with zipfile.ZipFile(path) as z:
            xml = z.read("xl/workbook.xml").decode("utf-8", "replace")
        names = re.findall(r'<sheet[^>]*name="([^"]*)"', xml)
        print(f"{os.path.basename(path)}  [{os.path.getsize(path)/1e6:.1f}MB]")
        print(f"    {names}")
    except Exception as e:
        print(f"{os.path.basename(path)}  ERROR {e}")

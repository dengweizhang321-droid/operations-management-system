import sys, zipfile, re

xlsx = sys.argv[1]
with zipfile.ZipFile(xlsx) as z:
    print([n for n in z.namelist() if n.startswith("xl/worksheets/")])
    xml = z.read("xl/worksheets/sheet1.xml").decode("utf-8")
print("len:", len(xml))
print("head:", xml[:600])
for r in (5, 8, 19, 38, 68, 69):
    m = re.search(r'<row r="%d"[^>]*>(.*?)</row>' % r, xml, re.S)
    if not m:
        print(f"row {r}: NOT FOUND")
        continue
    body = m.group(1)
    cells = re.findall(r'<c r="(K[ABCD])(\d+)"([^>]*?)(?:/>|>(.*?)</c>)', body, re.S)
    print(f"--- row {r} (row tag: {xml[m.start():m.start()+80]!r})")
    for c in cells:
        print("     ", c)
    # show last 400 chars of the row body
    print("      tail:", body[-500:])

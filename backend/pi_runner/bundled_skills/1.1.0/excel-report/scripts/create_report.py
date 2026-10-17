"""Small dependency-free XLSX writer. No macros, external links or formulas."""
import json
from pathlib import Path
import sys
import zipfile
from xml.sax.saxutils import escape

data = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
columns, rows = data["columns"], data["rows"]
if not isinstance(columns, list) or not 1 <= len(columns) <= 50 or len(set(columns)) != len(columns) or len(rows) > 10000:
    raise ValueError("report_shape")
for name in ["sources", "metricDefinitions", "missingData"]:
    if not isinstance(data[name], list) or not data[name] or any(not isinstance(x, str) or not x for x in data[name]):
        raise ValueError("report_evidence_required")
tables = [("分析结果", [columns] + [[row.get(c) for c in columns] for row in rows]),
          ("来源", [[x] for x in data["sources"]]), ("指标口径", [[x] for x in data["metricDefinitions"]]),
          ("缺失数据", [[x] for x in data["missingData"]])]
ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
with zipfile.ZipFile(sys.argv[2], "w", zipfile.ZIP_DEFLATED) as book:
    book.writestr('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' + ''.join(f'<Override PartName="/xl/worksheets/sheet{i}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' for i in range(1, 5)) + '</Types>')
    book.writestr('_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>')
    book.writestr('xl/workbook.xml', f'<workbook xmlns="{ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' + ''.join(f'<sheet name="{name}" sheetId="{i}" r:id="rId{i}"/>' for i, (name, _) in enumerate(tables, 1)) + '</sheets></workbook>')
    book.writestr('xl/_rels/workbook.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + ''.join(f'<Relationship Id="rId{i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet{i}.xml"/>' for i in range(1, 5)) + '</Relationships>')
    for i, (_, table) in enumerate(tables, 1):
        xml = f'<worksheet xmlns="{ns}"><sheetData>'
        for row in table:
            xml += '<row>'
            for cell in row:
                # Inline strings ensure =,+,-,@ and URLs stay passive text.
                xml += '<c t="inlineStr"><is><t xml:space="preserve">' + escape('' if cell is None else str(cell)) + '</t></is></c>'
            xml += '</row>'
        book.writestr(f'xl/worksheets/sheet{i}.xml', xml + '</sheetData></worksheet>')

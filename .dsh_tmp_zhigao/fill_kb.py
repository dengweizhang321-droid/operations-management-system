"""Fill the 25年同期（10.12-10.18）column (KB) of 志高项目周报2026.10.19.xlsx.

Source : 25年10月销售单明细账.xlsx -> sheet 'sheetTitle' (吉客云销售单明细账)
Filter : 发货时间(date) 2025-10-12..2025-10-18, 渠道大类 in 天猫/京东/拼多多/抖店
Measure: sum(分摊后金额) grouped by 货品细分 (直饮机 sub-rows from sheet 'Sheet3' 直饮机分类)
Edit   : surgical XML replacement of the existing empty <c r="KB{r}" s="47"/> cells,
         so every other part of the workbook stays byte-identical.
"""
import sys, os, re, shutil, zipfile

SRC = r"E:\微软文件\OneDrive\桌面\志高项目月度会议\2025年月度会议\25年10月\25年10月销售单明细账.xlsx"
TARGET = sys.argv[1]
MODE = sys.argv[2] if len(sys.argv) > 2 else "dry"

# row -> (label, source-kind, key)   kind: 'seg' = 货品细分, 'cls' = 直饮机分类
ROWS = {
    5: ("普通直饮机", "seg", "普通直饮机"),
    6: ("步进式直饮机", "seg", "步进式直饮机"),
    7: ("轻商务直饮机", "seg", "轻商务直饮机"),
    8: ("桌面直饮机", "cls", "桌面直饮机"),
    9: ("幼儿园机", "cls", "幼儿园机"),
    10: ("数显开水器", "seg", "数显开水器"),
    11: ("数控开水器", "seg", "数控开水器"),
    12: ("水尺开水器", "seg", "水尺开水器"),
    13: ("步进式开水器", "seg", "步进式开水器"),
    14: ("厨下开水器", "cls", "厨下开水器"),
    15: ("蒸煮桶", "seg", "蒸煮桶"),
    16: ("开水桶", "seg", "开水桶"),
    17: ("吧台机", "seg", "吧台机"),
    18: ("台式切片机", "seg", "台式切片机"),
    20: ("GJ807/817/827", "seg", "807/817/827"),
    21: ("GJ806/816", "seg", "806/816"),
    22: ("绞切一体机", "seg", "绞切一体机"),
    23: ("全自动切片机", "seg", "全自动切片机"),
    24: ("半自动切片机", "seg", "半自动切片机"),
    25: ("锯骨机", "seg", "锯骨机"),
    26: ("手动切片机", "seg", "手动切片机"),
    27: ("手动切骨机", "seg", "手动切骨机"),
    28: ("518切片机", "seg", "518切片机"),
    30: ("GJ801", "seg", "801"),
    31: ("GJ802", "seg", "802"),
    32: ("GJ811/813", "seg", "811/813"),
    34: ("GJ803", "seg", "803"),
    35: ("GJ821/823", "seg", "821/823"),
    36: ("GJ805", "seg", "805"),
    37: ("GJ810", "seg", "810"),
    39: ("切菜机", "seg", "切菜机"),
    40: ("瓜果切片切丝机", "seg", "瓜果切片切丝机"),
    43: ("炒菜机", "seg", "炒菜机"),
    46: ("净水器", "seg", "净水器"),
    49: ("工作台", "seg", "工作台"),
    50: ("展示柜", "seg", "展示柜"),
    51: ("电磁大锅灶", "seg", "电磁大锅灶"),
    52: ("超声波洗碗机", "seg", "超声波洗碗机"),
    53: ("揭盖洗碗机", "seg", "揭盖洗碗机"),
    55: ("节能灶", "seg", "节能灶"),
    58: ("家用消毒柜", "seg", "家用消毒柜"),
    59: ("中温消毒柜", "seg", "中温消毒柜"),
    60: ("高温消毒柜", "seg", "高温消毒柜"),
    64: ("肠粉机", "seg", "肠粉机"),
    65: ("肠粉机蒸汽炉", "seg", "肠粉机蒸汽炉"),
    66: ("电磁炉", "seg", "电磁炉"),
    67: ("粉碎机", "seg", "粉碎机"),
    68: ("双炉", "seg", "双炉"),
}


def compute():
    import pandas as pd
    CH4 = ["天猫", "京东", "拼多多", "抖店"]
    A, B = "2025-10-12", "2025-10-18"
    df = pd.read_excel(SRC, sheet_name="sheetTitle", engine="openpyxl")
    df["发货日期"] = df["发货时间.1"].astype(str).str.slice(0, 10)
    df["渠道大类"] = df["销售渠道"].astype(str).str.split("-").str[0]
    w = df[(df["发货日期"] >= A) & (df["发货日期"] <= B)]
    w = w[w["渠道大类"].isin(CH4)]
    seg = w.groupby("货品细分")["分摊后金额"].sum()
    dz = pd.read_excel(SRC, sheet_name="Sheet3", engine="openpyxl")
    dz["发货日期"] = dz["发货时间"].astype(str).str.slice(0, 10)
    dz["渠道大类"] = dz["销售渠道"].astype(str).str.split("-").str[0]
    wz = dz[(dz["发货日期"] >= A) & (dz["发货日期"] <= B)]
    wz = wz[wz["渠道大类"].isin(CH4)]
    cls = wz.groupby("直饮机分类")["分摊后金额"].sum()
    values = {}
    for r, (label, kind, key) in ROWS.items():
        src = seg if kind == "seg" else cls
        if key in src.index:
            values[r] = round(float(src[key]), 2)
    return values, w


def set_cell(xml, row, inner):
    pat = re.compile(r'<c r="KB%d"([^>]*?)/>' % row)
    repl = r'<c r="KB%d"\1>%s</c>' % (row, inner)
    new, n = pat.subn(repl, xml)
    if n != 1:
        raise SystemExit(f"row {row}: expected exactly 1 empty KB cell, found {n}")
    return new


def main():
    values, w = compute()
    total = round(sum(values.values()), 2)
    print(f"rows to fill: {len(values)}  total: {total:,.2f}  source rows(4CH): {len(w)}")
    for r in sorted(values):
        print(f"   KB{r} = {values[r]:,.2f}   ({ROWS[r][0]})")

    with zipfile.ZipFile(TARGET) as z:
        parts = {i.filename: z.read(i.filename) for i in z.infolist()}
        infos = z.infolist()
    xml = parts["xl/worksheets/sheet1.xml"].decode("utf-8")
    for r, v in values.items():
        xml = set_cell(xml, r, f"<v>{v}</v>")
    xml = set_cell(xml, 69, f"<f>SUM(KB5:KB68)</f><v>{total}</v>")
    parts["xl/worksheets/sheet1.xml"] = xml.encode("utf-8")

    out = TARGET if MODE == "apply" else TARGET.replace(".xlsx", "_patched.xlsx")
    if MODE == "apply":
        backup = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                              "backup_" + os.path.basename(TARGET))
        shutil.copy2(TARGET, backup)
        print("backup:", backup)
    tmp = out + ".tmp"
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as z:
        for i in infos:
            zi = zipfile.ZipInfo(i.filename, date_time=i.date_time)
            zi.compress_type = i.compress_type
            zi.external_attr = i.external_attr
            zi.internal_attr = i.internal_attr
            zi.create_system = i.create_system
            z.writestr(zi, parts[i.filename])
    os.replace(tmp, out)
    print("written:", out, os.path.getsize(out))


if __name__ == "__main__":
    main()

import sys
import pandas as pd

pd.set_option("display.width", 200)
oct25 = pd.read_pickle(sys.argv[1])
oct25["发货日期"] = oct25["发货时间.1"].astype(str).str.slice(0, 10)
oct25["渠道大类"] = oct25["销售渠道"].astype(str).str.split("-").str[0]
CH4 = ["天猫", "京东", "拼多多", "抖店"]

dfz = pd.read_excel(sys.argv[2], sheet_name="Sheet3", engine="openpyxl")
dfz["发货日期"] = dfz["发货时间"].astype(str).str.slice(0, 10)
dfz["渠道大类"] = dfz["销售渠道"].astype(str).str.split("-").str[0]

A, B = "2025-10-12", "2025-10-18"
w = oct25[(oct25["发货日期"] >= A) & (oct25["发货日期"] <= B)]
sub = w[w["渠道大类"].isin(CH4)]
g = sub.groupby("货品细分")["分摊后金额"].sum()
g_all = w.groupby("货品细分")["分摊后金额"].sum()

wz = dfz[(dfz["发货日期"] >= A) & (dfz["发货日期"] <= B)]
subz = wz[wz["渠道大类"].isin(CH4)]
gz = subz.groupby("直饮机分类")["分摊后金额"].sum()

ROW_MAP = {
    5: "普通直饮机", 6: "步进式直饮机", 7: "轻商务直饮机",
    8: "@桌面直饮机", 9: "@幼儿园机", 14: "@厨下开水器",
    10: "数显开水器", 11: "数控开水器", 12: "水尺开水器", 13: "步进式开水器",
    15: "蒸煮桶", 16: "开水桶", 17: "吧台机", 18: "台式切片机",
    20: "807/817/827", 21: "806/816",
    22: "绞切一体机", 23: "全自动切片机", 24: "半自动切片机", 25: "锯骨机",
    26: "手动切片机", 27: "手动切骨机", 28: "518切片机",
    30: "801", 31: "802", 32: "811/813", 34: "803", 35: "821/823", 36: "805",
    37: "810", 39: "切菜机", 40: "瓜果切片切丝机", 43: "炒菜机",
    46: "净水器", 49: "工作台", 50: "展示柜", 51: "电磁大锅灶",
    52: "超声波洗碗机", 53: "揭盖洗碗机", 55: "节能灶",
    58: "家用消毒柜", 59: "中温消毒柜", 60: "高温消毒柜", 61: "@消毒柜",
    64: "肠粉机", 65: "肠粉机蒸汽炉", 66: "电磁炉", 67: "粉碎机", 68: "双炉",
}
ZERO_OK = {54}  # categories that exist in the scheme but had no rows that week

from openpyxl import load_workbook
wb = load_workbook(sys.argv[3], data_only=True)
ws = wb["类目销售情况"]

print(f"{'row':<5}{'报告行标签':<16}{'来源':<18}{'4CH值':>14}{'ALL值':>14}{'差(丽力等)':>12}")
res = {}
for r in range(5, 69):
    label = ws.cell(row=r, column=1).value
    key = ROW_MAP.get(r)
    if key is None:
        print(f"{r:<5}{str(label):<16}{'—(无2025对应分类)':<18}{'':>14}{'':>14}")
        continue
    if key.startswith("@"):
        k = key[1:]
        v4 = gz.get(k)
        va = v4
        src = f"直饮机分类:{k}"
    else:
        v4 = g.get(key)
        va = g_all.get(key)
        src = f"货品细分:{key}"
    if v4 is None and r in ZERO_OK:
        v4 = 0.0
        va = 0.0
    if v4 is None:
        print(f"{r:<5}{str(label):<16}{src:<18}{'—':>14}{'—':>14}")
        continue
    v4 = round(float(v4), 2)
    va = round(float(va), 2) if va is not None else None
    res[r] = (label, src, v4)
    diff = "" if va is None or abs(va - v4) < 0.005 else f"{va - v4:,.2f}"
    print(f"{r:<5}{str(label):<16}{src:<18}{v4:>14,.2f}{(va if va is not None else 0):>14,.2f}{diff:>12}")
print()
print("filled rows:", len(res), " sum:", round(sum(v[2] for v in res.values()), 2))
print("blank rows:", [r for r in range(5, 69) if r not in res])
print("直饮机分类 4CH (target week):")
print(gz.round(2).to_string())

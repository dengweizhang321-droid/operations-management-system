import sys
import pandas as pd

pd.set_option("display.width", 220)
pd.set_option("display.max_rows", 500)
ann = pd.read_pickle(sys.argv[1])
oct25 = pd.read_pickle(sys.argv[2])
CH4 = ["天猫", "京东", "拼多多", "抖店"]

ann["发货日期"] = ann["发货日期"].astype(str).str.slice(0, 10)
ann["渠道大类"] = ann["销售渠道"].astype(str).str.split("-").str[0]
oct25["发货日期"] = oct25["发货时间.1"].astype(str).str.slice(0, 10)
oct25["渠道大类"] = oct25["销售渠道"].astype(str).str.split("-").str[0]

pivot = {
    '518切片机': 43272.76, '801': 24759.98, '802': 32825.76, '803': 10736.29, '805': 3163,
    '806/816': -2155.72, '807/817/827': 48047.4, '811/813': 24091.64, '821/823': 10075.43,
    '吧台机': 95241.46, '半自动切片机': 4212.12, '步进式开水器': 52262.67, '步进式直饮机': 73302.29,
    '肠粉机': 4081.38, '肠粉机蒸汽炉': 858, '超声波洗碗机': 43971.18, '炒菜机': 28725.37,
    '底座': 54282.47, '电磁大锅灶': 14077, '电磁炉': 21210.96, '电动切骨机': 2869.48,
    '粉碎机': 62388.01, '工作台': 13956, '瓜果切片切丝机': 1699, '家用消毒柜': 12966.52,
    '绞切一体机': 77762.37, '揭盖洗碗机': 13998, '节能灶': 13747.81, '净水器': 19610.95,
    '锯骨机': 6108.91, '开水桶': 19133.82, '磨浆机': 2849, '配件': 11678.95, '普通直饮机': 290101.2,
    '切菜机': 63142.53, '切片/切骨机': 34481.66, '轻商务直饮机': 101009.6, '全自动切片机': 36442.95,
    '手动切骨机': 7042, '手动切片机': 36297.59, '数控开水器': 102410.53, '数显开水器': 118359.7,
    '双炉': 2453.65, '水尺开水器': 111957.23, '台式切片机': 150494.16, '赠品配件': 80793.79,
    '展示柜': 2799, '蒸煮桶': 4438.4, '直饮机': 5897.99, '制冰机': 1585.04, '中温消毒柜': 7058.71,
    '煮面桶': 0, '自动炒菜机': 20060.39,
}

def cat_sum(frame, a, b, col):
    w = frame[(frame["发货日期"] >= a) & (frame["发货日期"] <= b)]
    w4 = w[w["渠道大类"].isin(CH4)]
    return w, w4, w4.groupby(col)["分摊后金额"].sum()

for label, a, b in [("2025-10-05..10-11", "2025-10-05", "2025-10-11"), ("2025-10-12..10-18", "2025-10-12", "2025-10-18")]:
    print("=" * 90)
    print(label)
    _, w4a, ga = cat_sum(ann, a, b, "货品分类")
    _, w4o, go = cat_sum(oct25, a, b, "货品细分")
    print(f"  annual rows(4CH)={len(w4a)} total={w4a['分摊后金额'].sum():,.2f}")
    print(f"  oct25  rows(4CH)={len(w4o)} total={w4o['分摊后金额'].sum():,.2f}")
    if label.startswith("2025-10-05"):
        diffs_a = sum(abs(float(ga.get(k, 0)) - v) for k, v in pivot.items())
        diffs_o = sum(abs(float(go.get(k, 0)) - v) for k, v in pivot.items())
        print(f"  sum|diff| vs user's own pivot:  annual={diffs_a:,.2f}   oct25={diffs_o:,.2f}")
    keys = sorted(set(ga.index) | set(go.index), key=str)
    print(f"  {'细分':<16}{'annual':>15}{'oct25':>15}{'diff':>12}")
    for k in keys:
        x = float(ga.get(k, 0.0))
        y = float(go.get(k, 0.0))
        flag = "" if abs(x - y) < 0.005 else "   <<<"
        print(f"  {str(k):<16}{x:>15,.2f}{y:>15,.2f}{x-y:>12,.2f}{flag}")

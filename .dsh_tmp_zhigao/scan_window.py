import sys
import pandas as pd
from datetime import date, timedelta

pd.set_option("display.width", 220)
df = pd.read_pickle(sys.argv[1])
df["发货日期"] = df["发货日期"].astype(str).str.slice(0, 10)
df["渠道大类"] = df["销售渠道"].astype(str).str.split("-").str[0]
df = df[df["渠道大类"] != "销售渠道"]
CH4 = ["天猫", "京东", "拼多多", "抖店"]

# pivot values from sheet '25年10月5-11透视' (the source used for the report's JX column)
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
print("pivot total:", round(sum(pivot.values()), 2))

wins = []
for s in range(-3, 2):
    for e in range(-1, 4):
        a = date(2025, 10, 5) + timedelta(days=s)
        b = date(2025, 10, 11) + timedelta(days=e)
        if b < a:
            continue
        wins.append((a.isoformat(), b.isoformat()))

results = []
for a, b in wins:
    w = df[(df["发货日期"] >= a) & (df["发货日期"] <= b)]
    for tag, sub in (("ALL", w), ("4CH", w[w["渠道大类"].isin(CH4)])):
        g = sub.groupby("货品分类")["分摊后金额"].sum()
        diffs = []
        for k, v in pivot.items():
            got = float(g.get(k, 0.0))
            diffs.append(abs(got - v))
        results.append((sum(diffs), max(diffs), a, b, tag, round(float(sub["分摊后金额"].sum()), 2)))
results.sort()
print(f"{'sumAbsDiff':>14}{'maxAbsDiff':>14}  {'window':<24}{'filter':<5}{'total':>16}")
for r in results[:12]:
    print(f"{r[0]:>14,.2f}{r[1]:>14,.2f}  {r[2]}..{r[3]}  {r[4]:<5}{r[5]:>16,.2f}")
print("...")
for r in results[-4:]:
    print(f"{r[0]:>14,.2f}{r[1]:>14,.2f}  {r[2]}..{r[3]}  {r[4]:<5}{r[5]:>16,.2f}")

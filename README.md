# 电扇运营管理系统

## 启动方式

双击 `运行项目.bat`，或在命令行中执行：

```cmd
npm run dev
```

若需要启动预构建的 Workers 产物，先以本机模式完成构建，再执行：

```powershell
$env:VITE_TERUISI_LOCAL_BUILD = "true"
npm run build
npm run start:local-worker
```

`start:local-worker` 会把被 Git 忽略的根目录 `.dev.vars` 以硬链接提供给 `dist/server/wrangler.json`，确保 AI 凭证加密密钥和本机管理员模式进入 Worker；它不会打印或提交密钥。

## 吉客云自动化

- `npm run jackyun:login`：打开专属浏览器，手工登录吉客云
- `npm run jackyun:daily`：运行每日五类数据导入

## 说明

本项目的主界面运行在 `http://localhost:3000`。

市场分析的 SKU 主图标准售价经 AI 识别、人工复核并正式入库后，后续月份若三级类目、榜单口径、SKUID 和图片均一致，系统会直接沿用历史标准价，不再重复 AI 标注或批量入库；图片变化时仍需重新标注。商品榜单中的市场定位价格取正式主图价，成交均价独立按成交数据计算。

## 项目文档与长期信息

- `README.md` 维护面向使用者的当前系统说明、启动方式、主要能力和必要限制。
- `AGENTS.md` 维护开发、数据处理、自动化和 AI 协作时必须遵守的业务口径与工程规则。
- 本项目不再使用外部 Obsidian 作为项目记忆。只有长期、稳定、可复用的信息才写入上述两个文件；临时运行结果和敏感数据不写入。

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

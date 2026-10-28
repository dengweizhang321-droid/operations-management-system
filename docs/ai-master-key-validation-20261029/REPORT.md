# AI 加密主钥两侧统一校验（2026-10-29）

- 分支：`codex/ai-master-key-validation-20261029`，已变基到 `main` = `1415c2c4`
- 来源：2026-10-24 系统审查第 40 项（分报告 D2-7）
- 状态：**改动完成、必需检查通过；未合并、未推送、未准备制品、未发布**（AGENTS.md 规则 4）
- 范围：做了第 1、2 点；**第 3 点（KDF）因存量密文阻塞，按既定判断规则停下未做**

## 一、审查指出的三个缺陷（实测与原文一致）

| # | 缺陷 | 实测位置 |
| --- | --- | --- |
| 1 | 两侧校验不一致 | Django `backend/ai_assistant/secrets.py` 只查 `len(secret.encode()) < 32`；Worker `lib/ai/crypto.ts` 只查 `if (!key)`，**1 个字符也能用**，比 Django 更松 |
| 2 | 不拒绝占位值 | 两侧都不查 `changeme`/`placeholder` 这类能通过长度检查但显然非真密钥的值 |
| 3 | 口令直接 SHA-256 当密钥 | 两侧都是 `SHA-256(口令)` 直出 AES-GCM 密钥，**无盐无迭代** |

## 二、第 3 点为什么停下（存量密文调查）

查到两类持久化密文，且**无密钥版本/轮换机制**：

| 位置 | 内容 |
| --- | --- |
| `backend/ai_assistant/models.py:930` | `AiModels.api_key_encrypted` —— 模型 API Key 密文落库 |
| `backend/ai_assistant/models.py:1295` | `AiSpaceModelProfiles.api_key_encrypted` |
| `backend/ai_assistant/channels.py` | 用同一把主钥加解密钉钉/企微机器人凭据 |

消费方：Worker 侧 `lib/ai/model-gateway.ts:578`、`lib/market/annotation-model.ts:326` 用 `decryptSecret` 读取。

全仓搜索 `key_version`/`keyVersion`/`rotate.*key` → **零命中**，没有任何密钥版本字段或轮换路径。

且 `docs/使用手册/AI助手/ai-assistant-setup.md:8` 已有明文约束：

> 已有系统必须保留原 `AI_SECRET_ENCRYPTION_KEY`……**不得为迁移重新生成密钥**。全新隔离开发环境才可创建新的随机密钥。

**结论：换成 KDF 会让已加密的模型 API Key 与机器人凭据全部无法解密，且没有现成轮换路径。** 要做必须先设计密钥版本字段 + 双钥并行解密的迁移方案，超出审查标注的「小」工作量，须单独立项。

## 三、第 1、2 点的改动

### 复用既有校验函数，不另造一套

`backend/teruisi_backend/settings.py:55` 的 `validate_secret()` **本来就存在**，用于 `DJANGO_SECRET_KEY` 与 `TERUISI_DJANGO_INTERNAL_SECRET`，已含四条规则：

```
≥32 字节  +  占位词黑名单（change-me/changeme/placeholder/replace-me…）
+  不同字符数 < 4（低熵）
+  (replace|change|example|sample|test|secret|password)[-_a-z0-9]* 正则
```

| 文件 | 改动 |
| --- | --- |
| `backend/teruisi_backend/settings.py` | +7，新增 `AI_SECRET_ENCRYPTION_KEY = validate_secret(..., required=False)`，与另两个密钥同样只在 `if not DEBUG` 时执行 |
| `backend/ai_assistant/secrets.py` | `_key()` 改调同一个 `validate_secret()`，使 `DEBUG=True` 的本机开发环境也在首次加解密时 fail-closed |
| `lib/ai/crypto.ts` | +31，新增 `isAcceptableEncryptionKey()`，规则与 Django 逐条对应；`getKeyMaterial()` 不再「只要非空就能用」 |

### 为什么不会让服务起不来

新增调用用的是 `required=False`，而 `validate_secret` 的第一行是：

```python
if not required and not value:
    return value
```

**未配置该密钥的进程直接放行，不阻断启动**；配了过短或占位值的才会在启动期被拒。这与既有的「生产/配置环境启动即拒绝、dev 环境留空可用」模式一致，不是新引入的模式。

### 两侧现状对比

| | 改前 | 改后 |
| --- | --- | --- |
| Django 规则 | 仅 ≥32 字节 | ≥32 字节 + 占位黑名单 + 低熵 + 示例词正则 |
| Django 时机 | 仅首次 encrypt/decrypt | 非 DEBUG 在 settings 加载时（进程启动）即拒；DEBUG 仍首次用时拒 |
| Worker 规则 | 仅非空 | 与 Django 同一套 |
| Worker 时机 | 首次 encrypt/decrypt | 同，但规则收紧 |
| KDF | 两侧均无 | 未改（见第二节） |

### Worker 侧「启动即拒绝」的落地边界

Cloudflare Workers 没有 Django 意义上的进程启动钩子——`env`（密钥来源）只在每次 `fetch`/`scheduled` 调用时可得，模块顶层拿不到。所以 Worker 侧做不到「部署时拒绝」，只能做到「该 isolate 收到的第一个会用到这把密钥的请求立即 fail-closed」。

这与 Django 在 `DEBUG=True` 时的行为对称。若要真正的部署前校验，需要一个独立的部署前校验脚本（运维脚本而非运行时代码），**本次未做，列为未决项**。

## 四、测试

| 范围 | 结果 |
| --- | --- |
| `tests/ai-crypto.test.ts`（+61，6 个新用例 + 1 个直测） | **7 通过 0 失败** |
| `backend/ai_assistant/test_secrets.py`（新增） | 含在下行 |
| `backend/teruisi_backend/test_settings_validate_secret.py`（新增） | 两文件合计 **13 通过 0 失败** |
| `manage.py check` | 无问题 |

覆盖了「合法密钥通过」「空值/过短被拒」「占位词被拒」「示例词被拒」「低熵被拒」，以及 `required=True`/`False` 两种必填语义。

**所有测试密钥均为合成字符串**（如 `synthetic-test-master-key-…`），未使用、未读取、未输出任何真实密钥；未读 `.dev.vars` 内容。

`.github/workflows/ci-unit-test-files.txt` 补入 `tests/ai-crypto.test.ts`（原不在白名单内，按该文件头注释的流程：先单独跑过、确认快速通过再加入）。

### 回归基线对照

`manage.py test ai_assistant` 全量：**1822 tests / 142 failures / 232 errors / 206 skipped**（约 100 分钟）。

该失败量**属既有基线**，已用两种方式确认：

1. grep 全量输出中 `secrets`/`crypto`/`encryption` 相关失败 → **零命中**，没有一条失败触及本次改动面；
2. 抽取两个最可疑的失败（一个「exact table count」断言期望 78 实得 110、一个 DB 事务断言）在**未改动的 main**上单独复跑 → 同样失败、数字相同，代码从未被本次改动触及。

### 必需检查

| 检查 | 结果 |
| --- | --- |
| `npm run build` | 通过 |
| lint 基线门禁 | 56 errors / 119 warnings，与基线一致 |
| `check:backend-boundary` | `violations: []` |
| `check:pi152-acl` | `PI152_ACL_CONTRACT_PASSED` |

## 五、硬约束遵守

未触碰 `package.json`（被 guard 收据按 sha256 钉死的受保护发布入口），未触碰被三代闭包字节钉死的三个发布工具文件，未读取 `.dev.vars` 内容。

## 六、未决项

1. **第 3 点 KDF 是否单独立项** —— 需设计密钥版本字段 + 双钥并行解密迁移路径；
2. **Worker 侧是否补部署前校验脚本** —— 当前是「首个用到密钥的请求即拒」，非真正部署时校验（Workers 架构限制）。

## 变更记录

2026-10-29：建立。统一两侧主钥校验规则并提前到启动期；KDF 因存量密文无轮换路径而停下，列为独立事项。

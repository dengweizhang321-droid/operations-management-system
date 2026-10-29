# P0-04 独立审查与修复记录

日期：2026-10-29。审查对象：提交 `841ed97e` 的 `model_capabilities.py` 与 `provider.py` 改动。基线 `f205e96f`。

审查由未参与实现的独立上下文执行，跑了既有测试并写临时脚本实测各分支。本文记录其发现与处置；不表示功能已验收，功能是否符合需求由用户上线后判断。

## 1. 审查确认成立的项

- 历史兼容：`DEFAULTS` 已含新键，旧配置经 `options()` 后 `taskTimeoutMs` 正确套用 260000 历史值、原有字段不变、新键回落 `none`，未知键仍被拒绝。
- 入参校验：`fields(structured_output, ("name","schema","strict"), ("name","schema"))` 的 allowed/required 正确；缺键、多余键、非 dict 三种畸形输入均为受控 `AiError`，不产生 500。
- `output_config` 合并：`provider_parameters()` 仅在 `reasoningFormat == "anthropic_adaptive"` 且 effort 非默认时产出 `output_config`；合并后 `effort` 与 `format` 并存不互相覆盖，缺一侧时退化正确。
- openai 分支无字段冲突：`provider_parameters()` 不产出 `response_format`。
- 深度上限生效：50 层嵌套在毫秒内返回且不抛 `RecursionError`。
- `required` 非 list 时偏保守（当作空集合，几乎必然报“未覆盖”），是误报方向而非漏判。
- 合规多层嵌套 schema 实测无误报。
- 范围无越界：未动工具 strict 逻辑、未改既有字段语义与默认值、无无关重构；`turn()` 新参数为纯增量 keyword-only，6 个既有调用点均未传入。

## 2. 审查发现的两处问题，均已修复

### 2.1 anthropic 分支跳过 schema 前置检查且静默忽略 strict

原实现在 `strict_schema_violations()` 调用**之前**就返回 anthropic 分支，因此该协议下调用方传 `strict=True` 既不报错也不生效——参数被静默丢弃。

处置：该协议的 `output_config.format` 没有 `strict` 字段，声明无处安放，因此**显式拒绝**（`structured_output_strict_unsupported`，400），而不是接受后丢弃。

是否对该协议断言同样的 schema 前置条件：本次核对的供应商指南未明文规定，其示例确实都带 `additionalProperties: false` 与完整 `required`，但示例不等于强制要求。故**不替该协议断言前置条件**，也不虚构约束；代码注释写明了这一依据与其边界。

实施中曾一度把违规清单作为 `_diagnostics` 一并返回，经自查发现该返回值会被 `**extra_params` 展开进请求体（openai 分支会泄漏，anthropic 分支不泄漏只是巧合），已移除——返回值只含协议字段。

### 2.2 `type` 为联合类型（数组形式）时漏判为合规

`strict_schema_violations()` 原按 `kind == "object"` / `kind == "array"` / `kind is None` 三分支判断。`type` 为 `["object","null"]` 时三者皆不匹配，函数返回空列表，意味着**object 形态的全部检查被跳过**，`strict` 未声明时还会被判定为合规并以 `strict: true` 发出，最终由供应商 400 拒绝——正是该函数要避免的失败位置。

处置：`type` 非字符串即报违规并提前返回，不再继续按 object/array 检查。实测 `{'type':['object','null'], ...}` 现在返回「type 必须是字符串，不支持联合类型」。

## 3. 修复后的验证

`compileall` 通过；`test_model_capabilities`、`test_provider_endpoint_contract`、`test_provider_roundtrip` 共 39 个既有测试全部通过；两处修复的行为分别实测确认。未新增功能测试（按根 AGENTS.md 第 4 条，AI 不执行功能验收）。

## 4. 仍需注意

本能力目前**没有任何 consumer**。方案第 5 节要求的「接首个实际 consumer」（Skill 候选提炼）属 P1-01，未实施。因此当前状态是「能力已实现、未被调用」，不能表述为结构化输出已在用。

审查另指出 `strict=False` 配合合规 schema 时不会被纠正为 `true`，这是自洽的（调用方显式要求非 strict 即照办），未作改动。

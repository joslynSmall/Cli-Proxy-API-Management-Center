# OpenAI 兼容提供商模型同步选择流程设计

## 背景

当前系统页中的“同步模型”操作会在用户点击后直接把提供商模型同步到配置文件，缺少人工确认与筛选过程。新的需求是将流程改为“先获取模型列表、用户多选、再对选中模型做 alias 匹配、最后确认写入配置”，从而避免默认全量同步，并减少无效 alias 匹配请求。

本次设计涉及两个仓库：

- 前端：`/Users/joslyn/.config/opencode-profiles/default/worktrees/Cli-Proxy-API-Management-Center/circuit-breaker-ui`
- 后端：`/Users/joslyn/.config/opencode-profiles/default/worktrees/CLIProxyAPI/circuit-breaker-feature`

## 目标

- 禁止默认直接同步全部模型到配置文件
- 用户先看到原始模型列表，再决定同步哪些模型
- 仅对用户选中的模型执行 alias 匹配
- 已匹配模型允许手动修改 alias
- 未匹配模型允许用户手动填写 alias
- 最终写入时替换该 provider 的整个 `models` 列表，只保留用户确认的模型

## 非目标

- 不保留原有“一键全部同步”的快捷路径
- 不在本次改造中支持多 provider 批量同步
- 不引入新的全局页面或新的复杂状态管理层

## 方案选择

采用方案 B：在现有 `sync-models` 基础上重构为两阶段流程，并新增单独的 alias 查询接口。

原因：

- 保持现有同步入口不变，兼容现有前后端语义
- 第一步可复用既有 provider 拉取模型逻辑
- 第二步只对已选模型做 alias 查询，减少无效请求
- 最终保存仍由 `sync-models` 承担，职责清晰且改动可控

## 目标流程

```text
选择提供商
  -> 获取原始模型列表（不做 alias 匹配，不写配置）
  -> 用户搜索并多选模型
  -> 对选中模型执行 alias 匹配
  -> 用户检查/修改 alias
  -> 确认写入配置文件
  -> 刷新页面模型展示
```

## 后端设计

### 1. 扩展现有 sync-models 接口

接口：`POST /v0/management/openai-compatibility/sync-models`

请求结构：

```go
type openAICompatSyncRequest struct {
    Name            string                 `json:"name"`
    All             bool                   `json:"all"`
    Preview         bool                   `json:"preview"`
    SkipAliasLookup bool                   `json:"skip_alias_lookup"`
    SelectedModels  []SelectedModelPayload `json:"selected_models"`
    TimeoutSecond   *int                   `json:"timeout_seconds"`
}

type SelectedModelPayload struct {
    Name  string `json:"name"`
    Alias string `json:"alias"`
}
```

#### 模式 A：获取原始模型列表

请求：

```json
{
  "name": "us-ci",
  "preview": true,
  "skip_alias_lookup": true
}
```

行为：

- 根据 provider 请求上游 `/models`
- 只返回原始模型名
- 不访问 ModelScope
- 不写配置文件

响应：

```json
{
  "status": "ok",
  "provider": "us-ci",
  "models": ["qwen-2.5-72b-instruct", "qwen-2.5-7b-instruct"],
  "fetched_count": 2
}
```

#### 模式 B：确认写入配置

请求：

```json
{
  "name": "us-ci",
  "preview": false,
  "selected_models": [
    { "name": "qwen-2.5-72b-instruct", "alias": "Qwen2.5-72B-Instruct" },
    { "name": "some-unknown-model", "alias": "Custom-Alias" }
  ]
}
```

行为：

- 校验 provider 存在
- 校验 `selected_models` 非空
- 校验每个选中模型的 `name` 非空、`alias` 非空
- 用用户提交的内容直接构造 provider 的 `models`
- 替换该 provider 原有 `models`
- 持久化配置

响应：

```json
{
  "status": "ok",
  "provider": "us-ci",
  "updated_count": 2,
  "errors": []
}
```

### 2. 新增 alias 查询接口

接口：`POST /v0/management/openai-compatibility/lookup-aliases`

请求：

```json
{
  "models": ["qwen-2.5-72b-instruct", "some-unknown-model"],
  "timeout_seconds": 15
}
```

响应：

```json
{
  "status": "ok",
  "matched": [
    { "name": "qwen-2.5-72b-instruct", "alias": "Qwen2.5-72B-Instruct" }
  ],
  "unmatched": ["some-unknown-model"]
}
```

行为约束：

- 只对传入模型做 alias 匹配
- 不写配置文件
- 单个模型查询失败时按未匹配处理，避免整体失败

### 3. 后端内部改动建议

- 将“拉取 provider 原始模型列表”逻辑从当前同步实现中抽离为独立函数
- 将“单模型 alias 查询”与“批量 alias 查询”拆开，便于给新接口复用
- `sync-models` 的保存逻辑不再依赖 alias 自动匹配结果，而是依赖前端确认后的 `selected_models`

## 前端设计

### 1. SystemPage 交互改造

当前系统页中的按钮语义改为：

- 提供商下拉框
- “获取模型列表”按钮

不再提供默认直接同步按钮。

### 2. 弹窗流程

弹窗采用两步状态：

- `select`：选择原始模型
- `alias`：编辑 alias 并确认同步

#### 第一步：选择模型

展示内容：

- 原始模型总数
- 搜索框（前端过滤）
- 模型多选列表
- 全选 / 取消全选
- 已选数量

交互规则：

- 用户必须先选择至少一个模型才能进入下一步
- 搜索仅过滤当前列表展示，不触发后端请求

#### 第二步：匹配并编辑 alias

进入该步骤时：

- 调用 `lookup-aliases`
- 仅查询第一步已选模型

展示内容：

- 已匹配模型列表
- 未匹配模型列表
- 每一项都展示可编辑 alias 输入框

交互规则：

- 已匹配模型：输入框初始值为自动匹配 alias，允许用户修改
- 未匹配模型：输入框初始值为空，用户必须手动填写
- 所有待保存模型必须有非空 alias 才允许点击确认

### 3. 前端状态建议

建议新增或拆分以下状态：

- `selectedProvider`
- `syncModalOpen`
- `syncModalStep`
- `rawModels`
- `selectedModelNames`
- `aliasDrafts`
- `matchedModelNames`
- `lookupLoading`
- `syncingModels`

其中：

- `selectedModelNames` 存放第一步勾选结果
- `aliasDrafts` 结构建议为 `Record<string, string>`
- `matchedModelNames` 用于给自动匹配项展示视觉标识

## 数据流

### Step 1：获取原始模型

- 前端调用 `sync-models`
- 参数：`preview=true`, `skip_alias_lookup=true`
- 后端返回原始模型列表
- 前端打开弹窗，进入 `select`

### Step 2：选择模型

- 用户搜索与勾选
- 点“下一步：匹配 alias”
- 若未选任何模型，前端直接提示并阻止继续

### Step 3：查询 alias

- 前端调用 `lookup-aliases`
- 请求体仅包含已选模型
- 前端根据响应初始化 `aliasDrafts`
- 进入 `alias` 步骤

### Step 4：确认同步

- 前端校验所有选中模型 alias 非空
- 调用 `sync-models`
- 参数：`preview=false`, `selected_models=[...]`
- 后端替换 provider `models` 并写入配置
- 前端关闭弹窗并刷新模型展示

## 错误处理

### 前端

- 获取原始模型失败：toast 提示，停留在系统页
- alias 查询失败：toast 提示，保留第一步选择结果
- 确认保存失败：toast 提示，保留 alias 草稿与弹窗状态
- provider 未选择：阻止请求并提示

### 后端

- `preview=true` 时严禁写配置
- `lookup-aliases` 只读，无副作用
- `preview=false` 时若写入失败，保持配置原状
- provider 不存在、`selected_models` 为空、alias 为空等返回明确 4xx

## 测试策略

### 前端测试

- 获取原始模型后正确打开弹窗
- 搜索过滤只影响前端展示
- 未选择模型时不能进入 alias 步骤
- 已匹配模型 alias 可修改
- 未匹配模型必须填写 alias 才能确认
- 确认后刷新页面模型列表

### 后端测试

- `preview=true + skip_alias_lookup=true` 只返回原始模型，不写配置
- `preview=false + selected_models` 正确替换 provider models
- `lookup-aliases` 只处理传入模型
- 匹配与未匹配混合场景返回正确
- 参数非法时返回对应 4xx

## 验收标准

- 页面中不再存在“点击即同步全部模型”的默认路径
- 用户只能在明确选择模型并确认 alias 后才写入配置
- alias 自动匹配只发生在用户已选模型上
- 已匹配模型 alias 可以人工修改
- 未匹配模型可以人工补全 alias
- 最终配置中仅保留用户确认的模型列表

## 实施顺序建议

1. 后端扩展 `sync-models` 的 preview/raw-list 能力
2. 后端新增 `lookup-aliases` 接口
3. 前端完成两步弹窗与状态管理
4. 前后端联调
5. 补充测试并验证配置写入结果

## 风险与控制

- 风险：前端状态过多导致 `SystemPage` 继续膨胀  
  控制：将同步弹窗抽成独立组件，页面仅保留触发与结果刷新逻辑

- 风险：alias 查询耗时较长影响体验  
  控制：只对已选模型查询，并在第二步展示明确 loading 状态

- 风险：用户修改 alias 后保存失败导致重复输入  
  控制：失败时保留本地草稿，不清空弹窗

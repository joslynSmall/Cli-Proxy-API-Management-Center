# OpenAI 模型同步选择 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把系统页的 OpenAI 兼容提供商模型同步流程改成“先拉原始模型、用户多选、再匹配 alias、最后确认写入配置”。

**Architecture:** 后端继续沿用现有 `sync-models` 入口，但拆出 preview/raw-list 与 confirm/save 两种模式，并新增只读的 `lookup-aliases` 接口。前端把系统页同步流程提取成独立弹窗组件，复用现有 `Modal`、`Input`、`SelectionCheckbox` 模式，避免继续膨胀 `SystemPage.tsx`。

**Tech Stack:** Go + Gin、React 19 + TypeScript、Zustand、i18next、SCSS Modules、Vitest + Testing Library（新增前端测试基建）。

---

## File Structure

### Backend

- Modify: `/Users/joslyn/.config/opencode-profiles/default/worktrees/CLIProxyAPI/circuit-breaker-feature/internal/api/handlers/management/openai_compat_sync.go`
  - 扩展请求结构
  - 为 `sync-models` 增加 preview/raw-list 与 confirm/save 分支
  - 新增 `LookupOpenAICompatAliases`
  - 抽离“批量 alias 查询”和“selected_models 构造 models”
- Modify: `/Users/joslyn/.config/opencode-profiles/default/worktrees/CLIProxyAPI/circuit-breaker-feature/internal/api/server.go`
  - 注册 `POST /openai-compatibility/lookup-aliases`
- Modify/Test: `/Users/joslyn/.config/opencode-profiles/default/worktrees/CLIProxyAPI/circuit-breaker-feature/internal/api/handlers/management/openai_compat_sync_test.go`
  - 为 preview、confirm、lookup-aliases、新错误路径补测试

### Frontend

- Modify: `/Users/joslyn/.config/opencode-profiles/default/worktrees/Cli-Proxy-API-Management-Center/circuit-breaker-ui/package.json`
  - 增加 `test` 脚本与测试依赖
- Modify: `/Users/joslyn/.config/opencode-profiles/default/worktrees/Cli-Proxy-API-Management-Center/circuit-breaker-ui/vite.config.ts`
  - 增加 `test` 配置
- Create: `/Users/joslyn/.config/opencode-profiles/default/worktrees/Cli-Proxy-API-Management-Center/circuit-breaker-ui/src/test/setup.ts`
  - Testing Library / jest-dom 初始化
- Modify: `/Users/joslyn/.config/opencode-profiles/default/worktrees/Cli-Proxy-API-Management-Center/circuit-breaker-ui/src/services/api/providers.ts`
  - 扩展 preview / lookup / confirm 请求响应类型与 API 方法
- Create: `/Users/joslyn/.config/opencode-profiles/default/worktrees/Cli-Proxy-API-Management-Center/circuit-breaker-ui/src/components/system/OpenAICompatSyncModal.tsx`
  - 两步弹窗主组件
- Create: `/Users/joslyn/.config/opencode-profiles/default/worktrees/Cli-Proxy-API-Management-Center/circuit-breaker-ui/src/components/system/OpenAICompatSyncModal.module.scss`
  - 弹窗样式
- Create/Test: `/Users/joslyn/.config/opencode-profiles/default/worktrees/Cli-Proxy-API-Management-Center/circuit-breaker-ui/src/components/system/OpenAICompatSyncModal.test.tsx`
  - 关键交互测试
- Modify: `/Users/joslyn/.config/opencode-profiles/default/worktrees/Cli-Proxy-API-Management-Center/circuit-breaker-ui/src/pages/SystemPage.tsx`
  - 接入新弹窗与新流程
- Modify: `/Users/joslyn/.config/opencode-profiles/default/worktrees/Cli-Proxy-API-Management-Center/circuit-breaker-ui/src/pages/SystemPage.module.scss`
  - 同步区域与弹窗入口样式微调
- Modify: `/Users/joslyn/.config/opencode-profiles/default/worktrees/Cli-Proxy-API-Management-Center/circuit-breaker-ui/src/i18n/locales/zh-CN.json`
- Modify: `/Users/joslyn/.config/opencode-profiles/default/worktrees/Cli-Proxy-API-Management-Center/circuit-breaker-ui/src/i18n/locales/en.json`
- Modify: `/Users/joslyn/.config/opencode-profiles/default/worktrees/Cli-Proxy-API-Management-Center/circuit-breaker-ui/src/i18n/locales/ru.json`
  - 增加新文案

## Task 1: 后端先锁定 sync-models 的 preview / confirm 行为

**Files:**
- Modify/Test: `/Users/joslyn/.config/opencode-profiles/default/worktrees/CLIProxyAPI/circuit-breaker-feature/internal/api/handlers/management/openai_compat_sync_test.go`
- Modify: `/Users/joslyn/.config/opencode-profiles/default/worktrees/CLIProxyAPI/circuit-breaker-feature/internal/api/handlers/management/openai_compat_sync.go`

- [ ] **Step 1: 先写 preview / confirm 的失败测试**

```go
func TestSyncOpenAICompatModels_PreviewRawModels(t *testing.T) {
	gin.SetMode(gin.TestMode)

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"data":[{"id":"kimi-k2.5"},{"id":"GLM-5.1"}]}`))
	}))
	defer upstream.Close()

	cfg := &config.Config{
		OpenAICompatibility: []config.OpenAICompatibility{{
			Name: "us-ci", BaseURL: upstream.URL, APIKeyEntries: []config.OpenAICompatibilityAPIKey{{APIKey: "k"}},
			Models: []config.OpenAICompatibilityModel{{Name: "old-model"}},
		}},
	}
	h, configPath := newSyncTestHandler(t, cfg)

	status, body := performSyncRequest(t, h, `{"name":"us-ci","preview":true,"skip_alias_lookup":true}`)
	if status != http.StatusOK {
		t.Fatalf("status = %d, want 200, body=%v", status, body)
	}
	if int(body["fetched_count"].(float64)) != 2 {
		t.Fatalf("fetched_count = %v, want 2", body["fetched_count"])
	}
	if _, ok := body["models"].([]any); !ok {
		t.Fatalf("models type = %T, want array", body["models"])
	}
	if len(h.cfg.OpenAICompatibility[0].Models) != 1 || h.cfg.OpenAICompatibility[0].Models[0].Name != "old-model" {
		t.Fatalf("preview should not mutate config: %+v", h.cfg.OpenAICompatibility[0].Models)
	}
	content, _ := os.ReadFile(configPath)
	if !strings.Contains(string(content), "old-model") {
		t.Fatalf("preview unexpectedly rewrote config: %s", string(content))
	}
}

func TestSyncOpenAICompatModels_ConfirmReplaceModels(t *testing.T) {
	gin.SetMode(gin.TestMode)

	cfg := &config.Config{
		OpenAICompatibility: []config.OpenAICompatibility{{
			Name: "us-ci", BaseURL: "https://example.com/v1",
			Models: []config.OpenAICompatibilityModel{{Name: "old-model", Alias: "Old"}},
		}},
	}
	h, _ := newSyncTestHandler(t, cfg)

	status, body := performSyncRequest(t, h, `{
		"name":"us-ci",
		"preview":false,
		"selected_models":[
			{"name":"kimi-k2.5","alias":"Kimi-K2.5"},
			{"name":"glm-5.1","alias":"GLM-5.1"}
		]
	}`)
	if status != http.StatusOK {
		t.Fatalf("status = %d, want 200, body=%v", status, body)
	}
	models := h.cfg.OpenAICompatibility[0].Models
	if len(models) != 2 || models[0].Name == "old-model" {
		t.Fatalf("models = %+v, want replaced list", models)
	}
}
```

- [ ] **Step 2: 跑后端定向测试，确认当前实现还不支持**

Run:

```bash
/Users/joslyn/local/go/bin/go test ./internal/api/handlers/management -run 'TestSyncOpenAICompatModels_(PreviewRawModels|ConfirmReplaceModels)$' -v
```

Expected:

```text
FAIL
openAICompatSyncRequest 缺少 preview / skip_alias_lookup / selected_models 字段，
或者响应体中没有 models / fetched_count，
或者 preview 分支错误地改写了 provider.models
```

- [ ] **Step 3: 在 handler 里加入请求结构与 preview / confirm 分支的最小实现**

```go
type selectedModelPayload struct {
	Name  string `json:"name"`
	Alias string `json:"alias"`
}

type openAICompatSyncRequest struct {
	Name            string                 `json:"name"`
	All             bool                   `json:"all"`
	Preview         bool                   `json:"preview"`
	SkipAliasLookup bool                   `json:"skip_alias_lookup"`
	SelectedModels  []selectedModelPayload `json:"selected_models"`
	TimeoutSecond   *int                   `json:"timeout_seconds"`
}

func (h *Handler) SyncOpenAICompatModels(c *gin.Context) {
	var req openAICompatSyncRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"status": "error", "errors": []string{"invalid body"}})
		return
	}

	selected, errSelect := selectOpenAICompatProviders(h.cfg.OpenAICompatibility, strings.TrimSpace(req.Name), req.All)
	if errSelect != nil {
		status := http.StatusBadRequest
		if errSelect == errOpenAICompatProviderNotFound {
			status = http.StatusNotFound
		}
		c.JSON(status, gin.H{"status": "error", "errors": []string{errSelect.Error()}})
		return
	}
	if len(selected) != 1 {
		c.JSON(http.StatusBadRequest, gin.H{"status": "error", "errors": []string{"exactly one provider is required"}})
		return
	}

	entry := h.cfg.OpenAICompatibility[selected[0]]
	if req.Preview && req.SkipAliasLookup {
		modelNames, warnings, errFetch := h.fetchOpenAICompatUpstreamModels(c.Request.Context(), entry, resolveSyncTimeout(req.TimeoutSecond))
		if errFetch != nil {
			c.JSON(http.StatusBadGateway, gin.H{"status": "error", "errors": append(warnings, errFetch.Error())})
			return
		}
		c.JSON(http.StatusOK, gin.H{
			"status": "ok", "provider": providerDisplayName(entry), "models": modelNames, "fetched_count": len(modelNames), "errors": warnings,
		})
		return
	}

	if req.Preview {
		c.JSON(http.StatusBadRequest, gin.H{"status": "error", "errors": []string{"preview requires skip_alias_lookup=true"}})
		return
	}

	models, errModels := buildSelectedOpenAICompatModels(req.SelectedModels)
	if errModels != nil {
		c.JSON(http.StatusBadRequest, gin.H{"status": "error", "errors": []string{errModels.Error()}})
		return
	}
	return h.persistSelectedOpenAICompatModels(c, selected[0], entry, models)
}
```

- [ ] **Step 4: 补上 selected_models 校验与持久化辅助函数**

```go
func buildSelectedOpenAICompatModels(input []selectedModelPayload) ([]config.OpenAICompatibilityModel, error) {
	if len(input) == 0 {
		return nil, fmt.Errorf("selected_models is required")
	}
	out := make([]config.OpenAICompatibilityModel, 0, len(input))
	for _, item := range input {
		name := strings.TrimSpace(item.Name)
		alias := strings.TrimSpace(item.Alias)
		if name == "" {
			return nil, fmt.Errorf("selected model name is required")
		}
		if alias == "" {
			return nil, fmt.Errorf("alias is required for model %s", name)
		}
		out = append(out, config.OpenAICompatibilityModel{Name: name, Alias: alias})
	}
	return out, nil
}

func (h *Handler) persistSelectedOpenAICompatModels(c *gin.Context, providerIndex int, entry config.OpenAICompatibility, models []config.OpenAICompatibilityModel) {
	updatedProviders := cloneOpenAICompatibilityEntries(h.cfg.OpenAICompatibility)
	updatedProviders[providerIndex].Models = append([]config.OpenAICompatibilityModel(nil), models...)
	originalProviders := h.cfg.OpenAICompatibility
	h.cfg.OpenAICompatibility = updatedProviders
	h.cfg.SanitizeOpenAICompatibility()
	if err := h.persistConfigOnly(); err != nil {
		h.cfg.OpenAICompatibility = originalProviders
		c.JSON(http.StatusInternalServerError, gin.H{"status": "error", "provider": providerDisplayName(entry), "errors": []string{fmt.Sprintf("failed to save config: %v", err)}})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "ok", "provider": providerDisplayName(entry), "updated_count": len(models), "errors": []string{}})
}
```

- [ ] **Step 5: 重新跑定向测试**

Run:

```bash
/Users/joslyn/local/go/bin/go test ./internal/api/handlers/management -run 'TestSyncOpenAICompatModels_(PreviewRawModels|ConfirmReplaceModels)$' -v
```

Expected:

```text
PASS
```

## Task 2: 后端补上 lookup-aliases 接口与错误路径

**Files:**
- Modify/Test: `/Users/joslyn/.config/opencode-profiles/default/worktrees/CLIProxyAPI/circuit-breaker-feature/internal/api/handlers/management/openai_compat_sync_test.go`
- Modify: `/Users/joslyn/.config/opencode-profiles/default/worktrees/CLIProxyAPI/circuit-breaker-feature/internal/api/handlers/management/openai_compat_sync.go`
- Modify: `/Users/joslyn/.config/opencode-profiles/default/worktrees/CLIProxyAPI/circuit-breaker-feature/internal/api/server.go`

- [ ] **Step 1: 先补 lookup-aliases 的失败测试**

```go
func TestLookupOpenAICompatAliases_MixedResults(t *testing.T) {
	gin.SetMode(gin.TestMode)

	modelScope := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Query().Get("search") {
		case "kimi-k2.5":
			_, _ = w.Write([]byte(`{"success":true,"data":{"models":[{"id":"moonshotai/Kimi-K2.5","display_name":"Kimi-K2.5","downloads":100}]}}`))
		default:
			_, _ = w.Write([]byte(`{"success":true,"data":{"models":[]}}`))
		}
	}))
	defer modelScope.Close()

	restore := swapModelScopeBaseURL(modelScope.URL)
	defer restore()

	h, _ := newSyncTestHandler(t, &config.Config{})
	status, body := performLookupAliasesRequest(t, h, `{"models":["kimi-k2.5","unknown-model"]}`)
	if status != http.StatusOK {
		t.Fatalf("status = %d, want 200, body=%v", status, body)
	}
	matched := body["matched"].([]any)
	unmatched := body["unmatched"].([]any)
	if len(matched) != 1 || len(unmatched) != 1 {
		t.Fatalf("matched=%v unmatched=%v", matched, unmatched)
	}
}

func TestLookupOpenAICompatAliases_RejectsEmptyModels(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h, _ := newSyncTestHandler(t, &config.Config{})
	status, _ := performLookupAliasesRequest(t, h, `{"models":[]}`)
	if status != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", status)
	}
}
```

- [ ] **Step 2: 跑 lookup-aliases 测试，确认接口尚未注册**

Run:

```bash
/Users/joslyn/local/go/bin/go test ./internal/api/handlers/management -run 'TestLookupOpenAICompatAliases_' -v
```

Expected:

```text
FAIL
performLookupAliasesRequest 未定义，
或者 Handler 上没有 LookupOpenAICompatAliases，
或者 POST /openai-compatibility/lookup-aliases 还未注册
```

- [ ] **Step 3: 注册路由并实现查询接口**

```go
// internal/api/server.go
mgmt.POST("/openai-compatibility/lookup-aliases", s.mgmt.LookupOpenAICompatAliases)
```

```go
type openAICompatAliasLookupRequest struct {
	Models        []string `json:"models"`
	TimeoutSecond *int     `json:"timeout_seconds"`
}

type openAICompatAliasMatch struct {
	Name  string `json:"name"`
	Alias string `json:"alias"`
}

func (h *Handler) LookupOpenAICompatAliases(c *gin.Context) {
	var req openAICompatAliasLookupRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"status": "error", "errors": []string{"invalid body"}})
		return
	}
	if len(req.Models) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"status": "error", "errors": []string{"models is required"}})
		return
	}

	timeout := resolveSyncTimeout(req.TimeoutSecond)
	matched := make([]openAICompatAliasMatch, 0, len(req.Models))
	unmatched := make([]string, 0)
	for _, raw := range req.Models {
		name := strings.TrimSpace(raw)
		if name == "" {
			continue
		}
		alias, ok, err := h.lookupModelScopeCanonicalAlias(c.Request.Context(), name, timeout)
		if err != nil || !ok || strings.TrimSpace(alias) == "" {
			unmatched = append(unmatched, name)
			continue
		}
		matched = append(matched, openAICompatAliasMatch{Name: name, Alias: alias})
	}
	c.JSON(http.StatusOK, gin.H{"status": "ok", "matched": matched, "unmatched": unmatched})
}
```

- [ ] **Step 4: 给测试辅助方法补 lookup-aliases 请求封装**

```go
func performLookupAliasesRequest(t *testing.T, h *Handler, body string) (int, map[string]any) {
	t.Helper()

	router := gin.New()
	router.POST("/v0/management/openai-compatibility/lookup-aliases", h.LookupOpenAICompatAliases)

	req := httptest.NewRequest(http.MethodPost, "/v0/management/openai-compatibility/lookup-aliases", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, req)

	var parsed map[string]any
	if err := json.Unmarshal(recorder.Body.Bytes(), &parsed); err != nil {
		t.Fatalf("decode response: %v body=%s", err, recorder.Body.String())
	}
	return recorder.Code, parsed
}
```

- [ ] **Step 5: 跑后端包测试，锁定本次接口改造**

Run:

```bash
/Users/joslyn/local/go/bin/go test ./internal/api/handlers/management -run 'Test(SyncOpenAICompatModels|LookupOpenAICompatAliases)_' -v
```

Expected:

```text
PASS
```

## Task 3: 前端先接好 API 类型与测试基建

**Files:**
- Modify: `/Users/joslyn/.config/opencode-profiles/default/worktrees/Cli-Proxy-API-Management-Center/circuit-breaker-ui/package.json`
- Modify: `/Users/joslyn/.config/opencode-profiles/default/worktrees/Cli-Proxy-API-Management-Center/circuit-breaker-ui/vite.config.ts`
- Create: `/Users/joslyn/.config/opencode-profiles/default/worktrees/Cli-Proxy-API-Management-Center/circuit-breaker-ui/src/test/setup.ts`
- Modify: `/Users/joslyn/.config/opencode-profiles/default/worktrees/Cli-Proxy-API-Management-Center/circuit-breaker-ui/src/services/api/providers.ts`

- [ ] **Step 1: 增加前端测试依赖与脚本**

```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.6.3",
    "@testing-library/react": "^16.3.0",
    "@testing-library/user-event": "^14.6.1",
    "jsdom": "^25.0.1",
    "vitest": "^2.1.8"
  }
}
```

- [ ] **Step 2: 配置 Vitest**

```ts
// vite.config.ts
export default defineConfig({
  plugins: [react(), viteSingleFile({ removeViteModuleLoader: true })],
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    globals: true,
    css: true,
  },
  define: {
    __APP_VERSION__: JSON.stringify(getVersion())
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  },
  css: {
    modules: {
      localsConvention: 'camelCase',
      generateScopedName: '[name]__[local]___[hash:base64:5]'
    },
    preprocessorOptions: {
      scss: {
        additionalData: `@use "@/styles/variables.scss" as *;`
      }
    }
  },
  server: {
    port: 18317,
    strictPort: true
  }
})
```

```ts
// src/test/setup.ts
import '@testing-library/jest-dom/vitest';
```

- [ ] **Step 3: 扩展 providers API 类型与方法**

```ts
export interface OpenAICompatSyncRequest {
  name?: string;
  all?: boolean;
  preview?: boolean;
  skip_alias_lookup?: boolean;
  selected_models?: Array<{ name: string; alias: string }>;
  timeout_seconds?: number;
}

export interface OpenAICompatPreviewResponse {
  status?: string;
  provider?: string;
  models?: string[];
  fetched_count?: number;
  errors?: string[];
}

export interface OpenAICompatAliasLookupResponse {
  status?: string;
  matched?: Array<{ name: string; alias: string }>;
  unmatched?: string[];
}

export const providersApi = {
  previewOpenAICompatModels: (name: string) =>
    apiClient.post<OpenAICompatPreviewResponse>('/openai-compatibility/sync-models', {
      name,
      preview: true,
      skip_alias_lookup: true,
    }),

  lookupOpenAICompatAliases: (models: string[]) =>
    apiClient.post<OpenAICompatAliasLookupResponse>('/openai-compatibility/lookup-aliases', {
      models,
    }),

  syncOpenAICompatModels: (payload: OpenAICompatSyncRequest) =>
    apiClient.post('/openai-compatibility/sync-models', payload),
}
```

- [ ] **Step 4: 安装依赖并确认测试命令可运行**

Run:

```bash
cd "/Users/joslyn/.config/opencode-profiles/default/worktrees/Cli-Proxy-API-Management-Center/circuit-breaker-ui" && npm install
```

Expected:

```text
added 5 packages, and audited packages with 0 vulnerabilities
```

- [ ] **Step 5: 先跑空测试，确认基建可用**

Run:

```bash
cd "/Users/joslyn/.config/opencode-profiles/default/worktrees/Cli-Proxy-API-Management-Center/circuit-breaker-ui" && npm run test -- --passWithNoTests
```

Expected:

```text
No test files found, exiting with code 0
```

## Task 4: 先做弹窗组件，并用测试驱动关键交互

**Files:**
- Create/Test: `/Users/joslyn/.config/opencode-profiles/default/worktrees/Cli-Proxy-API-Management-Center/circuit-breaker-ui/src/components/system/OpenAICompatSyncModal.test.tsx`
- Create: `/Users/joslyn/.config/opencode-profiles/default/worktrees/Cli-Proxy-API-Management-Center/circuit-breaker-ui/src/components/system/OpenAICompatSyncModal.tsx`
- Create: `/Users/joslyn/.config/opencode-profiles/default/worktrees/Cli-Proxy-API-Management-Center/circuit-breaker-ui/src/components/system/OpenAICompatSyncModal.module.scss`

- [ ] **Step 1: 先写组件测试，覆盖选择、搜索、alias 校验**

```tsx
it('filters raw models and requires at least one selection before next step', async () => {
  const user = userEvent.setup();
  render(
    <OpenAICompatSyncModal
      open
      providerName="us-ci"
      rawModels={['kimi-k2.5', 'glm-5.1']}
      lookupLoading={false}
      saving={false}
      step="select"
      selectedModelNames={new Set()}
      aliasDrafts={{}}
      matchedModelNames={new Set()}
      onClose={vi.fn()}
      onBack={vi.fn()}
      onSearchChange={vi.fn()}
      onToggleModel={vi.fn()}
      onSelectVisible={vi.fn()}
      onClearSelection={vi.fn()}
      onSubmitSelection={vi.fn()}
      onAliasChange={vi.fn()}
      onConfirm={vi.fn()}
      search="glm"
    />
  );

  expect(screen.getByLabelText('搜索模型')).toHaveValue('glm');
  expect(screen.getByText('glm-5.1')).toBeInTheDocument();
  expect(screen.queryByText('kimi-k2.5')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '下一步：匹配 alias' })).toBeDisabled();
});

it('blocks confirm when any selected model alias is empty', async () => {
  render(
    <OpenAICompatSyncModal
      open
      providerName="us-ci"
      rawModels={['unknown-model']}
      lookupLoading={false}
      saving={false}
      step="alias"
      selectedModelNames={new Set(['unknown-model'])}
      aliasDrafts={{ 'unknown-model': '' }}
      matchedModelNames={new Set()}
      onClose={vi.fn()}
      onBack={vi.fn()}
      onSearchChange={vi.fn()}
      onToggleModel={vi.fn()}
      onSelectVisible={vi.fn()}
      onClearSelection={vi.fn()}
      onSubmitSelection={vi.fn()}
      onAliasChange={vi.fn()}
      onConfirm={vi.fn()}
      search=""
    />
  );

  expect(screen.getByRole('button', { name: '确认同步所选模型' })).toBeDisabled();
});
```

- [ ] **Step 2: 跑组件测试，确认现在还不存在组件**

Run:

```bash
cd "/Users/joslyn/.config/opencode-profiles/default/worktrees/Cli-Proxy-API-Management-Center/circuit-breaker-ui" && npm run test -- OpenAICompatSyncModal
```

Expected:

```text
FAIL
Cannot find module '@/components/system/OpenAICompatSyncModal'
或者测试运行时报出组件导出缺失
```

- [ ] **Step 3: 实现弹窗组件骨架**

```tsx
type SyncStep = 'select' | 'alias';

interface OpenAICompatSyncModalProps {
  open: boolean;
  providerName: string;
  rawModels: string[];
  selectedModelNames: Set<string>;
  matchedModelNames: Set<string>;
  aliasDrafts: Record<string, string>;
  search: string;
  step: SyncStep;
  lookupLoading: boolean;
  saving: boolean;
  onClose: () => void;
  onBack: () => void;
  onSearchChange: (value: string) => void;
  onToggleModel: (name: string) => void;
  onSelectVisible: () => void;
  onClearSelection: () => void;
  onSubmitSelection: () => void;
  onAliasChange: (name: string, value: string) => void;
  onConfirm: () => void;
}

export function OpenAICompatSyncModal(props: OpenAICompatSyncModalProps) {
  const { t } = useTranslation();
  const filteredModels = useMemo(() => {
    const keyword = props.search.trim().toLowerCase();
    if (!keyword) return props.rawModels;
    return props.rawModels.filter((name) => {
      const alias = (props.aliasDrafts[name] || '').toLowerCase();
      return name.toLowerCase().includes(keyword) || alias.includes(keyword);
    });
  }, [props.aliasDrafts, props.rawModels, props.search]);

  const canGoNext = props.selectedModelNames.size > 0 && !props.lookupLoading;
  const canConfirm = Array.from(props.selectedModelNames).every(
    (name) => props.aliasDrafts[name]?.trim().length
  );

  return (
    <Modal
      open={props.open}
      onClose={props.onClose}
      title={props.step === 'select' ? t('system_info.sync_models_modal_title_select', { provider: props.providerName }) : t('system_info.sync_models_modal_title_alias', { provider: props.providerName })}
      footer={props.step === 'select' ? (
        <>
          <Button variant="secondary" onClick={props.onClose}>{t('common.cancel')}</Button>
          <Button onClick={props.onSubmitSelection} disabled={!canGoNext}>{t('system_info.sync_models_next')}</Button>
        </>
      ) : (
        <>
          <Button variant="secondary" onClick={props.onBack}>{t('common.back')}</Button>
          <Button onClick={props.onConfirm} disabled={!canConfirm || props.saving} loading={props.saving}>{t('system_info.sync_models_confirm')}</Button>
        </>
      )}
      width={760}
    >
      {/* select / alias 两步内容 */}
    </Modal>
  );
}
```

- [ ] **Step 4: 补全两步内容与样式**

```tsx
{props.step === 'select' ? (
  <>
    <Input
      label={t('system_info.sync_models_search_label')}
      value={props.search}
      onChange={(e) => props.onSearchChange(e.currentTarget.value)}
      placeholder={t('system_info.sync_models_search_placeholder')}
    />
    <div className={styles.toolbar}>
      <Button size="sm" variant="secondary" onClick={props.onSelectVisible}>{t('system_info.sync_models_select_visible')}</Button>
      <Button size="sm" variant="ghost" onClick={props.onClearSelection}>{t('system_info.sync_models_clear_selection')}</Button>
      <span className={styles.count}>{t('system_info.sync_models_selected_count', { count: props.selectedModelNames.size })}</span>
    </div>
    <div className={styles.list}>
      {filteredModels.map((name) => (
        <SelectionCheckbox
          key={name}
          checked={props.selectedModelNames.has(name)}
          onChange={() => props.onToggleModel(name)}
          ariaLabel={name}
          className={styles.row}
          label={<div className={styles.modelName}>{name}</div>}
        />
      ))}
    </div>
  </>
) : (
  <div className={styles.aliasList}>
    {Array.from(props.selectedModelNames).map((name) => {
      const matched = props.matchedModelNames.has(name);
      return (
        <div key={name} className={styles.aliasRow}>
          <div className={styles.aliasMeta}>
            <div className={styles.modelName}>{name}</div>
            <div className={matched ? styles.matchedBadge : styles.unmatchedBadge}>
              {matched ? t('system_info.sync_models_alias_matched') : t('system_info.sync_models_alias_manual')}
            </div>
          </div>
          <Input
            value={props.aliasDrafts[name] ?? ''}
            onChange={(e) => props.onAliasChange(name, e.currentTarget.value)}
            placeholder={t('system_info.sync_models_alias_placeholder')}
          />
        </div>
      );
    })}
  </div>
)}
```

- [ ] **Step 5: 跑组件测试**

Run:

```bash
cd "/Users/joslyn/.config/opencode-profiles/default/worktrees/Cli-Proxy-API-Management-Center/circuit-breaker-ui" && npm run test -- OpenAICompatSyncModal
```

Expected:

```text
PASS
```

## Task 5: 把新流程接回 SystemPage 与文案

**Files:**
- Modify: `/Users/joslyn/.config/opencode-profiles/default/worktrees/Cli-Proxy-API-Management-Center/circuit-breaker-ui/src/pages/SystemPage.tsx`
- Modify: `/Users/joslyn/.config/opencode-profiles/default/worktrees/Cli-Proxy-API-Management-Center/circuit-breaker-ui/src/pages/SystemPage.module.scss`
- Modify: `/Users/joslyn/.config/opencode-profiles/default/worktrees/Cli-Proxy-API-Management-Center/circuit-breaker-ui/src/i18n/locales/zh-CN.json`
- Modify: `/Users/joslyn/.config/opencode-profiles/default/worktrees/Cli-Proxy-API-Management-Center/circuit-breaker-ui/src/i18n/locales/en.json`
- Modify: `/Users/joslyn/.config/opencode-profiles/default/worktrees/Cli-Proxy-API-Management-Center/circuit-breaker-ui/src/i18n/locales/ru.json`

- [ ] **Step 1: 在 SystemPage 里接入新的状态与请求流程**

```tsx
const [syncModalOpen, setSyncModalOpen] = useState(false);
const [syncModalStep, setSyncModalStep] = useState<'select' | 'alias'>('select');
const [rawModels, setRawModels] = useState<string[]>([]);
const [selectedModelNames, setSelectedModelNames] = useState<Set<string>>(new Set());
const [aliasDrafts, setAliasDrafts] = useState<Record<string, string>>({});
const [matchedModelNames, setMatchedModelNames] = useState<Set<string>>(new Set());
const [syncSearch, setSyncSearch] = useState('');
const [loadingRawModels, setLoadingRawModels] = useState(false);
const [lookupLoading, setLookupLoading] = useState(false);

const resetSyncModal = useCallback(() => {
  setSyncModalOpen(false);
  setSyncModalStep('select');
  setRawModels([]);
  setSelectedModelNames(new Set());
  setAliasDrafts({});
  setMatchedModelNames(new Set());
  setSyncSearch('');
}, []);

const handleFetchSyncModels = async () => {
  if (!selectedProvider) {
    showNotification(t('system_info.sync_models_select_first'), 'warning');
    return;
  }
  setLoadingRawModels(true);
  try {
    const res = await providersApi.previewOpenAICompatModels(selectedProvider);
    setRawModels(res.models ?? []);
    setSyncModalOpen(true);
    setSyncModalStep('select');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    showNotification(`${t('system_info.sync_models_failed')}: ${msg}`, 'error');
  } finally {
    setLoadingRawModels(false);
  }
};
```

- [ ] **Step 2: 接 alias 查询与最终确认保存**

```tsx
const handleSubmitSelection = async () => {
  if (selectedModelNames.size === 0) {
    showNotification(t('system_info.sync_models_select_at_least_one'), 'warning');
    return;
  }
  setLookupLoading(true);
  try {
    const names = Array.from(selectedModelNames);
    const res = await providersApi.lookupOpenAICompatAliases(names);
    const nextDrafts: Record<string, string> = {};
    const matchedSet = new Set<string>();
    names.forEach((name) => { nextDrafts[name] = ''; });
    (res.matched ?? []).forEach((item) => {
      nextDrafts[item.name] = item.alias;
      matchedSet.add(item.name);
    });
    setAliasDrafts(nextDrafts);
    setMatchedModelNames(matchedSet);
    setSyncModalStep('alias');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    showNotification(`${t('system_info.sync_models_alias_lookup_failed')}: ${msg}`, 'error');
  } finally {
    setLookupLoading(false);
  }
};

const handleConfirmSync = async () => {
  const payload = Array.from(selectedModelNames).map((name) => ({
    name,
    alias: (aliasDrafts[name] ?? '').trim(),
  }));
  if (payload.some((item) => !item.alias)) {
    showNotification(t('system_info.sync_models_alias_required'), 'warning');
    return;
  }
  setSyncingModels(true);
  try {
    await providersApi.syncOpenAICompatModels({
      name: selectedProvider,
      preview: false,
      selected_models: payload,
    });
    showNotification(t('system_info.sync_models_success'), 'success');
    resetSyncModal();
    await fetchModels({ forceRefresh: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    showNotification(`${t('system_info.sync_models_failed')}: ${msg}`, 'error');
  } finally {
    setSyncingModels(false);
  }
};
```

- [ ] **Step 3: 替换系统页按钮，并挂载新弹窗**

```tsx
<Button
  variant="primary"
  onClick={handleFetchSyncModels}
  loading={loadingRawModels}
  disabled={auth.connectionStatus !== 'connected' || !selectedProvider}
>
  {loadingRawModels ? t('system_info.sync_models_loading_list') : t('system_info.sync_models_button')}
</Button>

<OpenAICompatSyncModal
  open={syncModalOpen}
  providerName={selectedProvider}
  rawModels={rawModels}
  selectedModelNames={selectedModelNames}
  matchedModelNames={matchedModelNames}
  aliasDrafts={aliasDrafts}
  search={syncSearch}
  step={syncModalStep}
  lookupLoading={lookupLoading}
  saving={syncingModels}
  onClose={resetSyncModal}
  onBack={() => setSyncModalStep('select')}
  onSearchChange={setSyncSearch}
  onToggleModel={(name) => {
    setSelectedModelNames((prev) => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  }}
  onSelectVisible={() => setSelectedModelNames((prev) => new Set([...prev, ...rawModels.filter((name) => name.toLowerCase().includes(syncSearch.trim().toLowerCase()))]))}
  onClearSelection={() => setSelectedModelNames(new Set())}
  onSubmitSelection={() => void handleSubmitSelection()}
  onAliasChange={(name, value) => setAliasDrafts((prev) => ({ ...prev, [name]: value }))}
  onConfirm={() => void handleConfirmSync()}
/>
```

- [ ] **Step 4: 补齐 i18n 文案**

```json
"sync_models_loading_list": "获取中...",
"sync_models_select_at_least_one": "请至少选择一个模型",
"sync_models_search_label": "搜索模型",
"sync_models_search_placeholder": "按模型名或 alias 搜索",
"sync_models_select_visible": "全选当前列表",
"sync_models_clear_selection": "清空选择",
"sync_models_selected_count": "已选择 {{count}} 个模型",
"sync_models_next": "下一步：匹配 alias",
"sync_models_confirm": "确认同步所选模型",
"sync_models_alias_placeholder": "输入模型 alias",
"sync_models_alias_lookup_failed": "alias 匹配失败",
"sync_models_alias_required": "请为所有选中模型填写 alias",
"sync_models_alias_matched": "自动匹配",
"sync_models_alias_manual": "手动填写",
"sync_models_modal_title_select": "选择要同步的模型 - {{provider}}",
"sync_models_modal_title_alias": "确认模型 alias - {{provider}}"
```

- [ ] **Step 5: 跑前端测试，确认 SystemPage 接入未破坏弹窗交互**

Run:

```bash
cd "/Users/joslyn/.config/opencode-profiles/default/worktrees/Cli-Proxy-API-Management-Center/circuit-breaker-ui" && npm run test -- OpenAICompatSyncModal
```

Expected:

```text
PASS
```

## Task 6: 做最终验证，确保前后端都可通过

**Files:**
- Test: `/Users/joslyn/.config/opencode-profiles/default/worktrees/CLIProxyAPI/circuit-breaker-feature/internal/api/handlers/management/openai_compat_sync_test.go`
- Test: `/Users/joslyn/.config/opencode-profiles/default/worktrees/Cli-Proxy-API-Management-Center/circuit-breaker-ui/src/components/system/OpenAICompatSyncModal.test.tsx`

- [ ] **Step 1: 跑后端目标测试**

Run:

```bash
cd "/Users/joslyn/.config/opencode-profiles/default/worktrees/CLIProxyAPI/circuit-breaker-feature" && /Users/joslyn/local/go/bin/go test ./internal/api/handlers/management -run 'Test(SyncOpenAICompatModels|LookupOpenAICompatAliases)_' -v
```

Expected:

```text
PASS
```

- [ ] **Step 2: 跑前端单测**

Run:

```bash
cd "/Users/joslyn/.config/opencode-profiles/default/worktrees/Cli-Proxy-API-Management-Center/circuit-breaker-ui" && npm run test -- --run
```

Expected:

```text
PASS
```

- [ ] **Step 3: 跑前端静态检查**

Run:

```bash
cd "/Users/joslyn/.config/opencode-profiles/default/worktrees/Cli-Proxy-API-Management-Center/circuit-breaker-ui" && npm run lint && npm run type-check
```

Expected:

```text
eslint passed
tsc passed
```

- [ ] **Step 4: 跑前端构建**

Run:

```bash
cd "/Users/joslyn/.config/opencode-profiles/default/worktrees/Cli-Proxy-API-Management-Center/circuit-breaker-ui" && npm run build
```

Expected:

```text
vite build completed successfully
```

- [ ] **Step 5: 做一次端到端手工验证**

```text
1. 打开 System 页面
2. 选择一个 OpenAI 兼容 provider
3. 点击“获取模型列表”
4. 在弹窗第一步搜索并勾选部分模型
5. 点击“下一步：匹配 alias”
6. 确认已匹配模型自动带出 alias，且可编辑
7. 确认未匹配模型需要手工输入 alias
8. 点击“确认同步所选模型”
9. 回到系统页后刷新模型列表，确认只展示已选择模型
10. 检查后端配置文件，确认 provider.models 已被替换
```

## Self-Review

- **Spec coverage:** 已覆盖 preview 原始模型、按选择后匹配 alias、已匹配 alias 可编辑、未匹配 alias 必填、最终替换 provider models、前后端测试与最终验证。
- **Placeholder scan:** 已移除截断文案与泛化表述，没有 `TODO` / `TBD` / “类似 Task N”。
- **Type consistency:** 前后端统一使用 `preview`、`skip_alias_lookup`、`selected_models`、`matched`、`unmatched`、`aliasDrafts` 等命名。

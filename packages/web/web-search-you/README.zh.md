# @deepseek-ai/dsh-web-search-you

[English](README.md) | 中文

这是由 [You.com Web Search API](https://documentation.you.com/) 驱动的 harness [web 能力](../web/README.zh.md)（`ctx.web`）提供方。它使用直连 API 的 `X-API-Key` 认证调用 `POST /v1/search`，将 `results.web[]` 与 `results.news[]` 映射为规范化来源，不返回生成式回答内容。

本实现向 `ctx.web` 注册提供方；面向模型的 `web_search` 工具由 [`@deepseek-ai/dsh-tool-web`](../tool-web/README.zh.md) 负责。

## 配置

| 键 | 默认值 | 含义 |
|---|---|---|
| `apiKey` | （未设置） | 字面量直连 You.com API 密钥。优先使用 `apiKeyEnv`，避免密钥进入配置文件。 |
| `apiKeyEnv` | `YDC_API_KEY` | 每次搜索通过 `ctx.credentials` 解析的凭据引用；该服务缺失时从启动环境解析。值缺失时调用以 `WEB_PROVIDER_CREDENTIAL_MISSING` 失败。 |
| `baseURL` | `https://ydc-index.io/v1` | API 基址；会追加 `/search`。不可解析的值会使提供方不可用。 |
| `numResults` | `10` | 请求未指定 `maxResults` 时发送的数量。必须是正整数。 |

```yaml
- id: web-search-you
  name: '@deepseek-ai/dsh-web-search-you'
  config:
    apiKeyEnv: YDC_API_KEY
```

## 映射与失败

提供方先拼接网页结果，再拼接新闻结果。结果必须包含非空 `url`；存在时映射 `title`，`snippet` 取首个非空 `snippets[]` 条目，或回退至 `description`，`publishedAt` 取 `page_age`。服务负责强制最终 `maxResults` 上限。网络失败、HTTP 错误、畸形结果分组和无法读取的响应体都会成为 `WEB_PROVIDER_ERROR`；标准 fetch 取消成为 `WEB_ABORTED`。

## 模型体验

通过 [`dsh-tool-web`](../tool-web/README.zh.md) 间接体现：该工具会在现有 `web_search` 输出中公开规范化 URL、标题、摘要与发布时间信息，不会新增模型工具、提示词文案或来源字段。

#### KV Cache 影响

不会直接导致失效；模型请求前缀变更由工具消费方负责。

## 已知限制与暂缓事项

- 直连 API 默认需要置于 `YDC_API_KEY` 下的密钥。You.com 的免密钥免费层是 MCP 端点，不会作为标准 `web_search` 提供方的隐式兜底。
- 提供方只发送 `query` 与 `count`；域名、新近程度、地区及其他 You.com 控制项等待 `WebSearchRequest` 上提供方无关的字段。
- `page_age` 会保留为提供方展示字符串，不会解析为时间戳。

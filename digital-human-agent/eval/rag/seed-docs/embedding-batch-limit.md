# Embedding batch size 限制

当供应商返回 batch size is invalid，或者提示批量大小不能超过 10，通常说明一次提交给 Embedding 接口的文本数量超过了供应商限制。

在当前项目里，OpenAIEmbeddings 的 batchSize 需要小于等于 10。建议通过 EMBEDDINGS_BATCH_SIZE 环境变量或 OpenAIEmbeddings 初始化配置限制 batchSize，默认值也应限制在 1 到 10 之间。

验证方式是重新上传同一份知识库文档，观察日志中的 batchSize 是否不超过 10，并确认 embedding 写入完成。

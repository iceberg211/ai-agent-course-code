function lines(items: string[]): string {
  return items.join('\n');
}

export const PROMPT_REGISTRY = {
  agentChat: {
    system: `你是{personaName}。{personaDescription}
你的说话风格：{speakingStyle}
你的专业领域：{expertise}

以下是与当前问题相关的本地知识（按相关性排列）：
---
{knowledgeBlock}
---
{webKnowledgeSection}
{evidenceAssessmentSection}

要求：
1. 始终以{personaName}的身份回答
2. 回答必须基于上述上下文，不要编造不在上下文中的内容
3. 如果本地知识和联网补充仍然不足，诚实说"这个我不太清楚"或"目前无法从上下文确认"
4. 语气和用词要符合角色人设
5. 回答要口语化，适合语音朗读（避免长列表、代码块、复杂格式）
6. 回答时自然地提及信息来源，例如"根据文档里的说明..."、"根据网页资料..."
7. 如果本地知识包含图谱证据，把它作为实体关系线索，但不要脱离证据自行扩展关系
8. 如果用了联网补充信息，优先提及标题或链接来源；如果本地知识与网页信息存在冲突，要说明不确定性{systemPromptExtraSection}`,
    human: '{userMessage}',
  },
  ragRoute: {
    system: lines([
      '你是数字人 RAG 工作流的路由器。',
      '任务：判断当前问题更适合走 simple 还是 complex。',
      'simple：单次检索加一次生成通常就够，问题比较直接、单一、无需明显拆分步骤。',
      'complex：问题涉及多实体关系、时间先后、因果链、对比、多子问题，后续更适合接多跳或多轮检索。',
      '只做路由判断，不回答问题。',
      '只输出符合结构化 schema 的 JSON 对象。',
      'JSON 示例：{{"strategy":"simple","reason":"问题直接，单次检索即可"}}。',
    ]),
    human: '用户问题：{question}',
  },
  ragRetrievalStrategy: {
    system: lines([
      '你是数字人 RAG 的检索策略规划器。',
      '任务：判断当前问题是否需要查知识库，以及应该启用哪些检索通道。',
      '字段说明：',
      'needRetrieval：纯寒暄、闲聊、无需知识库事实时为 false。',
      'useVector：语义模糊匹配、概念性问题、同义表达时为 true。',
      'useKeyword：包含实体名、术语、文件名、编号、短语时为 true。',
      'useGraph：问题询问实体关系、层级关系、流程依赖、参与方关系、条款之间的关联时为 true。',
      'useExactPhrase：包含明确实体、标题、文件名、引用短句时为 true。',
      'useMultiQuery：问题表述模糊或需要多角度召回时为 true。',
      'useHyDE：问题偏概念、描述性，适合用假设答案做额外向量召回时为 true。',
      "graphMode：useGraph=true 时优先使用 'path'，只有只需一跳邻接关系时才使用 'neighbors'。",
      'graphMaxHops：useGraph=true 且 graphMode=path 时设为 2，最多 3。',
      'chunkContextWindow：是否把命中段落前后相邻段落带入最终上下文；默认 0，只有需要连续上下文时设为 1，最大 2。',
      'parentContext：是否把命中的小段扩展为同文档大块上下文；默认 false，只有问题需要连续解释、条款上下文或段落前后因果时设为 true。',
      'parentContextMaxChars：parentContext 开启时每个命中大块的最大字符数；默认 2000，范围 500 到 4000。',
      'allowWeb：本地证据不足时是否允许联网补充。',
      '不要回答用户问题，只输出符合结构化 schema 的 JSON 策略对象。',
      'JSON 示例：{{"needRetrieval":true,"useVector":true,"useKeyword":true,"useGraph":true,"useExactPhrase":false,"useMultiQuery":true,"useHyDE":false,"allowWeb":true,"queryCount":3,"graphMode":"path","graphMaxHops":2,"reason":"关系类问题需要图谱和混合检索"}}。',
    ]),
    human: lines([
      '原始问题：{question}',
      '当前检索问题：{currentQuery}',
      '路线：{routeStrategy}',
      '剩余跳数：{remainingHops}',
    ]),
  },
  multiHopPlanner: {
    system: lines([
      '你是数字人 RAG 的多跳规划器。',
      '任务：把复杂问题拆成 1 到 6 条有顺序的子问题，供后续多轮检索使用。',
      '要求：',
      '1. 每条子问题都必须是完整、可独立检索的中文问句。',
      '2. 不要使用“他/她/这个人/上述”这类指代，必要时补全实体名。',
      '3. 顺序要体现推理链，先前置事实，再后续结论。',
      '4. 不要把原问题整句机械复制多次，也不要拆成关键词碎片。',
      '5. 当前只负责规划，不负责回答。',
      '6. 只输出符合结构化 schema 的 JSON 对象。',
      'JSON 示例：{{"subQuestions":["系统定位和智能检索是什么关系？"],"reason":"围绕关系问题先检索直接证据"}}。',
    ]),
    human: '原始问题：{question}',
  },
  ragEvidenceEvaluator: {
    system: lines([
      '你是数字人 RAG 的证据充分性评估器。',
      '任务：判断当前证据是否足以回答用户问题，不直接回答问题。',
      '输出要求：',
      '1. enough 表示当前证据是否足够。',
      '2. missingFacts 只列缺失的关键信息点，最多 6 条。',
      '3. reason 简洁说明判断依据。',
      '4. webQuery 用于联网搜索，只有在当前证据不足时才给出；要写成完整中文搜索句，避免代词。',
      '5. 如果已有联网结果且仍不足，可以继续给出更聚焦的 webQuery。',
      '6. 只输出符合结构化 schema 的 JSON 对象。',
      'JSON 示例：{{"enough":true,"missingFacts":[],"reason":"本地证据已覆盖问题所需关系","webQuery":""}}。',
    ]),
    human: lines([
      '用户问题：{question}',
      '当前已执行跳数：{currentHop}/{maxHops}',
      '剩余未检索子问题数：{remainingSubQuestionCount}',
      '',
      '本地证据：',
      '{localEvidenceBlock}',
      '',
      '联网补充：',
      '{webEvidenceBlock}',
    ]),
  },
  knowledgeQueryRewrite: {
    system: lines([
      '你是知识库检索的 Query Rewrite 助手。',
      '你的任务是把用户问题改写成更适合检索的一条中文查询句，抽取关键词，并给出 3 条不同角度的检索 query。',
      '要求：',
      '1. 保留原问题里的核心实体、时间、版本、约束条件。',
      '2. 去掉寒暄、口语赘述和生成式表达，但不要补充原问题没有的事实。',
      '3. 如果原问题已经适合检索，可以原样返回。',
      '4. keywords 只输出 1 到 6 个短语，优先实体名、事件名、版本名、术语，不要输出整段长句。',
      '5. expandedQueries 必须输出 3 条，用于多路召回；第一条通常保留 original 或 rewrittenQuery，后续从 entity、semantic、detail、symptom 角度补充。',
      '6. 只针对检索改写，不负责回答问题。',
      '7. 只输出符合结构化 schema 的 JSON 对象。',
      'JSON 示例：{{"rewrittenQuery":"系统定位和智能检索是什么关系？","keywords":["系统定位","智能检索"],"expandedQueries":[{{"query":"系统定位和智能检索是什么关系？","keywords":["系统定位","智能检索"],"angle":"original"}},{{"query":"系统定位 智能检索 包含子主题","keywords":["系统定位","智能检索","包含子主题"],"angle":"entity"}},{{"query":"系统定位下的智能检索能力说明","keywords":["系统定位","智能检索"],"angle":"semantic"}}],"reason":"保留核心实体并扩展关系检索角度"}}。',
    ]),
    human: '原始问题：{query}',
  },
  knowledgeHyde: {
    system: lines([
      '你是知识库检索的 HyDE 助手。',
      '任务：根据用户问题写一段“可能出现在资料里的假设性答案文本”，只用于向量召回。',
      '要求：',
      '1. 不要声称这是真实答案。',
      '2. 保留问题里的实体、时间、约束。',
      '3. 控制在 120 字以内。',
      '4. 不要输出 Markdown。',
    ]),
    human: '用户问题：{query}',
  },
  knowledgeContextualRetrieval: {
    system: lines([
      '你是知识库 ingest 阶段的上下文增强助手。',
      '任务：根据完整文档和当前 chunk，写一小段能帮助检索理解该 chunk 的文档级上下文。',
      '要求：',
      '1. 只说明该 chunk 在文档中的主题、对象、约束或章节位置。',
      '2. 不要回答用户问题，不要补充文档里没有的事实。',
      '3. 控制在 80 字以内。',
      '4. 不要输出 Markdown，不要加引号。',
    ]),
    human: lines([
      '文件名：{filename}',
      '',
      '文档摘录：',
      '{documentExcerpt}',
      '',
      '当前 chunk：',
      '{chunkContent}',
    ]),
  },
  knowledgeRerank: {
    system:
      '你是知识检索重排器。请根据用户问题评估每个候选片段的相关性分数。只返回 JSON 数组，不要 Markdown，不要额外解释。格式必须是 [{{"index":0,"score":8.6}}]，score 范围 0-10。',
    human: '{inputJson}',
  },
} as const;

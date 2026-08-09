export function containsGraphTerms(text: string): boolean {
  return /关系|关联|包含|层级|上下游|依赖|参与方|甲方|乙方|流程/u.test(
    text,
  );
}

export function isGreeting(query: string): boolean {
  return /^(你好|您好|嗨|hi|hello|哈喽|谢谢|多谢)[。！!？?]*$/iu.test(
    query.replace(/\s+/g, ''),
  );
}

export function isExactLookup(query: string): boolean {
  return /《|》|"|'|\.md|\.txt|编号|订单|合同|条款|第.+章|第.+条/u.test(
    query,
  );
}

export function isGraphQuestion(query: string): boolean {
  return containsGraphTerms(query);
}

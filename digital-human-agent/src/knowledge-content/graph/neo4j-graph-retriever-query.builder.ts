export function buildNeo4jGraphRetrieveQuery(
  graphMode: 'neighbors' | 'path' | undefined,
  graphMaxHops: number | undefined,
): string {
  const maxHops = normalizeNeo4jGraphMaxHops(graphMaxHops);
  return graphMode === 'path' ? buildPathQuery(maxHops) : NEIGHBOR_QUERY;
}

export function buildNeo4jGraphSearchTerms(
  keywordTerms: string[],
  retrievalQuery: string,
): string[] {
  return Array.from(
    new Set(
      [...keywordTerms, retrievalQuery]
        .map((term) => term.replace(/\s+/g, ' ').trim().toLowerCase())
        .filter((term) => term.length > 0)
        .slice(0, 8),
    ),
  );
}

export function normalizeNeo4jGraphMaxHops(value: number | undefined): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 1;
  return Math.min(3, Math.max(1, Math.trunc(parsed)));
}

const NEIGHBOR_QUERY = `
        MATCH (c:KnowledgeChunk {knowledgeId: $knowledgeId})
        WHERE c.enabled = true
        OPTIONAL MATCH (source:GraphNode)-[rel]->(target:GraphNode)
        WHERE rel.chunkId = c.id
        WITH c, collect(
          CASE WHEN rel IS NULL THEN null ELSE {
            source: source.displayName,
            target: target.displayName,
            relationType: coalesce(rel.relationType, type(rel)),
            relationLabel: rel.relationLabel,
            evidenceText: rel.evidenceText,
            confidence: coalesce(rel.confidence, 0.5)
          } END
        ) AS rawEvidence
        WITH c, [item IN rawEvidence WHERE item IS NOT NULL] AS evidence
        WITH
          c,
          evidence,
          size([
            term IN $terms
            WHERE
              toLower(coalesce(c.content, '')) CONTAINS term
              OR toLower(coalesce(c.source, '')) CONTAINS term
              OR toLower(coalesce(c.category, '')) CONTAINS term
          ]) AS chunkMatches,
          size([
            item IN evidence
            WHERE any(term IN $terms WHERE
              toLower(
                coalesce(item.source, '') + ' ' +
                coalesce(item.target, '') + ' ' +
                coalesce(item.relationType, '') + ' ' +
                coalesce(item.relationLabel, '') + ' ' +
                coalesce(item.evidenceText, '')
              ) CONTAINS term
            )
          ]) AS graphMatches,
          reduce(score = 0.0, item IN evidence | score + coalesce(toFloat(item.confidence), 0.5)) AS confidenceSum
        WHERE chunkMatches > 0 OR graphMatches > 0
        RETURN
          c.id AS id,
          c.documentId AS document_id,
          c.knowledgeId AS knowledge_base_id,
          c.content AS content,
          c.source AS source,
          c.chunkIndex AS chunk_index,
          c.category AS category,
          (chunkMatches * 0.2 + graphMatches * 0.6 + confidenceSum * 0.05) AS graph_score,
          evidence[..5] AS graph_evidence
        ORDER BY graph_score DESC, c.chunkIndex ASC
        LIMIT toInteger($matchCount)
`;

function buildPathQuery(maxHops: number): string {
  return `
        MATCH (c:KnowledgeChunk {knowledgeId: $knowledgeId})
        WHERE c.enabled = true
        OPTIONAL MATCH (source:GraphNode)-[rel]->(target:GraphNode)
        WHERE rel.chunkId = c.id
        WITH c, collect(
          CASE WHEN rel IS NULL THEN null ELSE {
            source: source.displayName,
            target: target.displayName,
            relationType: coalesce(rel.relationType, type(rel)),
            relationLabel: rel.relationLabel,
            evidenceText: rel.evidenceText,
            confidence: coalesce(rel.confidence, 0.5)
          } END
        ) AS rawEvidence
        WITH c, [item IN rawEvidence WHERE item IS NOT NULL] AS evidence
        OPTIONAL MATCH path = (:GraphNode)-[pathRels*1..${maxHops}]-(:GraphNode)
        WHERE any(pathRel IN pathRels WHERE pathRel.chunkId = c.id)
        WITH c, evidence, collect(path) AS paths
        WITH
          c,
          evidence,
          size([
            term IN $terms
            WHERE
              toLower(coalesce(c.content, '')) CONTAINS term
              OR toLower(coalesce(c.source, '')) CONTAINS term
              OR toLower(coalesce(c.category, '')) CONTAINS term
          ]) AS chunkMatches,
          size([
            item IN evidence
            WHERE any(term IN $terms WHERE
              toLower(
                coalesce(item.source, '') + ' ' +
                coalesce(item.target, '') + ' ' +
                coalesce(item.relationType, '') + ' ' +
                coalesce(item.relationLabel, '') + ' ' +
                coalesce(item.evidenceText, '')
              ) CONTAINS term
            )
          ]) AS graphMatches,
          size([
            currentPath IN paths
            WHERE any(term IN $terms WHERE
              any(pathNode IN nodes(currentPath) WHERE
                toLower(
                  coalesce(pathNode.displayName, '') + ' ' +
                  coalesce(pathNode.normalizedName, '') + ' ' +
                  coalesce(pathNode.entityType, '')
                ) CONTAINS term
              )
              OR any(pathRel IN relationships(currentPath) WHERE
                toLower(
                  coalesce(pathRel.relationType, '') + ' ' +
                  coalesce(pathRel.relationLabel, '') + ' ' +
                  coalesce(pathRel.evidenceText, '')
                ) CONTAINS term
              )
            )
          ]) AS pathMatches,
          reduce(score = 0.0, item IN evidence | score + coalesce(toFloat(item.confidence), 0.5)) AS confidenceSum
        WHERE chunkMatches > 0 OR graphMatches > 0 OR pathMatches > 0
        RETURN
          c.id AS id,
          c.documentId AS document_id,
          c.knowledgeId AS knowledge_base_id,
          c.content AS content,
          c.source AS source,
          c.chunkIndex AS chunk_index,
          c.category AS category,
          (chunkMatches * 0.2 + graphMatches * 0.6 + pathMatches * 0.8 + confidenceSum * 0.05) AS graph_score,
          evidence[..5] AS graph_evidence
        ORDER BY graph_score DESC, c.chunkIndex ASC
        LIMIT toInteger($matchCount)
      `;
}

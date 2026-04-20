import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { KnowledgeBaseService } from '../src/knowledge-base/knowledge-base.service';
import { KnowledgeService } from '../src/knowledge/knowledge.service';
import { PersonaService } from '../src/persona/persona.service';
import type { KnowledgeBase } from '../src/knowledge-base/knowledge-base.entity';
import type { Persona } from '../src/persona/persona.entity';

interface SeedConfig {
  datasetId: string;
  personas: Array<{
    key: string;
    name: string;
    description?: string;
    speakingStyle?: string;
    expertise?: string[];
  }>;
  knowledgeBases: Array<{
    key: string;
    name: string;
    description?: string;
    attachToPersonaKeys?: string[];
    documents?: Array<{
      sourceName: string;
      path: string;
      category?: string;
    }>;
  }>;
}

export interface RagSeedResult {
  personaByKey: Record<string, string>;
  knowledgeBaseByKey: Record<string, string>;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf-8')) as T;
}

function seedPath(...segments: string[]): string {
  return resolve(process.cwd(), ...segments);
}

export async function seedEvalDataset(
  app: INestApplicationContext,
): Promise<RagSeedResult> {
  const personaService = app.get(PersonaService);
  const kbService = app.get(KnowledgeBaseService);
  const knowledgeService = app.get(KnowledgeService);
  const config = readJson<SeedConfig>(seedPath('eval/rag/rag-eval.seed.json'));

  const personaByKey: Record<string, Persona> = {};
  const existingPersonas = await personaService.findAll();
  for (const item of config.personas) {
    let persona = existingPersonas.find((p) => p.name === item.name);
    if (!persona) {
      persona = await personaService.create({
        name: item.name,
        description: item.description,
        speakingStyle: item.speakingStyle,
        expertise: item.expertise,
      });
      existingPersonas.push(persona);
    }
    personaByKey[item.key] = persona;
  }

  const knowledgeBaseByKey: Record<string, KnowledgeBase> = {};
  const existingKbs = await kbService.listAll();
  for (const item of config.knowledgeBases) {
    let kb = existingKbs.find((candidate) => candidate.name === item.name);
    if (!kb) {
      kb = await kbService.create({
        name: item.name,
        description: item.description,
      });
      existingKbs.push(kb);
    }
    knowledgeBaseByKey[item.key] = kb;

    for (const personaKey of item.attachToPersonaKeys ?? []) {
      const persona = personaByKey[personaKey];
      if (!persona) continue;
      try {
        await kbService.attachPersona(persona.id, kb.id);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!message.includes('已挂载')) throw error;
      }
    }

    const existingDocs = await knowledgeService.listDocumentsByKb(kb.id);
    for (const doc of item.documents ?? []) {
      const current = existingDocs.find((d) => d.filename === doc.sourceName);
      if (current?.status === 'completed') continue;
      if (current) {
        await knowledgeService.deleteDocument(current.id);
      }
      const content = readFileSync(seedPath(doc.path), 'utf-8');
      await knowledgeService.ingestDocument(kb.id, doc.sourceName, content, {
        mimeType: 'text/markdown',
        fileSize: Buffer.byteLength(content),
        category: doc.category,
      });
    }
  }

  return {
    personaByKey: Object.fromEntries(
      Object.entries(personaByKey).map(([key, persona]) => [key, persona.id]),
    ),
    knowledgeBaseByKey: Object.fromEntries(
      Object.entries(knowledgeBaseByKey).map(([key, kb]) => [key, kb.id]),
    ),
  };
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  try {
    const result = await seedEvalDataset(app);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

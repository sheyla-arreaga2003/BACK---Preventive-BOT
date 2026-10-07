import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

export type DocumentAudience = "admin" | "client";
export type DocumentStatus = "active" | "withdrawn";

export interface DocumentChunk {
  id: string;
  section: string;
  page: number | null;
  text: string;
}

export interface IndexedDocument {
  documentId: string;
  title: string;
  version: string;
  source: string;
  effectiveDate: string | null;
  audience: DocumentAudience[];
  status: DocumentStatus;
  contentHash: string;
  chunks: DocumentChunk[];
}

export interface DocumentIndex {
  schemaVersion: 1;
  generatedAt: string;
  documents: IndexedDocument[];
}

export interface DocumentEvidence {
  documentId: string;
  title: string;
  version: string;
  section: string;
  page: number | null;
  effectiveDate: string | null;
  excerpt: string;
}

export interface DocumentSearch {
  search(query: string, audience: DocumentAudience, limit: number): Promise<DocumentEvidence[]>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readIndex(value: unknown): DocumentIndex {
  if (!isRecord(value) || value.schemaVersion !== 1 || !Array.isArray(value.documents)) {
    throw new TypeError("El índice documental no tiene un formato válido");
  }
  const documents: IndexedDocument[] = value.documents.map((item) => {
    if (!isRecord(item) || typeof item.documentId !== "string" || typeof item.title !== "string"
      || typeof item.version !== "string" || typeof item.source !== "string"
      || (item.effectiveDate !== null && typeof item.effectiveDate !== "string")
      || !Array.isArray(item.audience) || !item.audience.every((entry) => entry === "admin" || entry === "client")
      || (item.status !== "active" && item.status !== "withdrawn") || typeof item.contentHash !== "string"
      || !Array.isArray(item.chunks)) {
      throw new TypeError("El índice documental contiene un documento inválido");
    }
    const chunks: DocumentChunk[] = item.chunks.map((chunk) => {
      if (!isRecord(chunk) || typeof chunk.id !== "string" || typeof chunk.section !== "string"
        || (chunk.page !== null && (!Number.isInteger(chunk.page) || Number(chunk.page) < 1))
        || typeof chunk.text !== "string") {
        throw new TypeError("El índice documental contiene un fragmento inválido");
      }
      return { id: chunk.id, section: chunk.section, page: chunk.page as number | null, text: chunk.text };
    });
    return {
      documentId: item.documentId,
      title: item.title,
      version: item.version,
      source: item.source,
      effectiveDate: item.effectiveDate,
      audience: [...new Set(item.audience)] as DocumentAudience[],
      status: item.status,
      contentHash: item.contentHash,
      chunks,
    };
  });
  const versions = new Set<string>();
  const hashes = new Set<string>();
  for (const document of documents) {
    const versionKey = `${document.documentId}:${document.version}`;
    if (versions.has(versionKey) || hashes.has(document.contentHash)) {
      throw new TypeError("El índice documental contiene documentos duplicados");
    }
    versions.add(versionKey);
    hashes.add(document.contentHash);
  }
  return { schemaVersion: 1, generatedAt: typeof value.generatedAt === "string" ? value.generatedAt : "", documents };
}

function terms(value: string): string[] {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es-GT").match(/[a-z0-9]{3,}/g) ?? [];
}

function score(query: readonly string[], text: string): number {
  const haystack = new Set(terms(text));
  return query.reduce((total, term) => total + (haystack.has(term) ? 1 : 0), 0);
}

export function contentHash(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export function createFileDocumentSearch(indexPath: string): DocumentSearch {
  return {
    async search(query, audience, limit) {
      const parsed: unknown = JSON.parse(await readFile(indexPath, "utf8"));
      const index = readIndex(parsed);
      const queryTerms = terms(query);
      if (queryTerms.length === 0) return [];
      return index.documents
        .filter((document) => document.status === "active" && document.audience.includes(audience))
        .flatMap((document) => document.chunks.map((chunk) => ({ document, chunk, rank: score(queryTerms, `${chunk.section} ${chunk.text}`) })))
        .filter((candidate) => candidate.rank > 0)
        .sort((left, right) => right.rank - left.rank || left.document.documentId.localeCompare(right.document.documentId)
          || left.chunk.id.localeCompare(right.chunk.id))
        .slice(0, limit)
        .map(({ document, chunk }) => ({
          documentId: document.documentId,
          title: document.title,
          version: document.version,
          section: chunk.section,
          page: chunk.page,
          effectiveDate: document.effectiveDate,
          excerpt: chunk.text,
        }));
    },
  };
}

export function emptyDocumentSearch(): DocumentSearch {
  return { async search() { return []; } };
}

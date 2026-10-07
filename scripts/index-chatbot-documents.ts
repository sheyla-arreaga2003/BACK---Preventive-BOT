import "dotenv/config";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { z } from "zod";
import { contentHash, type DocumentIndex, type IndexedDocument } from "../src/rag/document-index.js";

const manifestSchema = z.object({
  documents: z.array(z.object({
    documentId: z.string().trim().min(1),
    title: z.string().trim().min(1),
    version: z.string().trim().min(1),
    file: z.string().trim().min(1),
    effectiveDate: z.string().trim().min(1).nullable().default(null),
    audience: z.array(z.enum(["admin", "client"])).min(1),
    status: z.enum(["active", "withdrawn"]).default("active"),
  }).strict()),
}).strict();

function chunks(content: string): IndexedDocument["chunks"] {
  const paragraphs = content.replace(/\r\n/g, "\n").split(/\n{2,}/).map((value) => value.trim()).filter(Boolean);
  let section = "Contenido";
  return paragraphs.map((paragraph, index) => {
    const heading = paragraph.match(/^#{1,6}\s+(.+)$/);
    if (heading?.[1]) section = heading[1].trim();
    return { id: String(index + 1), section, page: null, text: paragraph };
  });
}

const manifestPath = resolve(process.argv[2] ?? "rag/documents.manifest.json");
const indexPath = resolve(process.env.CHATBOT_DOCUMENT_INDEX_PATH?.trim() || "var/chatbot-documents/index.json");
const manifest = manifestSchema.parse(JSON.parse(await readFile(manifestPath, "utf8")) as unknown);
const seenHashes = new Set<string>();
const seenVersions = new Set<string>();
const documents: IndexedDocument[] = [];

for (const entry of manifest.documents) {
  const versionKey = `${entry.documentId}:${entry.version}`;
  if (seenVersions.has(versionKey)) throw new Error(`Documento y versión duplicados: ${versionKey}`);
  seenVersions.add(versionKey);
  const source = resolve(dirname(manifestPath), entry.file);
  if (![".md", ".txt"].includes(extname(source).toLowerCase())) throw new Error("Solo se admiten documentos .md y .txt");
  const content = await readFile(source, "utf8");
  const hash = contentHash(content);
  if (seenHashes.has(hash)) throw new Error(`Contenido duplicado: ${entry.documentId}`);
  seenHashes.add(hash);
  documents.push({
    documentId: entry.documentId,
    title: entry.title,
    version: entry.version,
    source: entry.file,
    effectiveDate: entry.effectiveDate,
    audience: [...new Set(entry.audience)],
    status: entry.status,
    contentHash: hash,
    chunks: chunks(content),
  });
}

const index: DocumentIndex = { schemaVersion: 1, generatedAt: new Date().toISOString(), documents };
await mkdir(dirname(indexPath), { recursive: true });
const temporaryPath = `${indexPath}.tmp`;
await writeFile(temporaryPath, `${JSON.stringify(index, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
await rename(temporaryPath, indexPath);
console.info(`Índice documental preparado: ${documents.length} documento(s).`);

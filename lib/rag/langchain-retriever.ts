import { Document } from "@langchain/core/documents";
import { BaseRetriever } from "@langchain/core/retrievers";

import {
  retrieveDocumentChunks,
  type RetrievedChunk,
} from "@/lib/rag/retriever";

export type StudyMateRetrieverOptions = {
  chatId: string;
  limit?: number;
  minimumSimilarity?: number;
};

export class StudyMateRetriever extends BaseRetriever {
  lc_namespace = [
    "studymate",
    "rag",
    "retriever",
  ];

  private readonly chatId: string;
  private readonly limit: number;
  private readonly minimumSimilarity: number;

  constructor(
    options: StudyMateRetrieverOptions
  ) {
    super();

    this.chatId = options.chatId;
    this.limit = options.limit ?? 4;
    this.minimumSimilarity =
      options.minimumSimilarity ?? 0.35;
  }

  async _getRelevantDocuments(
    query: string
  ): Promise<Document[]> {
    const chunks =
      await retrieveDocumentChunks({
        chatId: this.chatId,
        query,
        limit: this.limit,
        minimumSimilarity:
          this.minimumSimilarity,
      });

    return chunks.map(
      (chunk: RetrievedChunk) =>
        new Document({
          pageContent: chunk.content,

          metadata: {
            chunkId: chunk.chunkId,
            documentId:
              chunk.documentId,
            documentName:
              chunk.documentName,
            chunkIndex:
              chunk.chunkIndex,
            pageNumber:
              chunk.pageNumber,
            similarity:
              chunk.similarity,
          },
        })
    );
  }
}
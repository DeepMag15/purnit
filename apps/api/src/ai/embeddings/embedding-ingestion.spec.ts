import type { PrismaTx } from "../../tenancy/tenant-prisma.service";
import { enqueueEmbeddingJob } from "./embedding-ingestion";

describe("enqueueEmbeddingJob", () => {
  it("creates a job row for an extractable MIME type", async () => {
    const tx = { embeddingJob: { create: jest.fn().mockResolvedValue({}) } } as unknown as PrismaTx;
    await enqueueEmbeddingJob(tx, "t1", "document", "d1", "application/pdf");
    expect((tx as unknown as { embeddingJob: { create: jest.Mock } }).embeddingJob.create).toHaveBeenCalledWith({
      data: { tenantId: "t1", sourceType: "document", sourceId: "d1" },
    });
  });

  it("no-ops for a MIME type Phase B doesn't extract text from", async () => {
    const tx = { embeddingJob: { create: jest.fn() } } as unknown as PrismaTx;
    await enqueueEmbeddingJob(tx, "t1", "document", "d1", "image/png");
    expect((tx as unknown as { embeddingJob: { create: jest.Mock } }).embeddingJob.create).not.toHaveBeenCalled();
  });

  it.each(["text/plain", "text/csv", "application/pdf"])("enqueues for extractable type %s", async (mimeType) => {
    const tx = { embeddingJob: { create: jest.fn().mockResolvedValue({}) } } as unknown as PrismaTx;
    await enqueueEmbeddingJob(tx, "t1", "document", "d1", mimeType);
    expect((tx as unknown as { embeddingJob: { create: jest.Mock } }).embeddingJob.create).toHaveBeenCalledTimes(1);
  });

  it.each(["application/msword", "application/zip", "image/jpeg"])("no-ops for non-extractable type %s", async (mimeType) => {
    const tx = { embeddingJob: { create: jest.fn() } } as unknown as PrismaTx;
    await enqueueEmbeddingJob(tx, "t1", "document", "d1", mimeType);
    expect((tx as unknown as { embeddingJob: { create: jest.Mock } }).embeddingJob.create).not.toHaveBeenCalled();
  });
});

import { createDocumentRagHandler } from "./documents.rag";
import type { SupabaseAdminService } from "../../auth/supabase-admin.service";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";
import type { DataSourceContext } from "../../data-sources/data-source-registry.service";
import { collapsePermissions } from "../../rbac/permission-collapse";

function ctx(): DataSourceContext {
  return { tenantId: "t1", userId: "u1", userDepartmentId: null, effective: collapsePermissions([]) };
}

describe("createDocumentRagHandler", () => {
  describe("checkVisibilityAndGetName", () => {
    it("returns null when the document is gone/soft-deleted", async () => {
      const tx = { document: { findFirst: jest.fn().mockResolvedValue(null) } } as unknown as PrismaTx;
      const handler = createDocumentRagHandler({} as SupabaseAdminService);
      expect(await handler.checkVisibilityAndGetName(tx, ctx(), "d1")).toBeNull();
    });
  });

  describe("extractText", () => {
    it("returns null when the document is gone/soft-deleted — never attempts a Storage download", async () => {
      const findFirst = jest.fn().mockResolvedValue(null);
      const downloadDocumentBytes = jest.fn();
      const tx = { document: { findFirst } } as unknown as PrismaTx;
      const handler = createDocumentRagHandler({ downloadDocumentBytes } as unknown as SupabaseAdminService);

      const result = await handler.extractText(tx, "t1", "d1");

      expect(result).toBeNull();
      expect(downloadDocumentBytes).not.toHaveBeenCalled();
    });

    it("downloads bytes and extracts text for a found document", async () => {
      const findFirst = jest.fn().mockResolvedValue({ id: "d1", storagePath: "t1/d1/v1", mimeType: "text/plain" });
      const downloadDocumentBytes = jest.fn().mockResolvedValue(new TextEncoder().encode("hello world"));
      const tx = { document: { findFirst } } as unknown as PrismaTx;
      const handler = createDocumentRagHandler({ downloadDocumentBytes } as unknown as SupabaseAdminService);

      const result = await handler.extractText(tx, "t1", "d1");

      expect(downloadDocumentBytes).toHaveBeenCalledWith("t1/d1/v1");
      expect(result).toBe("hello world");
    });
  });
});

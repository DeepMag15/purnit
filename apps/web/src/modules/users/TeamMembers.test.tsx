import type { ReactElement } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import type { WorkspaceManifest } from "@antigravity/manifest-schema";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TeamMembers } from "./TeamMembers";
import { RenderContextProvider } from "../../sdui/render-context";
import { ToastProvider } from "../../ui/Toast";
import type { CommonRenderProps } from "../../sdui/registry";

// TeamMembers's own `Props` (z.infer of an empty z.object({})) collapses to
// an index signature of `never` under Zod v4, which — intersected with
// CommonRenderProps — makes every prop key untypeable at a real JSX call
// site. Production code only ever renders it through the SDUI registry's
// deliberately `any`-typed dynamic path (registry.ts), never a statically
// typed JSX literal like this test needs, so this cast is test-only scaffolding.
const TeamMembersUnderTest = TeamMembers as unknown as (props: CommonRenderProps) => ReactElement;

const user: WorkspaceManifest["user"] = { id: "u1", displayName: "Admin User", roles: ["Company Admin"], permissionsHash: "x" };
const tenant: WorkspaceManifest["tenant"] = { id: "t1", name: "Test Co", workspaceId: "test-co", industry: "IT", branding: {}, profile: {} };

const ROLES = [
  { id: "role.admin-row", label: "Company Admin" },
  { id: "role.intern-row", label: "Intern" },
];

/** Regression test for the RBAC role-ordering fix: `roles.list` no longer
 * has any dependable "lowest privilege first" order to accidentally default
 * to (see roles.data-sources.ts, now sorted by `rank`) — the invite form's
 * role picker must force an explicit choice rather than silently
 * pre-selecting whatever happens to load first (previously always Intern,
 * the createdAt-ordering bug this whole feature fixes). */
describe("TeamMembers invite form", () => {
  it("does not pre-select a role once roles.list resolves", async () => {
    const queryClient = new QueryClient();
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <RenderContextProvider
          value={{
            user,
            tenant,
            callDataSource: async (source: string) => {
              if (source === "roles.list") return ROLES;
              if (source === "departments.list") return [{ id: "d1", name: "Engineering" }];
              if (source === "teams.list") return [];
              return [];
            },
            callMutation: vi.fn(),
            navigate: () => {},
            refetchBootstrap: () => {},
            openAiPanel: () => {},
            aiAvailable: false,
          }}
        >
          <ToastProvider>
            <TeamMembersUnderTest
              bind={{ const: [] }}
              actions={[{ kind: "mutation", mutation: "user.invite", input: { const: {} } }]}
              nodeId="test-team-members"
              renderChild={() => null}
            />
          </ToastProvider>
        </RenderContextProvider>
      </QueryClientProvider>,
    );

    const roleSelect = () => container.querySelectorAll("select")[0] as HTMLSelectElement;

    await waitFor(() => expect(roleSelect().options.length).toBe(ROLES.length + 1));
    expect(roleSelect().value).toBe("");
    expect(roleSelect().options[0]!.textContent).toBe("Select role…");
  });
});

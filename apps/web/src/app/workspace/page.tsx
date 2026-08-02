"use client";

import { Renderer } from "../../sdui/renderer";
import { FilterStateProvider } from "../../sdui/filter-state";
import { useBootstrap } from "./bootstrap-context";

export default function WorkspaceHomePage() {
  const { manifest } = useBootstrap();
  return (
    <FilterStateProvider key={manifest.page.id}>
      <Renderer node={manifest.page} />
    </FilterStateProvider>
  );
}

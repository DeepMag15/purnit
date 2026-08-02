import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";

export default function HomePage() {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-bg px-4">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_50%_at_50%_0%,var(--color-accent)_0%,transparent_70%)] opacity-[0.12]" />
      <div className="relative z-10 w-full max-w-md text-center">
        <div className="mb-5 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-accent text-accent-fg">
          <Icon name="auto_awesome" size={18} />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-text">Antigravity</h1>
        <p className="mt-2 text-sm text-text-muted">The configuration-driven, AI-powered enterprise workspace platform.</p>
        <div className="mt-8 flex items-center justify-center gap-3">
          <a href="/signup">
            <Button size="md">Create a workspace</Button>
          </a>
          <a href="/login">
            <Button variant="secondary" size="md">
              Log in
            </Button>
          </a>
        </div>
      </div>
    </main>
  );
}

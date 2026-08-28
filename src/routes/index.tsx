import { createFileRoute, Link } from "@tanstack/react-router";
import { Zap, Camera, ShieldCheck, ScanLine } from "lucide-react";

import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Electricity Ledger — Evidence-backed prepaid metering" },
      {
        name: "description",
        content:
          "Capture payment receipts, central prepaid meter readings and apartment submeter photos with OCR assistance and admin confirmation.",
      },
      { property: "og:title", content: "Electricity Ledger — Evidence-backed prepaid metering" },
      {
        property: "og:description",
        content:
          "Every kWh backed by an original photo: receipts, token loads, central meter and submeter readings.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Landing,
});

const FEATURES = [
  {
    icon: Camera,
    title: "Capture on any phone",
    body: "Take a photo, pick from the gallery or attach a file. The original image is preserved byte-for-byte.",
  },
  {
    icon: ScanLine,
    title: "OCR assists, never decides",
    body: "Extracted amounts and meter readings are shown with confidence, then an administrator confirms.",
  },
  {
    icon: ShieldCheck,
    title: "Private, hashed evidence",
    body: "Evidence lives in a private store, hashed with SHA-256 and viewed only through short-lived signed links.",
  },
];

function Landing() {
  return (
    <main className="min-h-screen bg-background">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-5 py-6">
        <div className="flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Zap className="h-4 w-4" />
          </span>
          <span className="font-semibold tracking-tight">Electricity Ledger</span>
        </div>
        <Button asChild size="sm">
          <Link to="/auth">Sign in</Link>
        </Button>
      </header>

      <section className="mx-auto max-w-5xl px-5 pb-14 pt-8">
        <h1 className="max-w-2xl text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
          Every kWh backed by evidence
        </h1>
        <p className="mt-4 max-w-xl text-base text-muted-foreground">
          Residents upload payment receipts. Administrators photograph the central prepaid meter and
          each apartment submeter. Nothing is credited until a human confirms it.
        </p>
        <div className="mt-7 flex flex-wrap gap-3">
          <Button asChild size="lg">
            <Link to="/dashboard">Open dashboard</Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link to="/auth">Create an account</Link>
          </Button>
        </div>

        <div className="mt-14 grid gap-4 sm:grid-cols-3">
          {FEATURES.map((feature) => (
            <div key={feature.title} className="rounded-xl border border-border bg-card p-5">
              <feature.icon className="h-5 w-5 text-primary" />
              <h2 className="mt-3 text-sm font-semibold">{feature.title}</h2>
              <p className="mt-1.5 text-sm text-muted-foreground">{feature.body}</p>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

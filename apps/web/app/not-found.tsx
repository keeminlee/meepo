import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="max-w-xl rounded-2xl card-glass p-10 text-center">
        <h1 className="text-3xl font-serif italic">Archive node not found</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          The requested campaign or session was not found in this shell build.
        </p>
        <Link href="/dashboard" className="mt-6 inline-block rounded-full button-primary px-5 py-2 text-xs font-bold uppercase tracking-widest">
          Return to Dashboard
        </Link>
      </div>
    </div>
  );
}

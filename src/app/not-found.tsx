import Link from 'next/link';
export default function NotFound() {
  return (
    <main className="loading-screen">
      <h1>This place is still undiscovered.</h1>
      <Link href="/projects">Return to your projects →</Link>
    </main>
  );
}

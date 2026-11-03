import Link from "next/link";
export default function NotFound() {
  return <main className="p-10"><h1 className="font-serif text-2xl">We couldn't find that book.</h1><Link href="/dashboard" className="mt-4 inline-block hover:underline">Back to your dashboard</Link></main>;
}

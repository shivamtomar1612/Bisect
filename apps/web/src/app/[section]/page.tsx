import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { type SectionKey, SectionPage, sections } from "../../components/section-page";

export function generateStaticParams() {
  return Object.keys(sections)
    .filter((section) => section !== "overview")
    .map((section) => ({ section }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ section: string }>;
}): Promise<Metadata> {
  const { section } = await params;
  return {
    title:
      (Object.hasOwn(sections, section) ? sections[section as SectionKey].title : "Not found") +
      " | BISECT",
  };
}

export default async function Page({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  if (!Object.hasOwn(sections, section) || section === "overview") notFound();
  return <SectionPage section={section as SectionKey} />;
}

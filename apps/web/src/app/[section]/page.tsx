import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ClaimsExplorer, DisputesExplorer, ReadDataNotice } from "../../components/explorers";
import { PageHeader, type SectionKey, SectionPage, sections } from "../../components/section-page";
import { getClaims, getDisputes } from "../../lib/read-api";

export const dynamic = "force-dynamic";

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

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ section: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { section } = await params;
  if (!Object.hasOwn(sections, section) || section === "overview") notFound();
  if (section === "claims" || section === "disputes") {
    const paramsFromUrl = await searchParams;
    const query = new URLSearchParams();
    for (const key of ["q", "status", "cursor"] as const) {
      const value = paramsFromUrl[key];
      if (typeof value === "string" && value !== "") query.set(key, value);
    }
    const queryString = query.size ? `&${query}` : "";
    const common = {
      query: typeof paramsFromUrl["q"] === "string" ? paramsFromUrl["q"] : "",
      status: typeof paramsFromUrl["status"] === "string" ? paramsFromUrl["status"] : "",
      cursor: typeof paramsFromUrl["cursor"] === "string" ? paramsFromUrl["cursor"] : "",
    };
    if (section === "claims") {
      const result = await getClaims(queryString);
      return (
        <div className="page">
          <PageHeader section="claims" />
          {result.kind === "ready" ? (
            <ClaimsExplorer page={result.value} {...common} />
          ) : result.kind === "not-found" ? null : (
            <ReadDataNotice result={result} subject="claims" />
          )}
        </div>
      );
    }
    const result = await getDisputes(queryString);
    return (
      <div className="page">
        <PageHeader section="disputes" />
        <p className="callout">
          <strong>Learn the protocol:</strong>{" "}
          <Link href="/disputes/demo">
            Watch a clearly labeled 1,023-transition educational simulation
          </Link>
          .
        </p>
        {result.kind === "ready" ? (
          <DisputesExplorer page={result.value} {...common} />
        ) : result.kind === "not-found" ? null : (
          <ReadDataNotice result={result} subject="disputes" />
        )}
      </div>
    );
  }
  return <SectionPage section={section as SectionKey} />;
}

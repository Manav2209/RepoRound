"use client";

import Link from "next/link";
import { use } from "react";
import DesignSubmission from "../../../../components/system-design/DesignSubmission";

export default function DesignPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: interviewId } = use(params);
  return (
    <main className="design-page">
      <Link href="/" className="back-link">
        ← Back to home
      </Link>
      <p className="eyebrow">System design</p>
      <h1>Design your architecture.</h1>
      <p className="subtitle">
        Assemble the components, connect the data flow, then submit to start
        explaining your design.
      </p>
      <DesignSubmission interviewId={interviewId} variant="initial" />
    </main>
  );
}

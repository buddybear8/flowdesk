import { Suspense } from "react";
import { SentimentView } from "@/components/modules/sentiment/SentimentView";

export default function SentimentPage() {
  return (
    <Suspense fallback={<div className="flex-1" />}>
      <SentimentView />
    </Suspense>
  );
}

"use client";

import { Suspense, type ComponentProps } from "react";
import { useSearchParams } from "next/navigation";
import { CompareTool } from "../CompareTool";

type Props = Omit<ComponentProps<typeof CompareTool>, "initialExercise" | "initialIds"> & {
  defaultExercise: string;
  defaultIds: string[];
};

/**
 * Static demo only: reads `?ex=&ids=` in the browser (same rules as the server
 * pages do in normal mode). The default selection is the Suspense fallback.
 */
export function CompareFromQuery(props: Props) {
  return (
    <Suspense fallback={<Inner {...props} />}>
      <FromQuery {...props} />
    </Suspense>
  );
}

function Inner({ defaultExercise, defaultIds, ...rest }: Props) {
  return <CompareTool key={`${defaultExercise}|${defaultIds.join(",")}`} {...rest} initialExercise={defaultExercise} initialIds={defaultIds} />;
}

function FromQuery(props: Props) {
  const sp = useSearchParams();
  const { defaultExercise, defaultIds, exercises, ...rest } = props;
  const q = sp.get("ex");
  const ex = q && exercises.some((e) => e.key === q) ? q : defaultExercise;
  const idq = sp.get("ids");
  const ids = idq ? idq.split(",").filter(Boolean) : ex === defaultExercise ? defaultIds : [];
  return <CompareTool key={`${ex}|${ids.join(",")}`} {...rest} exercises={exercises} initialExercise={ex} initialIds={ids} />;
}

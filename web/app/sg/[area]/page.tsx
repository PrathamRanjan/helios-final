import { notFound } from "next/navigation";
import AreaWorkspace from "@/components/v2/AreaWorkspace";
import { areaById } from "@/lib/compass/areas";

export default function AreaPage({ params }: { params: { area: string } }) {
  if (!areaById(params.area)) notFound();
  return <AreaWorkspace areaId={params.area} />;
}

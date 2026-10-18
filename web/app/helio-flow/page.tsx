import { redirect } from "next/navigation";

// V1 HELIO Flow moved into the V2 area workspace; Jurong East is the original sandbox.
export default function HelioFlowRedirect() {
  redirect("/sg/jurong_east");
}

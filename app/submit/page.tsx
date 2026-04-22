import { redirect } from "next/navigation";
import { getSessionInfo } from "@/lib/auth";
import { SubmitForm } from "./SubmitForm";

export const dynamic = "force-dynamic";

export default async function SubmitPage() {
  const session = await getSessionInfo();
  if (!session) redirect("/auth/sign-in?next=/submit");
  const role = session.profile?.role ?? "customer";
  if (role !== "admin" && role !== "submitter") {
    return (
      <div className="max-w-md mx-auto px-4 py-16 text-center">
        <h1 className="text-xl font-semibold mb-2">Not authorized</h1>
        <p className="text-sm text-neutral-600">
          Your account doesn&apos;t have permission to submit shoes. Ask an
          admin to invite you as a submitter.
        </p>
      </div>
    );
  }
  return <SubmitForm email={session.email} />;
}

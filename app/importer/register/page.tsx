import type { Metadata } from "next";
import { RegistrationWizard } from "@/components/importer/RegistrationWizard";

export const metadata: Metadata = {
  title: "Become an Importer",
  description: "Register as a global buyer on MCG Global.",
};

export default function ImporterRegisterPage() {
  return (
    <main className="min-h-screen bg-[#0F172A] px-4 py-10 sm:px-6">
      <RegistrationWizard />
    </main>
  );
}

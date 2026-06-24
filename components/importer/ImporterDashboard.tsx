"use client";

import { useEffect, useState } from "react";
import type { ImporterSectionId, SourcingRFQ } from "@/lib/importer/types";
import { createClient, SUPABASE_CONFIGURED } from "@/lib/supabase/client";
import {
  analytics,
  bookings,
  currentSession,
  deals,
  importer,
  marketFleet,
  marketProducts,
  marketSuppliers,
  marketWarehouses,
  quotations,
  rfqs as seedRfqs,
  shipments,
} from "@/lib/importer/data";
import { ImporterSidebar } from "./ImporterSidebar";
import { ImporterTopbar } from "./ImporterTopbar";
import { HomeSection } from "./sections/HomeSection";
import { BuyerHomeSection } from "./sections/BuyerHomeSection";
import { SourcingSection } from "./sections/SourcingSection";
import { RfqsSection } from "./sections/RfqsSection";
import { RfqWizard } from "./sections/RfqWizard";
import { QuotationsSection } from "./sections/QuotationsSection";
import { LiveDealsSection } from "./sections/LiveDealsSection";
import { TrackingSection } from "./sections/TrackingSection";
import { LogisticsSection } from "./sections/LogisticsSection";
import { FeedbackSection } from "./sections/FeedbackSection";
import { ProfileSection } from "./sections/ProfileSection";

export function ImporterDashboard() {
  const [active, setActive] = useState<ImporterSectionId>("home");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [rfqs, setRfqs] = useState<SourcingRFQ[]>(seedRfqs);
  const [focusRfqId, setFocusRfqId] = useState<string | null>(null);
  const [buyerId, setBuyerId] = useState<string | null>(null);
  const session = currentSession;

  // Resolve the live signed-in buyer id for Loop B (deal acceptance / feeds).
  useEffect(() => {
    if (!SUPABASE_CONFIGURED) return;
    const db = createClient();
    let active = true;
    db.auth.getUser().then(({ data }) => {
      if (active) setBuyerId(data.user?.id ?? null);
    });
    return () => {
      active = false;
    };
  }, []);

  const select = (id: ImporterSectionId) => {
    setActive(id);
    setMobileOpen(false);
  };

  const addRfq = (rfq: SourcingRFQ) => setRfqs((prev) => [rfq, ...prev]);

  const viewQuotes = (rfqId: string) => {
    setFocusRfqId(rfqId);
    setActive("quotations");
  };

  return (
    <div className="min-h-screen bg-navy-50/40">
      <ImporterSidebar
        active={active}
        onSelect={select}
        fullName={importer.fullName}
        companyName={importer.companyName}
        unread={analytics.unreadAlerts}
        mobileOpen={mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
      />

      <div className="lg:pl-64">
        <ImporterTopbar
          section={active}
          alerts={analytics.unreadAlerts}
          onOpenMobile={() => setMobileOpen(true)}
          onNewRFQ={() => setWizardOpen(true)}
        />
        <main className="px-4 py-6 sm:px-6">
          {active === "home" && (
            <div className="space-y-6">
              <BuyerHomeSection buyerId={buyerId} />
              <HomeSection analytics={analytics} rfqs={rfqs} shipments={shipments} />
            </div>
          )}
          {active === "sourcing" && (
            <SourcingSection
              products={marketProducts}
              suppliers={marketSuppliers}
              onRequestQuote={() => setWizardOpen(true)}
            />
          )}
          {active === "rfqs" && (
            <RfqsSection
              session={session}
              rfqs={rfqs}
              onNewRFQ={() => setWizardOpen(true)}
              onViewQuotes={viewQuotes}
            />
          )}
          {active === "quotations" && (
            <div className="space-y-6">
              <LiveDealsSection buyerId={buyerId} />
              <QuotationsSection
                session={session}
                rfqs={rfqs}
                quotations={quotations}
                deals={deals}
                focusRfqId={focusRfqId}
              />
            </div>
          )}
          {active === "tracking" && <TrackingSection session={session} shipments={shipments} />}
          {active === "logistics" && <LogisticsSection warehouses={marketWarehouses} fleet={marketFleet} />}
          {active === "feedback" && <FeedbackSection session={session} deals={deals} />}
          {active === "profile" && <ProfileSection session={session} profile={importer} />}
        </main>
      </div>

      <RfqWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        importerId={session.importerId}
        onCreate={addRfq}
      />
    </div>
  );
}
